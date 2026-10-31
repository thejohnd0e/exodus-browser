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
import {PortableProfileService} from './portable/service';
import {createPortableOperations} from './portable/operations';
import {checkProxy,IP_CHECK_SERVICE} from './proxy/check';
import {lookupCountry} from './proxy/country';
import {createWindow} from './window';
import {createDispatcher,operations} from './ipc';
import {isTrustedSender} from './trust';
import releases from './engines/releases.json';
import {BUILD_INFO} from '../shared/build-info';
import {SessionStore} from './sessions/store';
import {AppSettingsService} from './settings/service';
import {nativeMessage} from '../shared/i18n/messages';
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
  const sessions=new SessionStore(root);const settings=new AppSettingsService(root);const supervisor=new Supervisor(profiles,new ChromiumAdapter(()=>installer.resolveExecutable()),{sessions});await supervisor.recover();
  const backups=new BackupService(profiles,supervisor,undefined,sessions);const win=createWindow(BUILD_INFO.version);const ui=pathToFileURL(join(__dirname,'ui','index.html')).href;
  let currentLanguage=(await settings.getSettings()).language;
   const cookies=new CookieService(profiles,supervisor,installer);const portable=new PortableProfileService(profiles,supervisor,installer,sessions);
  const cookieOps=createCookieOperations({
    cookies,
    language:()=>currentLanguage,
     showOpen:options=>dialog.showOpenDialog(win,options as Electron.OpenDialogOptions),
     showSave:options=>dialog.showSaveDialog(win,options as Electron.SaveDialogOptions),
  });
    const portableOps=createPortableOperations({portable,language:()=>currentLanguage,
      showOpen:options=>dialog.showOpenDialog(win,options as Electron.OpenDialogOptions),
      showSave:options=>dialog.showSaveDialog(win,options as Electron.SaveDialogOptions),
   });
    let quitting=false,closing=false;
    const finishShutdown=async()=>{try{await Promise.all([cookies.closeAll(),portable.closeAll()]);await supervisor.shutdown();quitting=true;profiles.close();app.quit();}catch{await dialog.showMessageBox(win,{type:'error',message:nativeMessage('manager.close.error',currentLanguage)});closing=false;}};
  const dispatcher=createDispatcher({
    list:()=>profiles.list(),create:input=>profiles.create(input),update:(id,input)=>supervisor.withStopped(id,()=>profiles.update(id,input)),
       remove:async id=>{await supervisor.withStopped(id,async()=>{await profiles.remove(id);await sessions.remove(id).catch(()=>undefined);});},
    start:id=>supervisor.start(id),stop:id=>supervisor.stop(id),states:async()=>supervisor.states(),engineStatus:()=>installer.status(),
    installEngine:async()=>{
      if(!releases.release)throw Error('ENGINE_RELEASE_UNPINNED');
       await installer.install(releases.release as EngineRelease);
    },
    linkEngine:async()=>{
        const r=await dialog.showOpenDialog(win,{title:nativeMessage('engine.choose.title',currentLanguage),properties:['openFile'],filters:[{name:'Chromium',extensions:['exe']}]});
      if(!r.canceled)await installer.link(r.filePaths[0]);
    },
      backup:async id=>{await supervisor.assertStopped(id);const result=await dialog.showSaveDialog(win,{defaultPath:'profile-backup.zip',filters:[{name:nativeMessage('backup.filter',currentLanguage),extensions:['zip']}]});if(result.filePath&&!result.canceled)await backups.create(id,result.filePath);},
      restore:async()=>{const r=await dialog.showOpenDialog(win,{title:nativeMessage('backup.restore.title',currentLanguage),properties:['openFile'],filters:[{name:nativeMessage('backup.filter',currentLanguage),extensions:['zip']}]});return r.canceled?null:backups.restore(r.filePaths[0]);},
      exportProfile:portableOps.exportProfile,importProfile:portableOps.importProfile,
     checkProxy:async id=>{const input=profiles.getLaunchInput(id);if(!input.proxy)throw Error('NO_PROXY');const {ip}=await checkProxy(input.proxy);return {ip,countryCode:await lookupCountry(ip),service:IP_CHECK_SERVICE};},
    listProxies:async()=>profiles.listProxies(),createProxy:input=>profiles.createProxy(input),updateProxy:(id,input)=>profiles.updateProxy(id,input),removeProxy:id=>profiles.removeProxy(id),
     checkSavedProxy:async id=>{const {ip}=await checkProxy(profiles.getProxyInput(id));return {ip,countryCode:await lookupCountry(ip),service:IP_CHECK_SERVICE};},runningProxyVersions:async()=>supervisor.runningProxyVersions(),
     importCookies:cookieOps.importCookies,exportCookies:cookieOps.exportCookies,clearCookies:cookieOps.clearCookies,
      getSettings:()=>settings.getSettings(),updateSettings:async input=>{const value=await settings.updateSettings(input);currentLanguage=value.language;return value;}
   },event=>isTrustedSender(event as never,win.webContents,ui),()=>currentLanguage);
   for(const method of operations)ipcMain.handle('profiles:'+method,(event,...args)=>dispatcher(event,method,args));
   ipcMain.handle('app:close-decision',(event,decision)=>{if(!isTrustedSender(event as never,win.webContents,ui)||typeof decision!=='boolean')return false;if(!closing)return false;if(!decision){closing=false;return true;}void finishShutdown();return true;});
   win.on('close',event=>{
     if(quitting)return;event.preventDefault();if(closing)return;closing=true;
     if(Object.values(supervisor.states()).some(s=>['running','starting','stopping','blocked'].includes(s)))win.webContents.send('app:close-requested');
     else void finishShutdown();
   });
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
  await win.loadFile(join(__dirname,'ui','index.html'));
}).catch(()=>{dialog.showErrorBox('Exodus Browser','Could not open local storage. Check access to the application directory.');app.exit(1);});
