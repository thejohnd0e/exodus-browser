import http from 'node:http';
import {isIP} from 'node:net';
import type {ProxyInput} from '../../shared/contracts';
import {openProxyBridge} from './bridge';
// Deliberately plain HTTP: disclosed beside the UI button and in README. An on-path attacker can spoof this check.
export const IP_CHECK_SERVICE='http://api.ipify.org?format=json';
export async function checkProxy(input:ProxyInput,endpoint=new URL(IP_CHECK_SERVICE)):Promise<{ip:string}>{
  if(endpoint.protocol!=='http:')throw Error('CHECK_SCHEME_UNSUPPORTED');
  const bridge=await openProxyBridge(input);const p=new URL(bridge.url);
  try{return await new Promise((resolve,reject)=>{
    const req=http.get({hostname:p.hostname,port:p.port,path:endpoint.href,headers:{Host:endpoint.host},timeout:10000},res=>{
      let text='';let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>65536)req.destroy(Error('CHECK_TOO_LARGE'));else text+=chunk;});
      res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('PROXY_CHECK_FAILED');const {ip}=JSON.parse(text);if(typeof ip!=='string'||!isIP(ip))throw Error('INVALID_IP_RESPONSE');resolve({ip});}catch{reject(Error('PROXY_CHECK_FAILED'));}});
    });req.on('error',()=>reject(Error('PROXY_CHECK_FAILED')));req.on('timeout',()=>req.destroy(Error('PROXY_CHECK_TIMEOUT')));
  });}finally{await bridge.close();}
}
