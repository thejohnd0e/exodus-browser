import {it,expect,vi} from 'vitest';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const construction=vi.hoisted(()=>({options:{} as Record<string,unknown>}));
vi.mock('electron',()=>({BrowserWindow:class{
  constructor(options:Record<string,unknown>){construction.options=options;}
  webContents={setWindowOpenHandler:vi.fn(),on:vi.fn(),session:{setPermissionRequestHandler:vi.fn()}};
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
