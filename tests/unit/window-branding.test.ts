import {it,expect,vi} from 'vitest';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const construction=vi.hoisted(()=>({options:{} as Record<string,unknown>,openHandler:undefined as ((details:{url:string})=>unknown)|undefined,openExternal:vi.fn(async()=>undefined)}));
vi.mock('electron',()=>({shell:{openExternal:construction.openExternal},BrowserWindow:class{
  constructor(options:Record<string,unknown>){construction.options=options;}
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

it('opens only the canonical DB-IP attribution link externally while denying renderer windows',async()=>{
  createWindow();const handler=construction.openHandler!;
  expect(handler({url:'https://db-ip.com/'})).toEqual({action:'deny'});
  expect(handler({url:'https://db-ip.com.attacker.example/'})).toEqual({action:'deny'});
  expect(handler({url:'file:///secret'})).toEqual({action:'deny'});
  await Promise.resolve();
  expect(construction.openExternal).toHaveBeenCalledExactlyOnceWith('https://db-ip.com/');
});
