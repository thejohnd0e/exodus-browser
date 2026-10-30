import {app,ipcMain,dialog,safeStorage,net} from 'electron';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {ProfileService} from './profiles/service';
import {SecretStore} from './security/secrets';
import {EngineInstaller,type EngineRelease} from './engines/installation';
import {ChromiumAdapter} from './engines/chromium';
import {Supervisor} from './runtime/supervisor';
import {BackupService} from './backups/service';
import {CookieService} from './cookies/service';
import {createCookieOperations} from './cookies/operations';
import {checkProxy,IP_CHECK_SERVICE} from './proxy/check';
import {createWindow} from './window';
import {createDispatcher,operations} from './ipc';
import {isTrustedSender} from './trust';
import releases from './engines/releases.json';
app.setName('Exodus Browser');
// Keep the existing data directory independent of the visible product name.
app.setPath('userData',join(app.getPath('appData'),'Local Profiles'));
// The development launcher can isolate its own userData for automated smoke tests.
if(process.env.LOCAL_PROFILES_DATA&&!app.isPackaged)app.setPath('userData',process.env.LOCAL_PROFILES_DATA);
if(!app.requestSingleInstanceLock())app.quit();
else void app.whenReady().then(async()=>{
  const root=app.getPath('userData');const profiles=new ProfileService(root,new SecretStore(safeStorage));
  const installer=new EngineInstaller(join(root,'engine'),async(url,destination)=>{
    const response=await net.fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok||!response.body)throw Error('ENGINE_DOWNLOAD_FAILED');
    await pipeline(Readable.fromWeb(response.body as any),createWriteStream(destination,{flags:'wx'}));
  });
  const supervisor=new Supervisor(profiles,new ChromiumAdapter(()=>installer.resolveExecutable()));await supervisor.recover();
  const backups=new BackupService(profiles,supervisor);const win=createWindow();const ui=pathToFileURL(join(__dirname,'ui','index.html')).href;
  const cookies=new CookieService(profiles,supervisor,installer);
  const cookieOps=createCookieOperations({
    cookies,
    showOpen:options=>dialog.showOpenDialog(win,options as Electron.OpenDialogOptions),
    showSave:options=>dialog.showSaveDialog(win,options as Electron.SaveDialogOptions),
  });
  let quitting=false,closing=false;
  const dispatcher=createDispatcher({
    list:()=>profiles.list(),create:input=>profiles.create(input),update:(id,input)=>supervisor.withStopped(id,()=>profiles.update(id,input)),
    remove:async id=>{const choice=await dialog.showMessageBox(win,{type:'warning',message:'Delete this profile and all its data?',buttons:['Cancel','Delete'],defaultId:0,cancelId:0});if(choice.response===1)await supervisor.withStopped(id,()=>profiles.remove(id));},
    start:id=>supervisor.start(id),stop:id=>supervisor.stop(id),states:async()=>supervisor.states(),engineStatus:()=>installer.status(),
    installEngine:async()=>{
      if(!releases.release)throw Error('ENGINE_RELEASE_UNPINNED');
      const c=await dialog.showMessageBox(win,{type:'question',message:'Download a separate Chromium from the official Google server?',buttons:['Cancel','Download'],cancelId:0,defaultId:0});
      if(c.response===1)await installer.install(releases.release as EngineRelease);
    },
    linkEngine:async()=>{
      const c=await dialog.showMessageBox(win,{type:'question',message:'Use an existing Chromium installation? The application will pin the SHA-256 of chrome.exe and run it separately for each profile. Selecting the file means you trust its origin.',buttons:['Cancel','Choose chrome.exe'],cancelId:0,defaultId:0});
      if(c.response!==1)return;
      const r=await dialog.showOpenDialog(win,{title:'Choose chrome.exe from Chromium',properties:['openFile'],filters:[{name:'Chromium',extensions:['exe']}]});
      if(!r.canceled)await installer.link(r.filePaths[0]);
    },
    backup:async id=>{await supervisor.assertStopped(id);const c=await dialog.showMessageBox(win,{type:'warning',message:'The backup contains cookies and other sensitive data. Keep it in a safe place. The proxy password is not included.',buttons:['Cancel','Continue'],cancelId:0,defaultId:0});if(c.response!==1)return;const result=await dialog.showSaveDialog(win,{defaultPath:'profile-backup.zip',filters:[{name:'Profile backup',extensions:['zip']}]});if(result.filePath&&!result.canceled)await backups.create(id,result.filePath);},
    restore:async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Profile backup',extensions:['zip']}]});return r.canceled?null:backups.restore(r.filePaths[0]);},
    checkProxy:async id=>{const input=profiles.getLaunchInput(id);if(!input.proxy)throw Error('NO_PROXY');return {...await checkProxy(input.proxy),service:IP_CHECK_SERVICE};},
    listProxies:async()=>profiles.listProxies(),createProxy:input=>profiles.createProxy(input),updateProxy:(id,input)=>profiles.updateProxy(id,input),removeProxy:id=>profiles.removeProxy(id),
    checkSavedProxy:async id=>({...await checkProxy(profiles.getProxyInput(id)),service:IP_CHECK_SERVICE}),runningProxyVersions:async()=>supervisor.runningProxyVersions(),
    importCookies:cookieOps.importCookies,exportCookies:cookieOps.exportCookies
  },event=>isTrustedSender(event as never,win.webContents,ui));
  for(const method of operations)ipcMain.handle('profiles:'+method,(event,...args)=>dispatcher(event,method,args));
  win.on('close',event=>{
    if(quitting)return;event.preventDefault();if(closing)return;closing=true;
    void(async()=>{
      try{const active=Object.values(supervisor.states()).some(s=>['running','starting','stopping','blocked'].includes(s));
        if(active){const r=await dialog.showMessageBox(win,{type:'question',message:'Stop browsers and close the manager? Windows left after a crash must be closed manually.',buttons:['Cancel','Stop and exit'],cancelId:0,defaultId:0});if(r.response!==1)return;}
        await cookies.closeAll();await supervisor.shutdown();quitting=true;profiles.close();app.quit();
      }catch{await dialog.showMessageBox(win,{type:'error',message:'Could not stop the browser. Close its window manually and try exiting again.'});}
      finally{closing=false;}
    })();
  });
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
  await win.loadFile(join(__dirname,'ui','index.html'));
}).catch(()=>{dialog.showErrorBox('Exodus Browser','Could not open local storage. Check access to the application directory.');app.exit(1);});
