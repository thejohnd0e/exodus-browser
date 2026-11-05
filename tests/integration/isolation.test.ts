import {it,expect} from 'vitest';
import http from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
type Report={visit:string;kind:string;cookie:string;ls:string;idb:string};
function page(kind:'set'|'read',marker:string,visit:string){
  const setup=kind==='set'?`document.cookie=${JSON.stringify('marker='+marker+'; path=/; max-age=3600')};localStorage.setItem('marker',${JSON.stringify(marker)});await new Promise(r=>{const q=indexedDB.open('t',1);q.onupgradeneeded=()=>{try{q.result.createObjectStore('s');}catch{}};q.onsuccess=()=>{const tx=q.result.transaction('s','readwrite');tx.objectStore('s').put(${JSON.stringify(marker)},'m');tx.oncomplete=()=>{q.result.close();r();};};q.onerror=()=>r();});`:``;
  return `<!doctype html><meta charset="utf-8"><title>${kind}</title><script type="module">${setup}const ls=localStorage.getItem('marker')??'';const idb=await new Promise(r=>{const q=indexedDB.open('t',1);q.onupgradeneeded=()=>{try{q.result.createObjectStore('s');}catch{}};q.onsuccess=()=>{const g=q.result.transaction('s').objectStore('s').get('m');g.onsuccess=()=>{r(g.result??'');q.result.close();};g.onerror=()=>r('');};q.onerror=()=>r('');});await fetch('/report?visit=${visit}&kind=${kind}&ls='+encodeURIComponent(ls)+'&idb='+encodeURIComponent(idb));</script>`;
}
it('keeps cookies, localStorage and IndexedDB isolated between profiles and across restarts',async()=>{
  const reports:Report[]=[];
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url!,'http://x');
    if(url.pathname==='/report'){reports.push({visit:url.searchParams.get('visit')??'',kind:url.searchParams.get('kind')??'',cookie:req.headers.cookie??'',ls:url.searchParams.get('ls')??'',idb:url.searchParams.get('idb')??''});res.end('ok');return;}
    const kind=url.pathname==='/set'?'set':'read';const marker=url.searchParams.get('m')??'';const visit=url.searchParams.get('v')??'';
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page(kind,marker,visit));
  });server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dirs=[mkdtempSync(join(tmpdir(),'lp-a-')),mkdtempSync(join(tmpdir(),'lp-b-'))];
  // Test-only engine: an already installed local Playwright Chromium build. Production uses the explicitly installed engine.
  let executable=chromium.executablePath();
  if(!existsSync(executable)){
    const root=join(process.env.LOCALAPPDATA??'','ms-playwright');
    const candidates=existsSync(root)?readdirSync(root).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
    executable=join(root,candidates[0]??'missing','chrome-win64','chrome.exe');
  }
  if(!existsSync(executable))throw Error('BLOCKED: no local Chromium test engine is installed');
  const engine=new ChromiumAdapter(executable);
  async function visit(dir:string,pathAndQuery:string,visit:string){
    const p=await engine.launch({profileId:'t',userDataDir:dir,startUrls:[`${origin}${pathAndQuery}&v=${visit}`],languages:['ru-RU'],fingerprint:DEFAULT_FINGERPRINT});
    try{for(let i=0;i<80&&!reports.some(r=>r.visit===visit);i++)await new Promise(r=>setTimeout(r,250));const report=reports.find(r=>r.visit===visit);expect(report,'page did not report back — Chromium start/first page may have failed').toBeDefined();return report!;}
    finally{await p.stop();}
  }
  try{
    expect(await visit(dirs[0],'/set?m=alpha','v1')).toMatchObject({kind:'set',ls:'alpha',idb:'alpha',cookie:'marker=alpha'});
    expect(await visit(dirs[1],'/read?m=','v2')).toMatchObject({kind:'read',ls:'',idb:'',cookie:''});
    expect(await visit(dirs[0],'/read?m=','v3')).toMatchObject({kind:'read',ls:'alpha',idb:'alpha',cookie:'marker=alpha'});
  }finally{for(const d of dirs)rmSync(d,{recursive:true,force:true});server.closeAllConnections();server.close();}
},120000);
