import {app,ipcMain,dialog,safeStorage,net,clipboard} from 'electron';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWriteStream,existsSync} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {ProfileService} from './profiles/service';
import {SecretStore} from './security/secrets';
import {EngineInstaller,type EngineRelease} from './engines/installation';
import type {EngineStatus} from '../shared/contracts';
import {ChromiumAdapter} from './engines/chromium';
import {gpuModelsFromDevices,gpuVendorsFromDevices} from './engines/gpu-vendor';
import {Supervisor} from './runtime/supervisor';
import {BackupService} from './backups/service';
import {CookieService} from './cookies/service';
import {createCookieOperations} from './cookies/operations';
import {PortableProfileService} from './portable/service';
import {ExtensionLibrary} from './extensions/library';
import {createPortableOperations} from './portable/operations';
import {checkProxy,IP_CHECK_SERVICE} from './proxy/check';
import {lookupCountry} from './proxy/country';
import {lookupCountryOnline} from './proxy/country-online';
import {createWindow} from './window';
import {createDispatcher,operations} from './ipc';
import {isTrustedSender} from './trust';
import releases from './engines/releases.json';
import {BUILD_INFO} from '../shared/build-info';
import {SessionStore} from './sessions/store';
import {AppSettingsService} from './settings/service';
import {nativeMessage} from '../shared/i18n/messages';
import {UpdateService} from './update/service';
import {AgentApiService} from './agent-api/service';
import {spawn} from 'node:child_process';
app.setName('Exodus Browser');
// Keep the existing data directory independent of the visible product name.
app.setPath('userData',join(app.getPath('appData'),'Local Profiles'));
// The development launcher can isolate its own userData for automated smoke tests.
if(process.env.LOCAL_PROFILES_DATA&&!app.isPackaged)app.setPath('userData',process.env.LOCAL_PROFILES_DATA);
if(!app.requestSingleInstanceLock())app.quit();
else void app.whenReady().then(async()=>{
  const root=app.getPath('userData');const secrets=new SecretStore(safeStorage);const profiles=new ProfileService(root,secrets);
  const installer=new EngineInstaller(join(root,'engine'),async(url,destination,onBytes)=>{
    const response=await net.fetch(url,{signal:AbortSignal.timeout(600000)});if(!response.ok||!response.body)throw Error('ENGINE_DOWNLOAD_FAILED');
    const total=Number(response.headers.get('content-length')??0)||null;
    let received=0;
    const counter=new Transform({transform(chunk,_encoding,callback){received+=chunk.length;onBytes?.(received,total);callback(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body as any),counter,createWriteStream(destination,{flags:'wx'}));
  });
  // Polled by the renderer once per second, so the download never looks frozen.
  let engineInstall:EngineStatus['progress']|null=null;
  const extensionVersion=(releases.release as EngineRelease|undefined)?.version??'156.0.8078.80';
  // Seven-Zip is needed to unpack Google's nested installer archives. The app ships
  // 7za.exe; a system installation is only a development fallback.
  const resolveSevenZip=()=>{
    if(process.env.LOCAL_PROFILES_SEVEN_ZIP)return process.env.LOCAL_PROFILES_SEVEN_ZIP;
    const bundled=app.isPackaged?join(process.resourcesPath,'bin','7z.exe'):join(app.getAppPath(),'resources','bin','7z.exe');
    if(existsSync(bundled))return bundled;
    return 'C:\\Program Files\\7-Zip\\7z.exe';
  };
  const downloadExtension=async(url:string,destination:string)=>{
    const response=await net.fetch(url,{signal:AbortSignal.timeout(60000)}).catch(()=>{throw Error('EXTENSION_DOWNLOAD_FAILED');});
    if(!response.ok||!response.body)throw Error('EXTENSION_DOWNLOAD_FAILED');
    let received=0;const limit=100*1024**2;
    await pipeline(Readable.fromWeb(response.body as never),new Transform({transform(chunk,_encoding,callback){received+=chunk.length;callback(received>limit?Error('EXTENSION_TOO_LARGE'):null,chunk);}}),createWriteStream(destination,{flags:'wx'}));
  };
  const extensions=new ExtensionLibrary(root,profiles.database,downloadExtension,extensionVersion);
  const hostGpuVendors=Promise.race([
    app.getGPUInfo('basic').then(info=>{const devices=(info as {gpuDevice?:Array<{vendorId?:number;deviceString?:string}>}).gpuDevice??[];return {vendors:gpuVendorsFromDevices(devices),models:gpuModelsFromDevices(devices)};}),
    new Promise<undefined>(resolve=>setTimeout(()=>resolve(undefined),2000)),
  ]).catch(()=>undefined);
  const sessions=new SessionStore(root);const settings=new AppSettingsService(root);const win=createWindow(BUILD_INFO.version);const ui=pathToFileURL(join(__dirname,'ui','index.html')).href;
  let currentLanguage=(await settings.getSettings()).language;
  const supervisor=new Supervisor(profiles,new ChromiumAdapter(()=>installer.resolveExecutable()),{sessions,extensionDirectory:id=>extensions.directoryFor(id),confirmTimezone:async()=>{
    if(win.isDestroyed())return false;
    const result=await dialog.showMessageBox(win,{type:'warning',buttons:[nativeMessage('cookie.clear.cancel',currentLanguage),nativeMessage('common.continue',currentLanguage)],defaultId:0,cancelId:0,noLink:true,message:nativeMessage('timezone.launch.title',currentLanguage),detail:nativeMessage('timezone.launch.detail',currentLanguage)});
    return !win.isDestroyed()&&result.response===1;
  }});await supervisor.recover();
  const agentApi=await AgentApiService.open({root,secrets,profiles,writer:{
    create:input=>profiles.create(input),
    start:id=>supervisor.start(id),
    stop:id=>supervisor.stop(id),
    states:()=>supervisor.states(),
    engineVersion:async()=>{const status=await installer.status();return status.state==='ready'?(status.version??null):null;},
    browser:id=>supervisor.browser(id),
  }});
  await agentApi.resume();
  const backups=new BackupService(profiles,supervisor,undefined,sessions);
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
    const finishShutdown=async()=>{try{// Stop admitting agent requests before browser work so a start cannot race shutdown.
      await agentApi.close();await Promise.all([cookies.closeAll(),portable.closeAll()]);await supervisor.shutdown();quitting=true;profiles.close();app.quit();}catch{await dialog.showMessageBox(win,{type:'error',message:nativeMessage('manager.close.error',currentLanguage)});closing=false;}};
    const update=new UpdateService({
      appVersion:BUILD_INFO.version,root,
      busy:async()=>supervisor.hasActiveWork()||cookies.hasActiveWork()||portable.hasActiveWork(),
      runInstaller:path=>new Promise<void>((resolve,reject)=>{const child=spawn(path,[],{detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});}),
      onState:state=>{if(!win.isDestroyed())win.webContents.send('app:update-state',state);},
    });
  const dispatcher=createDispatcher({
    list:()=>profiles.list(),create:input=>profiles.create(input),update:(id,input)=>supervisor.withStopped(id,()=>profiles.update(id,input)),
       remove:async id=>{await supervisor.withStopped(id,async()=>{await profiles.remove(id);await sessions.remove(id).catch(()=>undefined);});},
    start:id=>supervisor.start(id),stop:id=>supervisor.stop(id),states:async()=>supervisor.states(),warnings:async()=>supervisor.warnings(),engineStatus:async()=>{
       const status=await installer.status();
       const merged:EngineStatus=engineInstall?{...status,state:'installing',progress:engineInstall}:status;
       return {...merged,hostGpuVendors:(await hostGpuVendors)?.vendors,hostGpuModels:(await hostGpuVendors)?.models};
     },
    installEngine:async()=>{
      engineInstall={stage:'download',received:0,total:null};
      try{await installer.installBranded(resolveSevenZip(),progress=>{engineInstall=progress;});}
      finally{engineInstall=null;}
    },
    linkEngine:async()=>{
        const r=await dialog.showOpenDialog(win,{title:nativeMessage('engine.choose.title',currentLanguage),properties:['openFile'],filters:[{name:'Chromium',extensions:['exe']}]});
      if(!r.canceled)await installer.link(r.filePaths[0]);
    },
      backup:async id=>{await supervisor.assertStopped(id);const result=await dialog.showSaveDialog(win,{defaultPath:'profile-backup.zip',filters:[{name:nativeMessage('backup.filter',currentLanguage),extensions:['zip']}]});if(result.filePath&&!result.canceled)await backups.create(id,result.filePath);},
      restore:async()=>{const r=await dialog.showOpenDialog(win,{title:nativeMessage('backup.restore.title',currentLanguage),properties:['openFile'],filters:[{name:nativeMessage('backup.filter',currentLanguage),extensions:['zip']}]});return r.canceled?null:backups.restore(r.filePaths[0]);},
      exportProfile:portableOps.exportProfile,importProfile:portableOps.importProfile,
     checkProxy:async id=>{const input=profiles.getLaunchInput(id);if(!input.proxy)throw Error('NO_PROXY');const {ip}=await checkProxy(input.proxy);return {ip,countryCode:(await lookupCountryOnline(ip))??await lookupCountry(ip),service:IP_CHECK_SERVICE};},
    listProxies:async()=>profiles.listProxies(),createProxy:input=>profiles.createProxy(input),updateProxy:(id,input)=>profiles.updateProxy(id,input),removeProxy:id=>profiles.removeProxy(id),
     checkSavedProxy:async id=>{const {ip}=await checkProxy(profiles.getProxyInput(id));return {ip,countryCode:(await lookupCountryOnline(ip))??await lookupCountry(ip),service:IP_CHECK_SERVICE};},runningProxyVersions:async()=>supervisor.runningProxyVersions(),
     importCookies:cookieOps.importCookies,exportCookies:cookieOps.exportCookies,clearCookies:cookieOps.clearCookies,
      listExtensions:async()=>extensions.list(),
      addExtensionFolder:async()=>{const r=await dialog.showOpenDialog(win,{title:nativeMessage('extension.choose.folder',currentLanguage),properties:['openDirectory']});return r.canceled||!r.filePaths[0]?null:extensions.addFromFolder(r.filePaths[0]);},
      addExtensionZip:async()=>{const r=await dialog.showOpenDialog(win,{title:nativeMessage('extension.choose.zip',currentLanguage),properties:['openFile'],filters:[{name:'Extension archive',extensions:['zip']}]});return r.canceled||!r.filePaths[0]?null:extensions.addFromZip(r.filePaths[0]);},
      updateExtension:async extensionId=>{if(extensions.list().find(entry=>entry.id===extensionId)?.source==='store')return extensions.updateFromStore(extensionId);const r=await dialog.showOpenDialog(win,{title:nativeMessage('extension.choose.folder',currentLanguage),properties:['openDirectory']});return r.canceled||!r.filePaths[0]?null:extensions.updateFromFolder(extensionId,r.filePaths[0]);},
      addExtensionFromStore:async link=>extensions.addFromStore(link),
      removeExtension:async extensionId=>{await extensions.remove(extensionId);},
      getUpdateState:async()=>update.state(),checkForUpdate:()=>update.check(),downloadUpdate:()=>update.download(),cancelUpdate:()=>update.cancel(),
      installUpdate:async()=>{await update.install();await finishShutdown();},
      getSettings:()=>settings.getSettings(),updateSettings:async input=>{const value=await settings.updateSettings(input);currentLanguage=value.language;return value;},
      agentApiStatus:async()=>agentApi.status(),
      setAgentApiEnabled:async enabled=>{if(enabled)await agentApi.enable();else await agentApi.disable();return agentApi.status();},
      createAgentCredential:label=>agentApi.createCredential(label),
      revokeAgentCredential:id=>agentApi.revoke(id),
      grantAgentCredential:input=>agentApi.grant(input.kind,input.credentialId,input.resourceId),
      revokeAgentGrant:input=>agentApi.revokeGrant(input.kind,input.credentialId,input.resourceId),
      copyText:async text=>{clipboard.writeText(text);},
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
