import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,cleanup} from '../fixtures/profiles';
it('applies one selected site language in real Chromium and preserves profile storage across restart',async()=>{
 const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
 const reports:Array<{languages:string[];language:string;header:string;stored:string|null}>=[];
 const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push({...JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!),header:req.headers['accept-language']??''});res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(`<script>const stored=localStorage.getItem('marker');localStorage.setItem('marker','kept');fetch('/report?value='+encodeURIComponent(JSON.stringify({languages:navigator.languages,language:navigator.language,stored})))</script>`);});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const root=tempRoot();const engine=new ChromiumAdapter(exe);
 try{for(const language of ['de-DE','fr-FR']){const index=reports.length;const p=await engine.launch({profileId:'test',userDataDir:root,languages:[language],startUrls:[url],fingerprint:DEFAULT_FINGERPRINT});try{for(let i=0;i<300&&reports.length===index;i++)await new Promise(r=>setTimeout(r,100));const report=reports[index];expect(report,'browser did not report').toBeDefined();expect(report.language).toBe(language);expect(report.languages[0]).toBe(language);expect(report.header.split(',')[0].trim().split(';')[0]).toBe(language);expect(report.stored).toBe(index===0?null:'kept');const intl=JSON.parse(readFileSync(join(root,'Default','Preferences'),'utf8')).intl;expect(intl.accept_languages).toBe(language);expect(intl.selected_languages).toBe(language);}finally{await p.stop();}}}finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);
