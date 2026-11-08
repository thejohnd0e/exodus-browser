import {it,expect,afterEach} from 'vitest';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {checkProxy,lookupExitLocation} from '../../src/main/proxy/check';
import {proxiedFetch} from '../../src/main/proxy/through-proxy';
import {openProxyBridge} from '../../src/main/proxy/bridge';
import {TEST_TLS_CERT,TEST_TLS_KEY} from '../fixtures/test-tls';
import {join} from 'node:path';
import {createCountryLookup} from '../../src/main/proxy/country';

const offlineCountry=createCountryLookup({databasePath:join(process.cwd(),'resources','geoip','dbip-country-lite.mmdb')});

const closers:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});

/** Plays api.ipify.org, api.country.is and ipwho.is on one local HTTPS origin. */
async function services(behaviour:{ip:string;country?:string|null;zone?:string|null}){
  const seen:string[]=[];
  const server=https.createServer({cert:TEST_TLS_CERT,key:TEST_TLS_KEY},(req,res)=>{
    const url=new URL(req.url??'/','https://localhost');seen.push(url.pathname);
    res.setHeader('Content-Type','application/json');
    if(url.pathname==='/hang')return;
    if(url.pathname==='/ip'){res.end(JSON.stringify({ip:behaviour.ip}));return;}
    if(url.pathname.startsWith('/country/')){if(!behaviour.country){res.statusCode=500;res.end('{}');return;}res.end(JSON.stringify({ip:behaviour.ip,country:behaviour.country}));return;}
    if(url.pathname.startsWith('/zone/')){if(!behaviour.zone){res.statusCode=500;res.end('{}');return;}res.end(JSON.stringify({success:true,timezone:{id:behaviour.zone}}));return;}
    res.statusCode=404;res.end('{}');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  closers.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  // The services live on a name that cannot be resolved, so they are reachable only through the
  // proxy below, which maps every tunnel to this server. A direct connection fails the test.
  const origin='https://exit-services.invalid';
  const open=()=>new Promise<number>(resolve=>server.getConnections((_e,n)=>resolve(n)));
  return {seen,open,port:(server.address() as AddressInfo).port,endpoints:{ip:new URL(origin+'/ip'),country:origin+'/country/',zone:origin+'/zone/'}};
}
/** An HTTP proxy that tunnels every CONNECT to the local services and records the requested target. */
async function upstream(servicesPort:number){
  const targets:string[]=[];
  const proxy=http.createServer((_req,res)=>{targets.push('plain');res.statusCode=405;res.end();});
  proxy.on('connect',(req,socket,head)=>{
    targets.push(req.url??'');
    const tunnel=net.connect(servicesPort,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established'+String.fromCharCode(13,10,13,10));if(head.length)tunnel.write(head);tunnel.pipe(socket);socket.pipe(tunnel);});
    tunnel.on('error',()=>socket.destroy());socket.on('error',()=>tunnel.destroy());
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  closers.push(()=>{proxy.closeAllConnections();proxy.close();});
  return {targets,proxy:{kind:'http' as const,host:'127.0.0.1',port:(proxy.address() as AddressInfo).port}};
}

it('asks for the exit IP, its country and its time zone through the proxy over HTTPS',async()=>{
  const {seen,endpoints,port}=await services({ip:'191.217.211.173',country:'PL',zone:'Europe/Warsaw'});
  const {targets,proxy}=await upstream(port);
  const location=await lookupExitLocation(proxy,{endpoints,ca:TEST_TLS_CERT});
  expect(location).toEqual({ip:'191.217.211.173',country:'PL',zone:'Europe/Warsaw'});
  expect(seen.sort()).toEqual(['/country/191.217.211.173','/ip','/zone/191.217.211.173']);
  // Every request reached the services through the upstream proxy.
  expect(targets).toEqual(['exit-services.invalid:443','exit-services.invalid:443','exit-services.invalid:443']);
});

it('falls back to the bundled database for the country and gives no zone when the services fail',async()=>{
  const {endpoints,port}=await services({ip:'8.8.8.8',country:null,zone:null});
  const {proxy}=await upstream(port);
  expect(await lookupExitLocation(proxy,{endpoints,ca:TEST_TLS_CERT,offlineCountry})).toEqual({ip:'8.8.8.8',country:'US',zone:null});
});

it('checks the exit IP over HTTPS through the proxy',async()=>{
  const {endpoints,port}=await services({ip:'203.0.113.9'});
  const {targets,proxy}=await upstream(port);
  expect(await checkProxy(proxy,{endpoint:endpoints.ip,ca:TEST_TLS_CERT})).toEqual({ip:'203.0.113.9'});
  expect(targets).toEqual(['exit-services.invalid:443']);
});

it('refuses plain HTTP and a certificate it does not trust',async()=>{
  const {endpoints,port}=await services({ip:'203.0.113.9'});
  const {proxy}=await upstream(port);
  const bridge=await openProxyBridge(proxy);closers.push(()=>bridge.close());
  await expect(proxiedFetch(bridge.url)('http://exit-services.invalid/ip')).rejects.toThrow('PROXIED_HTTPS_ONLY');
  // Without the test CA the self-signed certificate must be rejected: verification is not weakened.
  await expect(proxiedFetch(bridge.url)(endpoints.ip.href)).rejects.toThrow();
  await expect(checkProxy(proxy,{endpoint:endpoints.ip})).rejects.toThrow('PROXY_CHECK_FAILED');
});

it('closes the HTTPS request and the tunnel when a lookup is aborted or times out',async()=>{
  const {seen,open,port}=await services({ip:'203.0.113.9'});
  const {proxy}=await upstream(port);
  const bridge=await openProxyBridge(proxy);closers.push(()=>bridge.close());
  const settle=async()=>{for(let i=0;i<50&&await open()>0;i++)await new Promise(r=>setTimeout(r,20));return open();};
  const controller=new AbortController();
  const aborted=proxiedFetch(bridge.url,{ca:TEST_TLS_CERT})('https://exit-services.invalid/hang',{signal:controller.signal});
  for(let i=0;i<100&&!seen.includes('/hang');i++)await new Promise(r=>setTimeout(r,10));
  expect(await open(),'the request reached the service').toBe(1);
  controller.abort();
  await expect(aborted).rejects.toThrow('PROXIED_ABORTED');
  expect(await settle(),'no connection left after abort').toBe(0);
  const timed=proxiedFetch(bridge.url,{ca:TEST_TLS_CERT,timeoutMs:300})('https://exit-services.invalid/hang');
  await expect(timed).rejects.toThrow('PROXIED_TIMEOUT');
  expect(await settle(),'no connection left after a timeout').toBe(0);
});
