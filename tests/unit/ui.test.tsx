// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within,act} from '@testing-library/react';
import {App} from '../../src/renderer/App';
import type {ProfileApi,Profile,SavedProxy} from '../../src/shared/contracts';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {ru} from '../../src/shared/i18n/ru';
import {formatMessage} from '../../src/shared/i18n/format';
import {messageForError} from '../../src/shared/i18n/messages';
import {BUILD_INFO} from '../../src/shared/build-info';
afterEach(cleanup);
const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';
const proxyId='8c6dbed2-8067-43ec-b5fd-3cb482d965ea';
const proxy:SavedProxy={id:proxyId,name:'Shared HTTP',kind:'http',host:'proxy.example.com',port:8080,hasPassword:true,createdAt:'now',updatedAt:'now',profileIds:[id]};
const p:Profile={id,name:'Work',note:'',languages:['ru-RU'],startUrls:['about:blank'],proxyId,proxy,fingerprint:DEFAULT_FINGERPRINT,restoreLastSession:false,fingerprintSeed:123,extensionIds:[],createdAt:'now',updatedAt:'now'};
 function api(overrides:Partial<ProfileApi>={}):ProfileApi{return {list:async()=>({ok:true,value:[p]}),listProxies:async()=>({ok:true,value:[proxy]}),states:async()=>({ok:true,value:{[id]:'stopped'}}),runningProxyVersions:async()=>({ok:true,value:{}}),engineStatus:async()=>({ok:true,value:{state:'missing'}}),getSettings:async()=>({ok:true,value:{language:'en'}}),updateSettings:async settings=>({ok:true,value:settings}),create:async input=>({ok:true,value:{...p,...input}}),update:async(_id,input)=>({ok:true,value:{...p,...input}}),createProxy:async input=>({ok:true,value:{...proxy,...input}}),updateProxy:async()=>({ok:true,value:proxy}),removeProxy:async()=>({ok:true,value:undefined}),checkSavedProxy:async()=>({ok:true,value:{ip:'192.0.2.1',countryCode:'US',service:'test'}}),remove:async()=>({ok:true,value:undefined}),start:async()=>({ok:true,value:undefined}),stop:async()=>({ok:true,value:undefined}),installEngine:async()=>({ok:true,value:undefined}),linkEngine:async()=>({ok:true,value:undefined}),backup:async()=>({ok:true,value:undefined}),restore:async()=>({ok:true,value:null}),exportProfile:async()=>({ok:true,value:null}),importProfile:async()=>({ok:true,value:null}),checkProxy:async()=>({ok:true,value:{ip:'192.0.2.1',countryCode:'US',service:'test'}}),importCookies:async()=>({ok:true,value:null}),exportCookies:async()=>({ok:true,value:null}),clearCookies:async()=>({ok:true,value:null}),listExtensions:async()=>({ok:true,value:[]}),addExtensionFolder:async()=>({ok:true,value:null}),addExtensionZip:async()=>({ok:true,value:null}),updateExtension:async()=>({ok:true,value:null}),removeExtension:async()=>({ok:true,value:undefined}),onCloseRequested:()=>()=>undefined,confirmClose:async()=>true,...overrides};}
function card(name='Work'){return screen.getByRole('heading',{name}).closest('article')!;}
function settingsButton(name='Work'){return within(card(name)).getByRole('button',{name:/^(Settings|Hide settings)$/});}
function expandSettings(name='Work'){fireEvent.click(settingsButton(name));}
function chooseLanguage(name:string){fireEvent.click(screen.getByRole('button',{name:'Interface language'}));fireEvent.click(screen.getByRole('button',{name}));}
it('places language, GitHub and the build version in the sidebar footer',async()=>{
  const {container}=render(<App api={api()}/>);await screen.findByText('Work');
  const footer=container.querySelector('aside > footer.sidebar-footer') as HTMLElement;
  expect(footer).not.toBeNull();
  const link=within(footer).getByRole('link',{name:'GitHub'});
  expect(link.getAttribute('href')).toBe('https://github.com/thejohnd0e/exodus-browser');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(footer.textContent).toContain(`v${BUILD_INFO.version}`);
  expect(container.querySelector('.brand .build-version')).toBeNull();
});
it('opens language choices upward and saves only a different language',async()=>{
  const updateSettings=vi.fn<ProfileApi['updateSettings']>(async settings=>({ok:true,value:settings}));render(<App api={api({updateSettings})}/>);await screen.findByText('Work');
  const trigger=screen.getByRole('button',{name:'Interface language'});
  fireEvent.click(trigger);expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'English'}));
  expect(updateSettings).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:ru['language.ru']})).toBeNull();
  fireEvent.click(trigger);fireEvent.click(screen.getByRole('button',{name:ru['language.ru']}));
  await waitFor(()=>expect(updateSettings).toHaveBeenCalledWith({language:'ru'}));
});
it('closes language choices with Escape and returns focus to the trigger',async()=>{
  render(<App api={api()}/>);await screen.findByText('Work');
  const trigger=screen.getByRole('button',{name:'Interface language'});
  fireEvent.click(trigger);fireEvent.keyDown(screen.getByRole('button',{name:'English'}),{key:'Escape'});
  expect(screen.queryByRole('button',{name:ru['language.ru']})).toBeNull();expect(document.activeElement).toBe(trigger);
});
it('shows an in-app confirmation before clearing cookies',async()=>{
 const clearCookies=vi.fn(async()=>({ok:true as const,value:{cleared:true as const}}));render(<App api={api({clearCookies})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Clear cookies…'}));
 const dialog=await screen.findByRole('alertdialog');expect(dialog.textContent).toContain('Clear all cookies for “Work”?');expect(clearCookies).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('alertdialog')).toBeNull();expect(clearCookies).not.toHaveBeenCalled();
 fireEvent.click(within(card()).getByRole('button',{name:'Clear cookies…'}));const reopened=await screen.findByRole('alertdialog');fireEvent.click(within(reopened).getByRole('button',{name:'Clear cookies'}));await waitFor(()=>expect(clearCookies).toHaveBeenCalledWith(id));
});
it('uses the in-app dialog for profile deletion and keeps cancellation side-effect free',async()=>{
 const remove=vi.fn(async()=>({ok:true as const,value:undefined}));render(<App api={api({remove})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Delete'}));
 const dialog=await screen.findByRole('alertdialog');expect(dialog.textContent).toContain('Delete this profile and all its data?');fireEvent.keyDown(dialog,{key:'Escape'});expect(remove).not.toHaveBeenCalled();
 fireEvent.click(within(card()).getByRole('button',{name:'Delete'}));fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button',{name:'Delete'}));await waitFor(()=>expect(remove).toHaveBeenCalledWith(id));
});
it('requires an in-app confirmation before creating a backup',async()=>{
 const backup=vi.fn(async()=>({ok:true as const,value:undefined}));render(<App api={api({backup})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Backup'}));
 const dialog=await screen.findByRole('alertdialog');expect(dialog.textContent).toContain('The backup contains cookies and other sensitive data.');expect(backup).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));await waitFor(()=>expect(backup).toHaveBeenCalledWith(id));
});
it('routes active-window close confirmation through the same dialog and reports cancel to main',async()=>{
 let requestClose:(()=>void)|undefined;const confirmClose=vi.fn(async()=>true);render(<App api={api({onCloseRequested:callback=>{requestClose=callback;return()=>undefined;},confirmClose})}/>);await screen.findByText('Work');
 act(()=>requestClose?.());const dialog=await screen.findByRole('alertdialog');expect(dialog.textContent).toContain('Stop browsers and close the manager?');fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(confirmClose).toHaveBeenCalledWith(false));
 act(()=>requestClose?.());fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button',{name:'Stop and exit'}));await waitFor(()=>expect(confirmClose).toHaveBeenCalledWith(true));
});
async function openProfile(){await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Edit'}));}
it('keeps profile identity and launch controls visible while settings start collapsed',async()=>{
 render(<App api={api({engineStatus:async()=>({ok:true,value:{state:'ready',version:'156.0.8078.80',source:'downloaded'}})})}/>);await screen.findByText('Work');
 const profile=card();const disclosure=within(profile).getByRole('button',{name:'Settings'});
 expect(within(profile).getByText('Shared HTTP · HTTP · proxy.example.com:8080')).toBeTruthy();expect(within(profile).getByText('Stopped')).toBeTruthy();
 expect((within(profile).getByRole('button',{name:'Launch'}) as HTMLButtonElement).disabled).toBe(false);expect((within(profile).getByRole('button',{name:'Stop'}) as HTMLButtonElement).disabled).toBe(true);
 expect(disclosure.getAttribute('aria-expanded')).toBe('false');expect(profile.querySelector('[aria-controls]')).toBe(disclosure);expect(within(profile).queryByRole('button',{name:'Edit'})).toBeNull();expect(within(profile).queryByRole('button',{name:'Backup'})).toBeNull();expect(within(profile).queryByRole('button',{name:'Import cookies…'})).toBeNull();
 expandSettings();expect(settingsButton().getAttribute('aria-expanded')).toBe('true');expect(within(profile).getByText('System default · Canvas: Real · WebGL: Real')).toBeTruthy();expect(within(profile).queryByRole('button',{name:'Fingerprint: edit'})).toBeNull();
 expect(within(profile).getAllByRole('button',{name:'Edit'})).toHaveLength(1);fireEvent.click(within(profile).getByRole('button',{name:'Edit'}));expect(screen.getByRole('heading',{name:'Profile settings'})).toBeTruthy();
});
it('keeps each profile settings disclosure attached to its profile through reordering',async()=>{
 const second={...p,id:'3829c231-99ba-48c0-b2f2-233b01c167e6',name:'Personal'};let records=[p,second];
 const firstApi=api({list:async()=>({ok:true,value:records})});const {rerender}=render(<App api={firstApi}/>);await screen.findByText('Work');await screen.findByText('Personal');
 expandSettings('Work');expect(settingsButton('Personal').getAttribute('aria-expanded')).toBe('false');
 records=[second,p];const reorderedApi=api({list:async()=>({ok:true,value:records})});rerender(<App api={reorderedApi}/>);
 await waitFor(()=>expect([...document.querySelectorAll('.profile-title h3')].map(node=>node.textContent)).toEqual(['Personal','Work']));
 expect(settingsButton('Work').getAttribute('aria-expanded')).toBe('true');expect(settingsButton('Personal').getAttribute('aria-expanded')).toBe('false');
 expandSettings('Personal');expect(settingsButton('Work').getAttribute('aria-expanded')).toBe('true');expect(settingsButton('Personal').getAttribute('aria-expanded')).toBe('true');
 expect(settingsButton('Work').getAttribute('aria-controls')).not.toBe(settingsButton('Personal').getAttribute('aria-controls'));
});
it.each([
 ['stopped',false,true,false],['starting',true,false,false],['running',true,false,true],['stopping',true,false,false],['error',false,true,false],['blocked',true,false,false]
] as const)('keeps launch/stop outside settings with current %s-state enablement',async(state,locked,launchEnabled,stopEnabled)=>{
 const start=vi.fn(api().start),stop=vi.fn(api().stop);render(<App api={api({engineStatus:async()=>({ok:true,value:{state:'ready',version:'156.0.8078.80',source:'downloaded'}}),states:async()=>({ok:true,value:{[id]:state}}),start,stop})}/>);await screen.findByText('Work');
 const profile=card();const launch=within(profile).getByRole('button',{name:'Launch'}) as HTMLButtonElement;const stopButton=within(profile).getByRole('button',{name:'Stop'}) as HTMLButtonElement;
 expect(launch.disabled).toBe(!launchEnabled);expect(stopButton.disabled).toBe(!stopEnabled);expect(settingsButton().getAttribute('aria-expanded')).toBe('false');
 if(launchEnabled){fireEvent.click(launch);await waitFor(()=>expect(start).toHaveBeenCalledExactlyOnceWith(id));expect(settingsButton().getAttribute('aria-expanded')).toBe('false');}
 if(stopEnabled){fireEvent.click(stopButton);await waitFor(()=>expect(stop).toHaveBeenCalledExactlyOnceWith(id));expect(settingsButton().getAttribute('aria-expanded')).toBe('false');}
 if(state==='blocked')expect(within(profile).getByText('Close the remaining browser manually and restart the manager.')).toBeTruthy();
 if(locked)expect(within(profile).queryByRole('button',{name:'Edit'})).toBeNull();
});
it('keeps missing-proxy-credential warnings visible while settings are collapsed',async()=>{
 const requiredProxy={...proxy,requiresPassword:true};render(<App api={api({list:async()=>({ok:true,value:[{...p,proxy:requiredProxy}]})})}/>);await screen.findByText('Work');
 expect(within(card()).getByText('This imported proxy needs its password entered before launch.')).toBeTruthy();expect(within(card()).getByRole('button',{name:'Settings'}).getAttribute('aria-expanded')).toBe('false');
});
it('preserves a checked IP and closes transient menus when settings collapse',async()=>{
 const checkProxy=vi.fn(api().checkProxy);render(<App api={api({checkProxy})}/>);await screen.findByText('Work');expect(checkProxy).not.toHaveBeenCalled();
 expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));await screen.findByText('External IP: 192.0.2.1');expect(within(card()).getByRole('img',{name:'United States'})).toBeTruthy();
 fireEvent.click(settingsButton());expect(document.getElementById(settingsButton().getAttribute('aria-controls')!)?.hasAttribute('hidden')).toBe(true);expect(within(card()).getByText('External IP: 192.0.2.1')).toBeTruthy();expandSettings();expect(within(card()).getByText('External IP: 192.0.2.1')).toBeTruthy();expect(within(card()).getByRole('img',{name:'United States'})).toBeTruthy();
 fireEvent.click(within(card()).getByRole('button',{name:'Export cookies…'}));expect(within(card()).getByRole('menuitem',{name:'JSON (Exodus Browser)'})).toBeTruthy();fireEvent.click(settingsButton());expandSettings();expect(within(card()).queryByRole('menuitem',{name:'JSON (Exodus Browser)'})).toBeNull();
});
it('shows profiles and filters by name without exposing browser data',async()=>{render(<App api={api()}/>);await screen.findByText('Work');fireEvent.change(screen.getByPlaceholderText('Search profiles'),{target:{value:'other'}});expect(screen.queryByText('Work')).toBeNull();expect(screen.getByText(/is not anti-detection/)).toBeTruthy();});
it('uses English branding and language names while preserving an existing profile locale',async()=>{
 render(<App api={api()}/>);await openProfile();
 const wordmark=screen.getByRole('img',{name:'Exodus Browser'});
 expect(wordmark.getAttribute('src')).toContain('exodus-wordmark');
 expect(screen.queryByText('EB')).toBeNull();
 expect(screen.getByRole('button',{name:'Choose language'}).textContent).toContain('Russian (Russia)');
 fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('clips the existing wordmark inside a dedicated sidebar viewport',async()=>{
 render(<App api={api()}/>);await screen.findByText('Work');const viewport=document.querySelector('.brand-logo-viewport');
 expect(viewport).toBeTruthy();expect(viewport?.querySelector('img[alt="Exodus Browser"]')).toBeTruthy();
});
it('defaults only new profiles to English and accepts Unicode user input',async()=>{
 const create=vi.fn(api().create);render(<App api={api({create})}/>);await screen.findByText('Work');
 fireEvent.click(screen.getByRole('button',{name:'＋ New profile'}));
 fireEvent.change(screen.getByLabelText('Name'),{target:{value:'\u041f\u0440\u043e\u0444\u0438\u043b\u044c'}});
 fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
 await waitFor(()=>expect(create).toHaveBeenCalled());
 expect(create.mock.calls[0][0]).toMatchObject({name:'\u041f\u0440\u043e\u0444\u0438\u043b\u044c',languages:['en-US']});
});
it('omits redundant local-only and workspace taglines while keeping the two useful profile counts',async()=>{
 render(<App api={api()}/>);await screen.findByText('Work');
 for(const label of ['Your data. Your computer.','LOCAL WORKSPACE','Separate sessions, proxies and settings — in one place.','Local','Data storage','Local only','No accounts or cloud'])expect(screen.queryByText(label)).toBeNull();
  expect(document.querySelector('.summary-counts')?.children).toHaveLength(2);
});
it('shows counts and the installed Chromium version in one compact summary row',async()=>{
 const second={...p,id:'3829c231-99ba-48c0-b2f2-233b01c167e6',name:'Personal'};
 render(<App api={api({list:async()=>({ok:true,value:[p,second]}),states:async()=>({ok:true,value:{[id]:'running','3829c231-99ba-48c0-b2f2-233b01c167e6':'running'}}),engineStatus:async()=>({ok:true,value:{state:'ready',version:'156.0.8078.80',source:'downloaded'}})})}/>);
 await screen.findByText('Work');const row=document.querySelector('.summary-row');expect(row).toBeTruthy();expect(row?.textContent).toContain('2');expect(row?.textContent).toContain('Currently running');expect(row?.textContent).toContain('156.0.8078.80');expect(document.querySelector('.stats')).toBeNull();expect(screen.queryByText('Separate engine · your personal browser is not used')).toBeNull();
 const info=screen.getByRole('button',{name:'About separate Chromium'});expect(info.getAttribute('aria-describedby')).toBeTruthy();fireEvent.focus(info);const tip=document.getElementById(info.getAttribute('aria-describedby')!)!;expect(tip.textContent).toContain('separate browser process');expect(tip.classList.contains('visible')).toBe(true);fireEvent.keyDown(info,{key:'Escape'});expect(tip.classList.contains('visible')).toBe(false);
});
it('disables editing and launching running profiles and shows engine options',async()=>{render(<App api={api({states:async()=>({ok:true,value:{[id]:'running'}})})}/>);await screen.findByText('Work');expandSettings();expect((within(card()).getByRole('button',{name:'Edit'}) as HTMLButtonElement).disabled).toBe(true);expect((within(card()).getByRole('button',{name:'Launch'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/Browser not installed/)).toBeTruthy();});
it('searches and replaces the single site language before saving',async()=>{
 const update=vi.fn(api().update);render(<App api={api({update})}/>);await openProfile();
 const languagePanel=screen.getByRole('heading',{name:'Browser language'}).closest('section')!;expect(within(languagePanel).queryByRole('button',{name:'Add language'})).toBeNull();expect(within(languagePanel).queryByRole('button',{name:/Move up|Move down|Delete/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Choose language'}));fireEvent.change(screen.getByRole('textbox',{name:'Search languages'}),{target:{value:'de'}});fireEvent.click(screen.getByRole('option',{name:/de-DE/}));
 fireEvent.click(screen.getByRole('button',{name:'Choose language'}));fireEvent.change(screen.getByRole('textbox',{name:'Search languages'}),{target:{value:'fr'}});fireEvent.click(screen.getByRole('option',{name:/fr-FR/}));
 fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
 await waitFor(()=>expect(update).toHaveBeenCalled());expect(update.mock.calls[0][1].languages).toEqual(['fr-FR']);expect(update.mock.calls[0][1].proxyId).toBe(proxyId);
});
it('keeps a profile draft when adding or cancelling a proxy editor and selects a newly saved proxy',async()=>{
 const update=vi.fn(api().update);const newId='3829c231-99ba-48c0-b2f2-233b01c167e6';const fresh={...proxy,id:newId,name:'New',profileIds:[]};let proxies=[proxy];
 render(<App api={api({update,listProxies:async()=>({ok:true,value:proxies}),createProxy:async()=>{proxies=[...proxies,fresh];return {ok:true,value:fresh};}})}/>);await openProfile();fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Draft'}});
 fireEvent.click(screen.getByRole('button',{name:'Add proxy'}));fireEvent.click(screen.getByRole('button',{name:'Close proxy editor'}));expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');
 fireEvent.click(screen.getByRole('button',{name:'Add proxy'}));fireEvent.change(screen.getByLabelText('Proxy name'),{target:{value:'New'}});fireEvent.change(screen.getByLabelText('Proxy address'),{target:{value:'localhost'}});fireEvent.click(screen.getByRole('button',{name:'Save proxy'}));
 await waitFor(()=>expect((screen.getByLabelText('Saved proxy') as HTMLSelectElement).value).toBe(newId));expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');fireEvent.click(screen.getByRole('button',{name:'Save profile'}));await waitFor(()=>expect(update).toHaveBeenCalled());expect(update.mock.calls[0][1].proxyId).toBe(newId);
});
it('saves the per-profile restore-last-session preference',async()=>{
 const update=vi.fn(api().update);render(<App api={api({update})}/>);await openProfile();
 fireEvent.click(screen.getByRole('checkbox',{name:'Restore tabs from the previous session'}));
 fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
 await waitFor(()=>expect(update).toHaveBeenCalled());
 expect(update.mock.calls[0][1].restoreLastSession).toBe(true);
});
it('clears cookies and shows a value-free completion message',async()=>{
 const clearCookies=vi.fn(async()=>({ok:true as const,value:{cleared:true as const}}));render(<App api={api({clearCookies})}/>);
   await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Clear cookies…'}));fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Clear cookies'}));
 await waitFor(()=>expect(clearCookies).toHaveBeenCalledWith(id));
 expect(await screen.findByText('Cookies cleared. Other site data was kept.')).toBeTruthy();
 expect(document.body.textContent).not.toContain('sid');
});
it('reformats an existing safe error descriptor after switching interface language',async()=>{
 const checkProxy=vi.fn<ProfileApi['checkProxy']>(async()=>({ok:false,error:{code:'PROXY_CHECK_FAILED',message:'Proxy check failed.'}}));
  render(<App api={api({checkProxy})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));
 await screen.findByText('Proxy check failed.');
 chooseLanguage(ru['language.ru']);
 await waitFor(()=>expect(screen.getByRole('alert').querySelector('span')?.textContent).toBe(messageForError('PROXY_CHECK_FAILED','ru')));
});
it('persists interface language without replacing an unsaved profile draft or site locale',async()=>{
 const updateSettings=vi.fn<ProfileApi['updateSettings']>(async settings=>({ok:true,value:settings}));render(<App api={api({updateSettings})}/>);
 await openProfile();fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Draft not saved'}});
 chooseLanguage(ru['language.ru']);
 await waitFor(()=>expect(updateSettings).toHaveBeenCalledWith({language:'ru'}));
  expect((screen.getByLabelText(ru.Name) as HTMLInputElement).value).toBe('Draft not saved');
  expect(screen.getByRole('button',{name:ru['Choose language']}).textContent).toContain('Russian (Russia)');
});
it('localizes fingerprint controls and their accessible labels',async()=>{
 render(<App api={api()}/>);await openProfile();
 chooseLanguage(ru['language.ru']);
 await screen.findByRole('heading',{name:ru['Profile settings']});
 fireEvent.click(within(screen.getByRole('group',{name:ru['WebGL Info']})).getByRole('button',{name:ru.Manual}));
 expect(screen.getByLabelText(ru['WebGL vendor'])).toBeTruthy();
 expect(screen.getByLabelText(ru['WebGL renderer'])).toBeTruthy();
});
it('edits proxies separately and drops HTTP credentials when switched to SOCKS5',async()=>{
 const updateProxy=vi.fn(api().updateProxy);render(<App api={api({updateProxy})}/>);await screen.findByText('Work');fireEvent.click(screen.getByRole('button',{name:'Proxies'}));fireEvent.click(screen.getByRole('button',{name:'Edit'}));fireEvent.change(screen.getByLabelText('Proxy type'),{target:{value:'socks5'}});fireEvent.click(screen.getByRole('button',{name:'Save proxy'}));await waitFor(()=>expect(updateProxy).toHaveBeenCalled());expect(updateProxy.mock.calls[0][1]).toEqual({name:'Shared HTTP',kind:'socks5',host:'proxy.example.com',port:8080});
});
 it('discloses the HTTP service before click and shows success only inside the checked card',async()=>{
   const second={...p,id:'3829c231-99ba-48c0-b2f2-233b01c167e6',name:'Personal'};const checkProxy=vi.fn(api().checkProxy);render(<App api={api({list:async()=>({ok:true,value:[p,second]}),checkProxy})}/>);await screen.findByText('Work');expandSettings();expect(within(card()).getByText(/api\.ipify\.org.*HTTP/)).toBeTruthy();expect(checkProxy).not.toHaveBeenCalled();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));await waitFor(()=>expect(within(card()).getByText('External IP: 192.0.2.1')).toBeTruthy());expect(checkProxy).toHaveBeenCalledExactlyOnceWith(id);expect(within(card('Personal')).queryByText(/External IP/)).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
 });
 it('keeps IP success visible when country lookup has no result',async()=>{
   render(<App api={api({checkProxy:async()=>({ok:true,value:{ip:'203.0.113.8',countryCode:null,service:'test'}})})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));expect(await screen.findByText('External IP: 203.0.113.8')).toBeTruthy();expect(card().querySelector('.country-flag')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
 });
it('clears the last IP during a retry and shows failures separately',async()=>{
   let finish!:(value:Awaited<ReturnType<ProfileApi['checkProxy']>>)=>void;const checkProxy=vi.fn<ProfileApi['checkProxy']>().mockResolvedValueOnce({ok:true,value:{ip:'192.0.2.1',countryCode:'US',service:'test'}}).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));render(<App api={api({checkProxy})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));await screen.findByText('External IP: 192.0.2.1');await waitFor(()=>expect((within(card()).getByRole('button',{name:'Check IP'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));expect(screen.queryByText(/External IP/)).toBeNull();await act(async()=>finish({ok:false,error:{code:'PROXY_CHECK_FAILED',message:'Proxy check failed.'}}));expect(screen.getByRole('alert').textContent).toContain('Proxy check failed.');
});
 it('invalidates a profile IP after a password-only edit of the shared proxy',async()=>{
  let current=proxy;render(<App api={api({list:async()=>({ok:true,value:[{...p,proxy:current}]}),listProxies:async()=>({ok:true,value:[current]}),updateProxy:async()=>{current={...proxy,updatedAt:'later'};return {ok:true,value:current};}})}/>);await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));await screen.findByText('External IP: 192.0.2.1');await waitFor(()=>expect((screen.getByRole('button',{name:'Proxies'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Proxies'}));fireEvent.click(screen.getByRole('button',{name:'Edit'}));fireEvent.change(screen.getByLabelText('Proxy password'),{target:{value:'new-secret'}});fireEvent.click(screen.getByRole('button',{name:'Save proxy'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());fireEvent.click(screen.getByRole('button',{name:'Profiles'}));expect(screen.queryByText(/External IP/)).toBeNull();
 });
  it('does not display a delayed IP-and-country result after refreshed profile and proxy data changes',async()=>{
   let current=proxy;let profile={...p};let finish!:(value:Awaited<ReturnType<ProfileApi['checkProxy']>>)=>void;
   const checkProxy=vi.fn<ProfileApi['checkProxy']>(()=>new Promise(resolve=>{finish=resolve;}));
   render(<App api={api({list:async()=>({ok:true,value:[{...profile,proxy:current}]}),listProxies:async()=>({ok:true,value:[current]}),checkProxy})}/>);
    await screen.findByText('Work');expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Check IP'}));
   current={...proxy,updatedAt:'password-edit'};profile={...p,name:'Work after edit'};
   await screen.findByText('Work after edit',{},{timeout:3000});
   await act(async()=>finish({ok:true,value:{ip:'8.8.8.8',countryCode:'US',service:'test'}}));
   await waitFor(()=>expect((screen.getByRole('button',{name:'Proxies'}) as HTMLButtonElement).disabled).toBe(false));
   expect(screen.queryByText('External IP: 8.8.8.8')).toBeNull();expect(card('Work after edit').querySelector('.country-flag')).toBeNull();
  });
 it('does not display a delayed saved-proxy IP-and-country result after a password-only edit',async()=>{
   let current=proxy;let finish!:(value:Awaited<ReturnType<ProfileApi['checkSavedProxy']>>)=>void;
   const checkSavedProxy=vi.fn<ProfileApi['checkSavedProxy']>(()=>new Promise(resolve=>{finish=resolve;}));
   render(<App api={api({listProxies:async()=>({ok:true,value:[current]}),checkSavedProxy})}/>);
   await screen.findByText('Work');fireEvent.click(screen.getByRole('button',{name:'Proxies'}));await screen.findByText('Shared HTTP');fireEvent.click(screen.getByRole('button',{name:'Check'}));
   current={...proxy,name:'Shared HTTP after edit',updatedAt:'password-edit'};
   await screen.findByText('Shared HTTP after edit',{},{timeout:3000});
   await act(async()=>finish({ok:true,value:{ip:'8.8.8.8',countryCode:'US',service:'test'}}));
   await waitFor(()=>expect((screen.getByRole('button',{name:'Profiles'}) as HTMLButtonElement).disabled).toBe(false));
   expect(screen.queryByText('External IP: 8.8.8.8')).toBeNull();expect(screen.queryByRole('img',{name:'United States'})).toBeNull();
  });
 it('shows DB-IP attribution as a link in both proxy result views',async()=>{
   render(<App api={api()}/>);await screen.findByText('Work');expandSettings();
  expect(screen.getByRole('link',{name:'DB-IP.com'}).getAttribute('href')).toBe('https://db-ip.com/');
  fireEvent.click(screen.getByRole('button',{name:'Proxies'}));
  expect(screen.getByRole('link',{name:'DB-IP.com'}).getAttribute('href')).toBe('https://db-ip.com/');
 });
it('shows the fingerprint summary and opens its editor',async()=>{
 const fingerprint={...DEFAULT_FINGERPRINT,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36',canvas:'noise' as const,webgl:'real' as const};
 render(<App api={api({list:async()=>({ok:true,value:[{...p,fingerprint}]})})}/>);await screen.findByText('Work');
 expect(within(card()).getByText('Windows 11 · Canvas: Noise · WebGL: Real')).toBeTruthy();
 expect(within(card()).getByText('Time zone: Auto')).toBeTruthy();
  expect(within(card()).queryByRole('button',{name:'Fingerprint: edit'})).toBeNull();expandSettings();fireEvent.click(within(card()).getByRole('button',{name:'Edit'}));
  expect(screen.getByRole('heading',{name:'Fingerprint'})).toBeTruthy();
});
it('warns that WebRTC off breaks media sites',async()=>{
 render(<App api={api({list:async()=>({ok:true,value:[{...p,fingerprint:{...DEFAULT_FINGERPRINT,webRtc:'off' as const}}]})})}/>);await screen.findByText('Work');
 expect(within(card()).getByText(/media sites/)).toBeTruthy();
});
it('imports and exports cookies from the card and shows the count',async()=>{
  const importCookies=vi.fn<ProfileApi['importCookies']>(async()=>({ok:true,value:{count:2,fileName:'a.json'}}));
  const exportCookies=vi.fn<ProfileApi['exportCookies']>(async()=>({ok:true,value:{count:1,fileName:'cookies.txt'}}));
   render(<App api={api({importCookies,exportCookies})}/>);await screen.findByText('Work');expandSettings();
  fireEvent.click(within(card()).getByRole('button',{name:'Import cookies…'}));
  await waitFor(()=>expect(within(card()).getByText('Imported 2 cookies from a.json')).toBeTruthy());
  fireEvent.click(within(card()).getByRole('button',{name:'Export cookies…'}));
  fireEvent.click(within(card()).getByRole('menuitem',{name:'Netscape cookies.txt'}));
  await waitFor(()=>expect(exportCookies).toHaveBeenCalledWith(id,'netscape'));
   await waitFor(()=>expect(within(card()).getByText('Exported 1 cookie to cookies.txt')).toBeTruthy());
   chooseLanguage(ru['language.ru']);
    await waitFor(()=>expect(within(card()).getByText(formatMessage('ru','cookies.exported',{count:1,fileName:'cookies.txt'}))).toBeTruthy());
});
it('disables cookies for a running profile and shows errors',async()=>{
  const importCookies=vi.fn<ProfileApi['importCookies']>(async()=>({ok:false,error:{code:'INVALID_COOKIE_FILE',message:'The cookies file is corrupted.'}}));
   render(<App api={api({importCookies})}/>);await screen.findByText('Work');expandSettings();
  fireEvent.click(within(card()).getByRole('button',{name:'Import cookies…'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('corrupted'));
  cleanup();
   render(<App api={api({states:async()=>({ok:true,value:{[id]:'running'}})})}/>);await screen.findByText('Work');expandSettings();
  expect((within(card()).getByRole('button',{name:'Import cookies…'}) as HTMLButtonElement).disabled).toBe(true);
  expect((within(card()).getByRole('button',{name:'Export cookies…'}) as HTMLButtonElement).disabled).toBe(true);
});
