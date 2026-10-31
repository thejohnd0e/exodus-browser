import {it,expect,vi} from 'vitest';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const construction=vi.hoisted(()=>({options:{} as Record<string,unknown>,menu:undefined as unknown,openHandler:undefined as ((details:{url:string})=>unknown)|undefined,openExternal:vi.fn(async()=>undefined)}));
vi.mock('electron',()=>({shell:{openExternal:construction.openExternal},BrowserWindow:class{
  constructor(options:Record<string,unknown>){construction.options=options;}
  setMenu(menu:unknown){construction.menu=menu;}
  webContents={setWindowOpenHandler:(handler:(details:{url:string})=>unknown)=>{construction.openHandler=handler;},on:vi.fn(),session:{setPermissionRequestHandler:vi.fn()}};
}}));
vi.mock('../../ico/exodus-icon.png',()=>({default:'assets/exodus-icon.png'}));

import {createWindow} from '../../src/main/window';

it('provides the bundled Exodus icon to the native window without weakening isolation',()=>{
  createWindow();
  const moduleDirectory=dirname(fileURLToPath(new URL('../../src/main/window.ts',import.meta.url)));
  expect(construction.options.icon).toBe(join(moduleDirectory,'assets','exodus-icon.png'));
  expect(construction.options.title).toBe('Exodus Browser');
  expect(construction.options.webPreferences).toMatchObject({contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true});
});

it('removes the native application menu',()=>{
  createWindow();
  expect(construction.menu).toBeNull();
});

it('opens only the exact project repository externally',async()=>{
  construction.openExternal.mockClear();createWindow();const handler=construction.openHandler!;
  expect(handler({url:'https://github.com/thejohnd0e/exodus-browser'})).toEqual({action:'deny'});
  await Promise.resolve();
  expect(construction.openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com/thejohnd0e/exodus-browser');
  for(const url of ['https://github.com.attacker.example/thejohnd0e/exodus-browser','https://user@github.com/thejohnd0e/exodus-browser','http://github.com/thejohnd0e/exodus-browser','https://github.com/thejohnd0e/exodus-browser/issues','https://github.com/thejohnd0e/exodus-browser?x=1','https://github.com/thejohnd0e/exodus-browser#top','javascript:alert(1)']){
    expect(handler({url})).toEqual({action:'deny'});
  }
  await Promise.resolve();
  expect(construction.openExternal).toHaveBeenCalledTimes(1);
});

it('opens only the canonical DB-IP attribution link externally while denying renderer windows',async()=>{
  construction.openExternal.mockClear();createWindow();const handler=construction.openHandler!;
  expect(handler({url:'https://db-ip.com/'})).toEqual({action:'deny'});
  expect(handler({url:'https://db-ip.com.attacker.example/'})).toEqual({action:'deny'});
  expect(handler({url:'file:///secret'})).toEqual({action:'deny'});
  await Promise.resolve();
  expect(construction.openExternal).toHaveBeenCalledExactlyOnceWith('https://db-ip.com/');
});
