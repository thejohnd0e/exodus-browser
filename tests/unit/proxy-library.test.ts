import {it,expect} from 'vitest';
import {ProfileService} from '../../src/main/profiles/service';
import {parseProfileInput} from '../../src/shared/validation';
import {tempRoot,testSecrets,cleanup} from '../fixtures/profiles';
const profile={name:'Work',note:'',startUrls:['about:blank'],languages:['ru-RU'],proxyId:null};
it('canonicalizes the selected locale and rejects an invalid locale',()=>{
 expect(parseProfileInput({...profile,languages:['EN-us']}).languages).toEqual(['en-US']);
 expect(()=>parseProfileInput({...profile,languages:['invalid_locale']})).toThrow();
});
it('shares encrypted proxy credentials, refuses deleting assigned proxies and never exposes a secret',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());
 try{
  const proxy=await s.createProxy({name:'Shared',kind:'http',host:'localhost',port:8080,password:'shared-secret'});
  const a=await s.create({...profile,proxyId:proxy.id});const b=await s.create({...profile,name:'Second',proxyId:proxy.id});
  expect(s.getProxy(proxy.id).profileIds.sort()).toEqual([a.id,b.id].sort());
  expect(JSON.stringify(await s.list())).not.toContain('shared-secret');
  expect(s.getLaunchInput(a.id).proxy?.password).toBe('shared-secret');
  await s.updateProxy(proxy.id,{name:'Shared',kind:'http',host:'localhost',port:8080,password:'changed-secret'});
  expect(s.getLaunchInput(b.id).proxy?.password).toBe('changed-secret');
  await expect(s.removeProxy(proxy.id)).rejects.toThrow('PROXY_IN_USE');
  await s.update(a.id,{...profile,proxyId:null});await s.remove(b.id);await s.removeProxy(proxy.id);
  expect(await s.listProxies()).toEqual([]);
  await expect(s.create({...profile,proxyId:proxy.id})).rejects.toThrow('PROXY_NOT_FOUND');
 }finally{s.close();cleanup(root);}
});
it('does not reuse the proxy password after changing upstream or account',async()=>{
 const root=tempRoot();const s=new ProfileService(root,testSecrets());
 try{const p=await s.createProxy({name:'P',kind:'http',host:'localhost',port:8080,password:'secret'});
 await s.updateProxy(p.id,{name:'P',kind:'http',host:'other.example',port:8080});expect(s.getProxyInput(p.id).password).toBeUndefined();
 }finally{s.close();cleanup(root);}
});
