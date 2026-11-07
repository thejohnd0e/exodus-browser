import {it,expect} from 'vitest';
import {_electron as electron,type ElectronApplication} from 'playwright';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function launch(minimizeToTray:boolean){
  const data=mkdtempSync(join(tmpdir(),'exodus-tray-'));
  writeFileSync(join(data,'settings.json'),JSON.stringify({language:'en',minimizeToTray})+'\n');
  const app=await electron.launch({args:['.'],env:{...process.env,LOCAL_PROFILES_DATA:data}});
  const page=await app.firstWindow();await page.waitForSelector('h1');
  // Taken now: the handle is unusable once the application has exited.
  return {app,page,data,proc:app.process()};
}
const windowState=(app:ElectronApplication)=>app.evaluate(({BrowserWindow})=>{
  const win=BrowserWindow.getAllWindows()[0];
  return {destroyed:win.isDestroyed(),visible:win.isVisible()};
});
async function waitFor(app:ElectronApplication,predicate:(state:{destroyed:boolean;visible:boolean})=>boolean){
  let state=await windowState(app);
  for(let i=0;i<50&&!predicate(state);i++){await sleep(100);state=await windowState(app);}
  return state;
}
async function cleanup(app:ElectronApplication,proc:ReturnType<ElectronApplication['process']>,data:string){
  // With minimize-to-tray on, a plain quit request only hides the window again, so the test
  // must not wait for it: ask politely, then kill after a short grace period.
  const exited=new Promise<void>(resolve=>{if(proc.exitCode!==null)resolve();else proc.once('exit',()=>resolve());});
  void app.close().catch(()=>undefined);
  await Promise.race([exited,sleep(5000)]);
  // The helper processes outlive the main one briefly, so end the whole tree.
  if(proc.exitCode===null&&proc.pid){spawnSync('taskkill',['/pid',String(proc.pid),'/T','/F'],{stdio:'ignore'});await Promise.race([exited,sleep(5000)]);}
  await sleep(500);
  // A leftover temporary directory must not fail an otherwise passing test.
  try{rmSync(data,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch{/* removed with the temp folder later */}
}

it('hides the window on minimize and on the close button while minimize-to-tray is on, and the app keeps running',async()=>{
  const {app,page,data,proc}=await launch(true);
  try{
    expect((await windowState(app)).visible).toBe(true);
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].minimize();});
    expect(await waitFor(app,state=>!state.visible)).toEqual({destroyed:false,visible:false});
    // The tray's Show item and a click both end in the same call.
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];if(win.isMinimized())win.restore();win.show();win.focus();});
    expect((await waitFor(app,state=>state.visible)).visible).toBe(true);
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});
    expect(await waitFor(app,state=>!state.visible)).toEqual({destroyed:false,visible:false});
    expect(proc.exitCode).toBeNull();
    // The hidden renderer is still alive and answering its API.
    expect(await page.evaluate(async()=>(await (window as any).profileApi.getSettings()).ok)).toBe(true);
  }finally{await cleanup(app,proc,data);}
},60000);

it('brings a hidden window back when the option is turned off',async()=>{
  const {app,page,data,proc}=await launch(true);
  try{
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});
    expect((await waitFor(app,state=>!state.visible)).visible).toBe(false);
    const saved=await page.evaluate(async()=>await (window as any).profileApi.updateSettings({language:'en',minimizeToTray:false}));
    expect(saved).toMatchObject({ok:true,value:{minimizeToTray:false}});
    expect(await waitFor(app,state=>state.visible)).toEqual({destroyed:false,visible:true});
  }finally{await cleanup(app,proc,data);}
},60000);

it('quits on the close button when minimize-to-tray is off',async()=>{
  const {app,data,proc}=await launch(false);
  try{
    const exited=new Promise<'exited'>(resolve=>proc.once('exit',()=>resolve('exited')));
    void app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();}).catch(()=>undefined);
    expect(await Promise.race([exited,sleep(20000).then(()=>'still running' as const)])).toBe('exited');
  }finally{await cleanup(app,proc,data);}
},60000);
