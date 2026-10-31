import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';

const packageJson=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as Record<string,any>;

it('declares a pinned development-only electron-builder and the dist command',()=>{
  expect(packageJson.scripts.dist).toBe('node scripts/dist.mjs');
  expect(packageJson.devDependencies['electron-builder']).toMatch(/^\d+\.\d+\.\d+$/);
  expect(packageJson.dependencies['electron-builder']).toBeUndefined();
});

it('configures branded NSIS artifacts with native SQLite unpacked from asar',()=>{
  const build=packageJson.build;
  expect(packageJson.author).toBe('thejohnd0e');
  expect(build).toMatchObject({appId:'com.exodusbrowser.desktop',productName:'Exodus Browser',asar:true,npmRebuild:false});
  expect(build.directories.output).toBe('dist-install');
  expect(build.asarUnpack).toContain('**/node_modules/better-sqlite3/**');
  expect(build.win).toMatchObject({target:['nsis'],icon:'ico/exodus-icon.ico'});
  expect(build.nsis).toMatchObject({
    oneClick:false,
    perMachine:false,
    allowElevation:true,
    allowToChangeInstallationDirectory:true,
    createStartMenuShortcut:true,
    createDesktopShortcut:false,
    runAfterFinish:true,
    installerLanguages:['en_US'],
    include:'build/installer.nsh',
    artifactName:'ExodusBrowser-Setup-${version}.${ext}',
  });
});

it('offers an optional desktop shortcut on the installer finish page',()=>{
  const include=readFileSync(new URL('../../build/installer.nsh',import.meta.url),'utf8');
  expect(include).toContain('!macro customFinishPage');
  expect(include).toContain('Create a desktop shortcut');
  expect(include).toContain('CreateShortCut');
});
