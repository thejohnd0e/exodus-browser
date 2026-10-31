import {it,expect,vi} from 'vitest';
import {createCookieOperations} from '../../src/main/cookies/operations';
import {nativeMessage} from '../../src/shared/i18n/messages';
const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';
it('opens the dialog, passes the path to the service and returns the file name',async()=>{
  const importFile=vi.fn(async()=>({count:2,fileName:'a.json'}));
  const ops=createCookieOperations({cookies:{importFile,exportFile:vi.fn(),closeAll:vi.fn()} as never,showOpen:async()=>({canceled:false,filePaths:['C:\\c\\a.json']}),showSave:vi.fn()});
  await expect(ops.importCookies(id)).resolves.toEqual({count:2,fileName:'a.json'});
  expect(importFile).toHaveBeenCalledWith(id,'C:\\c\\a.json');
});
it('returns null on cancel and selects the extension for the format',async()=>{
  const exportFile=vi.fn(async()=>({count:1,fileName:'cookies.txt'}));const showSave=vi.fn(async(o:{defaultPath:string})=>({canceled:false,filePath:o.defaultPath}));
  const ops=createCookieOperations({cookies:{importFile:vi.fn(),exportFile,closeAll:vi.fn()} as never,showOpen:async()=>({canceled:true,filePaths:[]}),showSave});
  expect(await ops.importCookies(id)).toBeNull();
  await ops.exportCookies(id,'netscape');
  expect(showSave.mock.calls[0][0].defaultPath).toBe('cookies.txt');
  expect(exportFile).toHaveBeenCalledWith(id,'cookies.txt','netscape');
  const cancel=createCookieOperations({cookies:{importFile:vi.fn(),exportFile,closeAll:vi.fn()} as never,showOpen:vi.fn(),showSave:async()=>({canceled:true})});
  expect(await cancel.exportCookies(id,'json')).toBeNull();
});
it('runs cookie clearing only when invoked by the renderer',async()=>{
 const clear=vi.fn(async()=>({cleared:true as const}));
 const operations=createCookieOperations({cookies:{importFile:vi.fn(),exportFile:vi.fn(),clear},showOpen:vi.fn(),showSave:vi.fn()});
 await expect(operations.clearCookies(id)).resolves.toEqual({cleared:true});expect(clear).toHaveBeenCalledWith(id);
});
it('localizes open and save dialog labels from the selected application language',async()=>{
 const opened:unknown[]=[];const saved:unknown[]=[];
 const ops=createCookieOperations({cookies:{importFile:vi.fn(async()=>({count:1,fileName:'cookies.json'})),exportFile:vi.fn(async()=>({count:1,fileName:'cookies.txt'})),clear:vi.fn()} as never,language:'ru',showOpen:async options=>{opened.push(options);return {canceled:true,filePaths:[]};},showSave:async options=>{saved.push(options);return {canceled:true};}});
 await ops.importCookies(id);await ops.exportCookies(id,'netscape');
 expect(opened[0]).toMatchObject({title:nativeMessage('cookie.import.title','ru'),filters:[{name:nativeMessage('cookie.filter','ru')}]});
 expect(saved[0]).toMatchObject({filters:[{name:nativeMessage('cookie.export.netscape','ru')}]});
});
