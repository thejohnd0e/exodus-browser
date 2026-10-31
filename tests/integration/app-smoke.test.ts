import {it,expect} from 'vitest';
import {_electron as electron} from 'playwright';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {fileURLToPath} from 'node:url';
const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';
it('loads the supplied wordmark, favicon and native icon from the built application',async()=>{
  const data=mkdtempSync(join(tmpdir(),'exodus-branding-'));
  const app=await electron.launch({args:['.'],env:{...process.env,LOCAL_PROFILES_DATA:data}});
  try{
    const win=await app.firstWindow();await win.waitForSelector('h1');
    const wordmark=win.getByRole('img',{name:'Exodus Browser'});
    expect(await wordmark.count()).toBe(1);
    await win.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.brand img');return image?.complete&&image.naturalWidth>0;});
    const wordmarkUrl=await wordmark.getAttribute('src');
    expect(wordmarkUrl).toBeTruthy();
    const loadedWordmark=new URL(wordmarkUrl!,win.url());
    expect(loadedWordmark.protocol).toBe('file:');
    expect(readFileSync(fileURLToPath(loadedWordmark)).equals(readFileSync(join(process.cwd(),'ico','exodus-wordmark.png')))).toBe(true);
    const favicon=await win.locator('link[rel="icon"]').getAttribute('href');
    expect(favicon).toBeTruthy();
    const faviconUrl=new URL(favicon!,win.url());
    expect(faviconUrl.protocol).toBe('file:');
    const source=readFileSync(join(process.cwd(),'ico','exodus-icon.png'));
    expect(readFileSync(fileURLToPath(faviconUrl)).equals(source)).toBe(true);
    const nativePath=join(process.cwd(),'dist','assets','exodus-icon.png');
    expect(readFileSync(nativePath).equals(source)).toBe(true);
    expect(await app.evaluate(({nativeImage},path)=>nativeImage.createFromPath(path).isEmpty(),nativePath)).toBe(false);
    for(const width of [1200,940]){
      await win.setViewportSize({width,height:820});
      const image=await wordmark.boundingBox(),sidebar=await win.locator('aside').boundingBox();
      expect(image).not.toBeNull();expect(sidebar).not.toBeNull();
      expect(image!.width).toBeGreaterThanOrEqual(228);
      expect(image!.x+image!.width).toBeLessThanOrEqual(sidebar!.x+sidebar!.width);
    }
  }finally{await app.close();rmSync(data,{recursive:true,force:true});}
},30000);

it('keeps the fingerprint action opaque and readable without hovering in the profile editor',async()=>{
  const data=mkdtempSync(join(tmpdir(),'local-profiles-button-'));
  const app=await electron.launch({args:['.'],env:{...process.env,LOCAL_PROFILES_DATA:data}});
  try{
    const win=await app.firstWindow();await win.waitForSelector('h1');
    expect(await app.evaluate(({app})=>({name:app.getName(),data:app.getPath('userData')}))).toEqual({name:'Exodus Browser',data});
    const version=await win.locator('.build-version').textContent();
    expect(version).toMatch(/^v0\.1\.\d+$/);
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getTitle())).toBe(`Exodus Browser ${version}`);
    expect(await win.evaluate(()=>document.documentElement.lang)).toBe('en');
    await win.getByRole('button',{name:'＋ New profile',exact:true}).click();
    await win.mouse.move(0,0);
    const action=win.getByRole('button',{name:'New fingerprint',exact:true});
    await action.waitFor();
    // No engine is needed: inspect the real button's paint independently of disabled opacity.
    const paint=await action.evaluate(element=>{
      const style=getComputedStyle(element);
      const channels=(color:string)=>color.match(/[\d.]+/g)!.map(Number);
      const background=channels(style.backgroundColor),foreground=channels(style.color);
      const luminance=(rgb:number[])=>rgb.slice(0,3).map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      const a=luminance(background),b=luminance(foreground);
      return {hovered:element.matches(':hover'),alpha:background[3]??1,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
    });
    expect(paint.hovered).toBe(false);
    expect(paint.alpha,'the action must not inherit the close button transparent background').toBe(1);
    expect(paint.contrast).toBeGreaterThanOrEqual(4.5);
    const close=win.getByRole('button',{name:'Close editor',exact:true});
    expect(await close.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  }finally{await app.close();rmSync(data,{recursive:true,force:true});}
},30000);

it('opens isolated local app, creates a profile offline, stores proxy secrets with DPAPI and makes no non-local requests',async()=>{
  const data=mkdtempSync(join(tmpdir(),'local-profiles-e2e-'));
  const launch=()=>electron.launch({args:['.'],env:{...process.env,LOCAL_PROFILES_DATA:data}});
  let app=await launch();
  try{
    await app.evaluate(({session})=>{const urls:string[]=[];(globalThis as any).__requests=urls;session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{urls.push(details.url);callback({});});});
    const win=await app.firstWindow();await win.waitForSelector('h1');
    const created=await win.evaluate(async()=>{const api=(window as any).profileApi;const proxy=await api.createProxy({name:'Test',kind:'http',host:'127.0.0.1',port:3128,username:'u',password:'proxy-password'});if(!proxy.ok)throw Error('proxy creation failed');return api.create({name:'Test profile',note:'',startUrls:['about:blank'],languages:['ru-RU'],proxyId:proxy.value.id,fingerprint:{os:'windows11',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36',webRtc:'real',canvas:'noise',webgl:'real',webglInfo:{mode:'real'},webgpu:'on',clientRects:'real',audio:'real',timezone:{mode:'auto'},geolocation:{mode:'auto'},hardware:{mode:'real'},screen:{mode:'real'}}});});
    expect(created.ok).toBe(true);
    await win.getByText('Test profile').waitFor();
    const surface=await win.evaluate(()=>{const api=(window as any).profileApi;return {keys:Object.keys(api),noNode:(window as any).require===undefined&&(window as any).process===undefined};});
    expect(surface.keys).toEqual(['list','create','update','remove','start','stop','states','engineStatus','installEngine','linkEngine','backup','restore','checkProxy','listProxies','createProxy','updateProxy','removeProxy','checkSavedProxy','runningProxyVersions','importCookies','exportCookies']);
    expect(surface.noNode).toBe(true);
    expect(JSON.stringify(created)).not.toContain('proxy-password');
    const requests=await app.evaluate(()=>(globalThis as any).__requests as string[]);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter(u=>!u.startsWith('file://')&&!u.startsWith('devtools://')&&!u.startsWith('data:'))).toEqual([]);
  }finally{await app.close();}
  const dbBytes=readFileSync(join(data,'profiles.sqlite'));
  expect(dbBytes.includes(Buffer.from('proxy-password'))).toBe(false);
  const db=new Database(join(data,'profiles.sqlite'),{readonly:true});
  const row=db.prepare('SELECT secret FROM proxies LIMIT 1').get() as {secret:Buffer};
  db.close();expect(row.secret.length).toBeGreaterThan(0);
  app=await launch();
  try{
    const win=await app.firstWindow();await win.waitForSelector('h1');
    const decrypted=await app.evaluate(({safeStorage},blob)=>safeStorage.decryptString(Buffer.from(blob)),[...row.secret]);
    expect(decrypted).toBe('proxy-password');
    const listed=await win.evaluate(async()=>(window as any).profileApi.list());
    expect(listed.ok).toBe(true);expect(listed.value[0].proxy.hasPassword).toBe(true);expect(JSON.stringify(listed)).not.toContain('proxy-password');
    expect(listed.value[0].fingerprint).toMatchObject({canvas:'noise',webgl:'real',os:'windows11'});
    await win.getByText('Windows 11 · Canvas: Noise · WebGL: Real').waitFor();
  }finally{await app.close();rmSync(data,{recursive:true,force:true});}
},90000);

it('checks the selected proxy from the UI without a confirmation dialog or background checks',async()=>{
 const data=mkdtempSync(join(tmpdir(),'local-profiles-ip-'));
 const requests:string[]=[];
 const proxy=createServer((req,res)=>{requests.push(req.url??'');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ip:'192.0.2.42'}));});
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const port=(proxy.address() as AddressInfo).port;
 const app=await electron.launch({args:['.'],env:{...process.env,LOCAL_PROFILES_DATA:data}});
 try{
   await app.evaluate(({dialog})=>{(globalThis as any).__dialogCalls=0;dialog.showMessageBox=(()=>{(globalThis as any).__dialogCalls++;throw Error('Unexpected confirmation dialog');}) as typeof dialog.showMessageBox;});
   const win=await app.firstWindow();await win.waitForSelector('h1');
   const result=await win.evaluate(async proxyPort=>{const api=(window as any).profileApi;const proxy=await api.createProxy({name:'Loopback',kind:'http',host:'127.0.0.1',port:proxyPort});if(!proxy.ok)throw Error('proxy creation failed');return api.create({name:'IP check',note:'',startUrls:['about:blank'],languages:['ru-RU'],proxyId:proxy.value.id});},port);
   expect(result.ok).toBe(true);
   const card=win.locator('article').filter({has:win.getByRole('heading',{name:'IP check'})});
   await card.getByRole('heading',{name:'IP check'}).waitFor({timeout:3000});
   expect(requests).toEqual([]);
   await card.getByRole('button',{name:'Check IP'}).click();
   await win.getByRole('alert').or(card.getByText('External IP: 192.0.2.42',{exact:true})).waitFor({timeout:5000});
   expect(await app.evaluate(()=>(globalThis as any).__dialogCalls)).toBe(0);
   await card.getByText('External IP: 192.0.2.42',{exact:true}).waitFor({timeout:5000});
   await card.getByText(/api\.ipify\.org.*HTTP/).waitFor();
   expect(requests).toEqual(['http://api.ipify.org/?format=json']);
   expect(await app.evaluate(()=>(globalThis as any).__dialogCalls)).toBe(0);
   expect(await win.getByRole('alert').count()).toBe(0);
 }finally{
   await app.close();
   await new Promise<void>((resolve,reject)=>proxy.close(error=>error?reject(error):resolve()));
   rmSync(data,{recursive:true,force:true});
 }
},30000);
