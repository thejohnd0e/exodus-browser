import {BrowserWindow} from 'electron';
import {join} from 'node:path';
export function createWindow(){
  const win=new BrowserWindow({width:1200,height:820,minWidth:920,minHeight:640,backgroundColor:'#10151e',title:'Exodus Browser',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  return win;
}
