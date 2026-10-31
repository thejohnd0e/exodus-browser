import {BrowserWindow,shell} from 'electron';
import {join} from 'node:path';
import icon from '../../ico/exodus-icon.png';
export function createWindow(version=''){
  const win=new BrowserWindow({width:1200,height:820,minWidth:920,minHeight:640,backgroundColor:'#10151e',title:`Exodus Browser${version?` v${version}`:''}`,icon:join(__dirname,icon),webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(({url})=>{try{const target=new URL(url);if(target.protocol==='https:'&&target.hostname==='db-ip.com'&&target.pathname==='/'&&!target.search&&!target.hash)void shell.openExternal('https://db-ip.com/').catch(()=>undefined);}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  return win;
}
