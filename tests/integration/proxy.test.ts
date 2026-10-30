import {it,expect} from 'vitest';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {Server} from 'proxy-chain';
import {openProxyBridge} from '../../src/main/proxy/bridge';
import {checkProxy} from '../../src/main/proxy/check';
import {socks5Server} from '../fixtures/proxy-servers';
async function origin(){let count=0;let authorization:unknown;const s=http.createServer((req,res)=>{count++;authorization=req.headers['proxy-authorization'];res.end('origin');});s.listen(0,'127.0.0.1');await once(s,'listening');return {s,port:(s.address() as net.AddressInfo).port,count:()=>count,auth:()=>authorization};}
function request(proxy:string,target:string){const p=new URL(proxy);return new Promise<{status:number;body:string}>((resolve,reject)=>{const req=http.get({host:p.hostname,port:p.port,path:target,timeout:3000},r=>{let body='';r.on('data',d=>body+=d);r.on('end',()=>resolve({status:r.statusCode!,body}));});req.on('error',reject).on('timeout',()=>req.destroy(Error('timeout')));});}
it('forwards HTTP and CONNECT through authenticated upstream without leaking proxy authorization',async()=>{
  const o=await origin();let auth='';const upstream=new Server({host:'127.0.0.1',port:0,prepareRequestFunction:({username,password})=>{auth=username+':'+password;return {requestAuthentication:username!=='u'||password!=='proxy-password'};}});await upstream.listen();
  const lease=await openProxyBridge({kind:'http',host:'127.0.0.1',port:upstream.port,username:'u',password:'proxy-password'});
  try{
    expect(new URL(lease.url).hostname).toBe('127.0.0.1');
    expect(await request(lease.url,`http://127.0.0.1:${o.port}/`)).toEqual({status:200,body:'origin'});
    expect(auth).toBe('u:proxy-password');expect(o.auth()).toBeUndefined();
    const p=new URL(lease.url);const socket=net.connect(Number(p.port),p.hostname);await once(socket,'connect');socket.write(`CONNECT 127.0.0.1:${o.port} HTTP/1.1\r\nHost: 127.0.0.1:${o.port}\r\n\r\n`);
    const [reply]=await once(socket,'data');expect(reply.toString()).toContain('200');socket.destroy();
  }finally{await lease.close();await upstream.close(true);o.s.closeAllConnections();o.s.close();}
});
it('never reaches origin when proxy password is wrong or upstream is down',async()=>{
  const o=await origin();const upstream=new Server({host:'127.0.0.1',port:0,prepareRequestFunction:()=>({requestAuthentication:true})});await upstream.listen();
  const lease=await openProxyBridge({kind:'http',host:'127.0.0.1',port:upstream.port,password:'wrong'});
  try{expect((await request(lease.url,`http://127.0.0.1:${o.port}/`)).status).not.toBe(200);expect(o.count()).toBe(0);await upstream.close(true);expect((await request(lease.url,`http://127.0.0.1:${o.port}/`)).status).not.toBe(200);expect(o.count()).toBe(0);}finally{await lease.close();o.s.close();}
});
it('relays through SOCKS5 without authentication',async()=>{
  const o=await origin();const seen:string[]=[];const socks=await socks5Server(t=>seen.push(t));const lease=await openProxyBridge({kind:'socks5',host:'127.0.0.1',port:socks.port});
  try{expect(await request(lease.url,`http://127.0.0.1:${o.port}/`)).toEqual({status:200,body:'origin'});expect(seen).toContain(`127.0.0.1:${o.port}`);}finally{await lease.close();socks.server.close();o.s.close();}
});
it('checks external IP only through the configured proxy and rejects malformed answers',async()=>{
  const target=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ip:'203.0.113.9'}));});target.listen(0,'127.0.0.1');await once(target,'listening');
  const bad=http.createServer((_req,res)=>res.end('{"ip":"not-an-ip"}'));bad.listen(0,'127.0.0.1');await once(bad,'listening');
  const upstream=new Server({host:'127.0.0.1',port:0});await upstream.listen();const input={kind:'http' as const,host:'127.0.0.1',port:upstream.port};
  try{expect(await checkProxy(input,new URL(`http://127.0.0.1:${(target.address() as net.AddressInfo).port}/`))).toEqual({ip:'203.0.113.9'});
    await expect(checkProxy(input,new URL(`http://127.0.0.1:${(bad.address() as net.AddressInfo).port}/`))).rejects.toThrow('PROXY_CHECK_FAILED');}finally{await upstream.close(true);target.close();bad.close();}
});
it('allocates a separate loopback port per lease',async()=>{
  const upstream=new Server({host:'127.0.0.1',port:0});await upstream.listen();
  const a=await openProxyBridge({kind:'http',host:'127.0.0.1',port:upstream.port});const b=await openProxyBridge({kind:'http',host:'127.0.0.1',port:upstream.port});
  try{expect(new URL(a.url).hostname).toBe('127.0.0.1');expect(new URL(b.url).hostname).toBe('127.0.0.1');expect(a.url).not.toBe(b.url);}finally{await a.close();await b.close();await upstream.close(true);}
});
it('fails fast when the upstream does not accept a connection',async()=>{
  await expect(openProxyBridge({kind:'http',host:'192.0.2.1',port:9},{connectTimeoutMs:300})).rejects.toThrow('PROXY_UNREACHABLE');
});
it('preserves literal percent characters in proxy credentials',async()=>{
  const o=await origin();let auth='';const upstream=new Server({host:'127.0.0.1',port:0,prepareRequestFunction:({username,password})=>{auth=username+':'+password;return {requestAuthentication:password!=='p%41ss'};}});await upstream.listen();
  const lease=await openProxyBridge({kind:'http',host:'127.0.0.1',port:upstream.port,username:'u',password:'p%41ss'});
  try{expect(await request(lease.url,`http://127.0.0.1:${o.port}/`)).toEqual({status:200,body:'origin'});expect(auth).toBe('u:p%41ss');}finally{await lease.close();await upstream.close(true);o.s.close();}
});
