import {it,expect} from 'vitest';
import {writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromiumArgs} from '../../src/main/engines/chromium';
import {EngineInstaller} from '../../src/main/engines/installation';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {tempRoot,cleanup} from '../fixtures/profiles';
it('keeps Unicode path as one argument and never exposes secrets',()=>{
  const args=chromiumArgs({profileId:'test',userDataDir:'C:\\Profiles with spaces \u00e9\\a',languages:['ru-RU'],startUrls:['about:blank','https://example.com'],proxyUrl:'http://127.0.0.1:1234',fingerprint:DEFAULT_FINGERPRINT,extensionDirs:['C:\\Extensions\\a','C:\\Extensions\\b']});
  expect(args).toContain('--user-data-dir=C:\\Profiles with spaces \u00e9\\a');
  expect(args).toContain('--proxy-bypass-list=<-loopback>');
  expect(args).toContain('--remote-debugging-pipe');
  expect(args).toContain('--hide-crash-restore-bubble');
  expect(args.some(a=>a.startsWith('--remote-debugging-port'))).toBe(false);
  expect(args.some(a=>a.includes('no-sandbox')||a.includes('remote-debugging-address'))).toBe(false);
  // Extensions are loaded through the pipe, not by switches that Google Chrome ignores.
  expect(args.some(arg=>arg.startsWith('--load-extension')||arg.startsWith('--disable-extensions-except'))).toBe(false);
  expect(args.some(arg=>arg==='--disable-extensions')).toBe(false);
  expect(args.at(-1)).toBe('about:blank');
});
it('keeps the DevTools pipe from turning on the native automation signal',()=>{
  // --remote-debugging-pipe alone makes navigator.webdriver true in every realm; see DECISIONS.md #58.
  const args=chromiumArgs({profileId:'test',userDataDir:'C:\\p',languages:['en-US'],startUrls:[],fingerprint:DEFAULT_FINGERPRINT});
  expect(args).toContain('--disable-blink-features=AutomationControlled');
  expect(args.filter(a=>a.startsWith('--disable-blink-features')||a.startsWith('--enable-automation'))).toEqual(['--disable-blink-features=AutomationControlled']);
});
it('suppresses the unsupported-flag infobar caused by the automation switch',()=>{
  // Chromium lists --disable-blink-features in kBadFlags and shows a closable warning bar on every launch.
  // --test-type is the only measured way to keep that bar out of a stock CfT window (DECISIONS.md #59).
  const args=chromiumArgs({profileId:'test',userDataDir:'C:\\p',languages:['en-US'],startUrls:[],fingerprint:DEFAULT_FINGERPRINT});
  expect(args).toContain('--test-type');
});
it('hides the Chrome for Testing banner',()=>{
  // CfT renders a permanent "only for automated testing" bar. --disable-infobars is a CfT-only
  // switch (v121+) that removes non-interactive infobars; retail Chrome ignores it (DECISIONS.md #60).
  const args=chromiumArgs({profileId:'test',userDataDir:'C:\\p',languages:['en-US'],startUrls:[],fingerprint:DEFAULT_FINGERPRINT});
  expect(args).toContain('--disable-infobars');
});
it('links an explicitly chosen Chromium, pins its hash and rejects a replaced binary',async()=>{
  const root=tempRoot();
  try{
    const dir=join(root,'chrome-win64');await mkdir(dir,{recursive:true});const exe=join(dir,'chrome.exe');await writeFile(exe,'binary');
    const installer=new EngineInstaller(join(root,'engine'),async()=>{});
    await installer.link(exe);
    expect(await installer.status()).toEqual({state:'ready',version:'linked Chromium',source:'external'});
    expect(await installer.resolveExecutable()).toBe(exe);
    await writeFile(exe,'replaced');
    expect((await installer.status()).state).toBe('missing');
  }finally{cleanup(root);}
});
it('refuses to link an arbitrary executable name',async()=>{
  const root=tempRoot();
  try{const exe=join(root,'other.exe');await writeFile(exe,'x');const installer=new EngineInstaller(join(root,'engine'),async()=>{});
    await expect(installer.link(exe)).rejects.toThrow('UNSAFE_ENGINE');
  }finally{cleanup(root);}
});
it('rejects a pinned release whose URL does not match the declared version',async()=>{
  const root=tempRoot();
  try{const installer=new EngineInstaller(root,async()=>{});
    await expect(installer.install({version:'1.2.3.4',url:'https://storage.googleapis.com/chrome-for-testing-public/9.9.9.9/win64/chrome-win64.zip',sha256:'a'.repeat(64)})).rejects.toThrow('UNTRUSTED_ENGINE_RELEASE');
  }finally{await rm(root,{recursive:true,force:true});}
});
