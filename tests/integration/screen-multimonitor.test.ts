import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {CdpClient} from '../../src/main/cdp/client';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

/** Environment-dependent: only runs when a second desktop is described as "left,top". */
const second=process.env.LOCAL_PROFILES_TEST_SECOND_DISPLAY;

it.skipIf(!second)('keeps the emulated screen consistent after moving the window to a second display',async()=>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const [left,top]=second!.split(',').map(Number);
  if(!Number.isFinite(left)||!Number.isFinite(top))throw Error('LOCAL_PROFILES_TEST_SECOND_DISPLAY must be "left,top"');
  const reports:Array<{tag:string;screen:[number,number,number,number];mqSpoof:boolean;inner:[number,number]}>=[];
  const page=`<!doctype html><script>(()=>{const v={tag:'parent',screen:[screen.width,screen.height,screen.availWidth,screen.availHeight],inner:[innerWidth,innerHeight],mqSpoof:matchMedia('(device-width: 1280px)').matches};fetch('/report?value='+encodeURIComponent(JSON.stringify(v)))})()</script>`;
  const server=createServer((req,res)=>{if(req.url?.startsWith('/report')){reports.push(JSON.parse(new URL(req.url,'http://local').searchParams.get('value')!));res.end('ok');return;}res.setHeader('Content-Type','text/html');res.end(page);});
  const port=await listen(server);const url=`http://127.0.0.1:${port}`;
  const root=tempRoot();let client:CdpClient|null=null;
  try{
    const p=await new ChromiumAdapter(exe,(a,b)=>{client=CdpClient.fromPipe(a,b);return client;}).launch({profileId:'screen-second-display',userDataDir:root,languages:['en-US'],startUrls:[url],fingerprint:{...DEFAULT_FINGERPRINT,screen:{mode:'manual',width:1280,height:720}}});
    try{
      for(let i=0;i<100&&reports.length===0;i++)await new Promise(r=>setTimeout(r,100));
      expect(reports[0]!.screen.slice(0,2)).toEqual([1280,720]);
      expect(reports[0]!.mqSpoof).toBe(true);
      const {targetInfos}=await client!.send<{targetInfos:Array<{targetId:string;type:string}>}>('Target.getTargets',{});
      const target=targetInfos.find(t=>t.type==='page')!;
      const {windowId}=await client!.send<{windowId:number}>('Browser.getWindowForTarget',{targetId:target.targetId});
      await client!.send('Browser.setWindowBounds',{windowId,bounds:{left,top,width:900,height:650}});
      const bounds=await client!.send<{bounds:{left:number;top:number}}>('Browser.getWindowBounds',{windowId});
      expect(bounds.bounds.left,'the window did not move to the configured second display').toBe(left);
      const {sessionId}=await client!.send<{sessionId:string}>('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      const before=reports.length;
      await client!.send('Page.reload',{},sessionId);
      for(let i=0;i<100&&reports.length<=before;i++)await new Promise(r=>setTimeout(r,100));
      const moved=reports.at(-1)!;
      expect(moved.screen.slice(0,2)).toEqual([1280,720]);
      expect(moved.mqSpoof).toBe(true);
      expect(moved.inner[0],'the viewport must follow the smaller window').toBeLessThan(reports[0]!.inner[0]);
    }finally{await p.stop();}
  }finally{cleanup(root);server.closeAllConnections();server.close();}
},120000);

function listen(server:ReturnType<typeof createServer>){return new Promise<number>(resolve=>{server.listen(0,'127.0.0.1',()=>resolve((server.address() as AddressInfo).port));});}
