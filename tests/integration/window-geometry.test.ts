import {it,expect} from 'vitest';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ChromiumAdapter} from '../../src/main/engines/chromium';
import {tempRoot,cleanup} from '../fixtures/profiles';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';

const base=join(process.env.LOCALAPPDATA??'','ms-playwright');
const candidates=existsSync(base)?readdirSync(base).filter(n=>n.startsWith('chromium-')).sort().reverse():[];
const exe=process.env.LOCAL_PROFILES_TEST_CHROMIUM??join(base,candidates[0]??'missing','chrome-win64','chrome.exe');

type Geometry={screen:[number,number];outer:[number,number];inner:[number,number]};
const EXPR='JSON.stringify({screen:[screen.width,screen.height],outer:[outerWidth,outerHeight],inner:[innerWidth,innerHeight]})';

/** Launches a profile with a manual screen, resizes the real window and reads what the page sees. */
async function withWindow<T>(width:number,height:number,run:(set:(w:number,h:number)=>Promise<Geometry & {bounds:{width:number;height:number}}>)=>Promise<T>):Promise<T>{
  if(!existsSync(exe))throw Error('BLOCKED: no local Chromium');
  const root=tempRoot();
  const fingerprint:Fingerprint={...DEFAULT_FINGERPRINT,screen:{mode:'manual',width,height}};
  const p=await new ChromiumAdapter(exe).launch({profileId:'window-geometry',userDataDir:root,languages:['en-US'],startUrls:['about:blank'],fingerprint});
  try{
    const browser=p.browser!;const [page]=await browser.pages();const sessionId=await browser.attach(page.targetId);
    const {windowId}=await browser.send<{windowId:number}>('Browser.getWindowForTarget',{targetId:page.targetId},sessionId);
    const set=async(w:number,h:number)=>{
      await browser.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}},sessionId);
      await browser.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal',width:w,height:h,left:20,top:20}},sessionId);
      await new Promise(r=>setTimeout(r,600));
      const {bounds}=await browser.send<{bounds:{width:number;height:number}}>('Browser.getWindowBounds',{windowId},sessionId);
      const value=(await browser.send<{result:{value:string}}>('Runtime.evaluate',{expression:EXPR,returnByValue:true},sessionId)).result.value;
      return {...JSON.parse(value) as Geometry,bounds};
    };
    return await run(set);
  }finally{await p.stop();cleanup(root);}
}

it('outerWidth and outerHeight follow the real window, not the emulated screen',async()=>{
  await withWindow(1920,1080,async set=>{
    const g=await set(900,700);
    expect(g.screen).toEqual([1920,1080]);
    expect(g.outer).toEqual([g.bounds.width,g.bounds.height]);
    // A real window has a fixed frame: the same relation as an unmodified browser.
    expect(g.outer[0]-g.inner[0]).toBeGreaterThanOrEqual(0);expect(g.outer[0]-g.inner[0]).toBeLessThan(40);
    expect(g.outer[1]-g.inner[1]).toBeGreaterThan(40);expect(g.outer[1]-g.inner[1]).toBeLessThan(200);
    const bigger=await set(1100,800);
    expect(bigger.outer).toEqual([bigger.bounds.width,bigger.bounds.height]);
  });
},120000);

it('the reported outer size never exceeds the reported screen',async()=>{
  await withWindow(1000,700,async set=>{
    const g=await set(1400,900);
    expect(g.screen).toEqual([1000,700]);
    expect(g.outer[0]).toBeLessThanOrEqual(1000);
    expect(g.outer[1]).toBeLessThanOrEqual(700);
  });
},120000);
