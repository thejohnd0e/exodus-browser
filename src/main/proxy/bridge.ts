import {Server} from 'proxy-chain';
import net from 'node:net';
import type {ProxyInput} from '../../shared/contracts';
import type {ProxyLease} from '../engines/types';
import {proxySchema} from '../../shared/validation';
async function assertReachable(host:string,port:number,timeoutMs:number){
  await new Promise<void>((resolve,reject)=>{
    const socket=net.connect({host,port});const timer=setTimeout(()=>{socket.destroy();reject(Error('PROXY_UNREACHABLE'));},timeoutMs);
    socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve();});
    socket.once('error',()=>{clearTimeout(timer);socket.destroy();reject(Error('PROXY_UNREACHABLE'));});
  });
}
export async function openProxyBridge(value:ProxyInput,options:{connectTimeoutMs?:number}={}):Promise<ProxyLease>{
  const input=proxySchema.parse(value);const upstream=new URL(`${input.kind}://${input.host}:${input.port}`);
  if(input.username)upstream.username=input.username.replaceAll('%','%25');if(input.password)upstream.password=input.password.replaceAll('%','%25');
  await assertReachable(input.host,input.port,options.connectTimeoutMs??10000);
  const server=new Server({host:'127.0.0.1',port:0,verbose:false,prepareRequestFunction:()=>({upstreamProxyUrl:upstream.href,ignoreUpstreamProxyCertificate:false})});
  // Never print errors from the proxy library: they may contain upstream URLs.
  server.on('requestFailed',()=>{});server.on('tlsError',()=>{});
  await server.listen();let closed=false;
  return {url:`http://127.0.0.1:${server.port}`,close:async()=>{if(!closed){closed=true;await server.close(true);}}};
}
