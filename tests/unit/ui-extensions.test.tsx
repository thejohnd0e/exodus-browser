// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {App} from '../../src/renderer/App';
import type {ProfileApi,Profile,ExtensionEntry} from '../../src/shared/contracts';
import {DEFAULT_FINGERPRINT} from '../../src/shared/fingerprint';
import {ru} from '../../src/shared/i18n/ru';

afterEach(cleanup);
const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';
const entry:ExtensionEntry={id:'3f0f5a2e-1c7b-4c1e-9a55-8e6f2b7d9a10',name:'TimeZone Changer',version:'2.2',source:'folder',addedAt:'now',updatedAt:'now'};
const p:Profile={id,name:'Work',note:'',languages:['en-US'],startUrls:['about:blank'],proxyId:null,proxy:null,fingerprint:DEFAULT_FINGERPRINT,restoreLastSession:false,fingerprintSeed:1,extensionIds:[],createdAt:'now',updatedAt:'now'};

function api(overrides:Partial<ProfileApi>={}):ProfileApi{return {
  list:async()=>({ok:true,value:[p]}),listProxies:async()=>({ok:true,value:[]}),states:async()=>({ok:true,value:{[id]:'stopped'}}),runningProxyVersions:async()=>({ok:true,value:{}}),
  engineStatus:async()=>({ok:true,value:{state:'ready',version:'156.0.8078.80'}}),getSettings:async()=>({ok:true,value:{language:'en'}}),updateSettings:async settings=>({ok:true,value:settings}),
  create:async input=>({ok:true,value:{...p,...input}}),update:async(_id,input)=>({ok:true,value:{...p,...input}}),
  createProxy:async input=>({ok:true,value:{id:'b1e0b7b0-4f3e-4a4c-8a3f-26f7f0a9c111',name:input.name,kind:input.kind,host:input.host,port:input.port,hasPassword:false,createdAt:'now',updatedAt:'now',profileIds:[]}}),updateProxy:async()=>({ok:true,value:{}} as never),removeProxy:async()=>({ok:true,value:undefined}),checkSavedProxy:async()=>({ok:true,value:{ip:'192.0.2.1',countryCode:'US',service:'test'}}),
  remove:async()=>({ok:true,value:undefined}),start:async()=>({ok:true,value:undefined}),stop:async()=>({ok:true,value:undefined}),installEngine:async()=>({ok:true,value:undefined}),linkEngine:async()=>({ok:true,value:undefined}),
  backup:async()=>({ok:true,value:undefined}),restore:async()=>({ok:true,value:null}),exportProfile:async()=>({ok:true,value:null}),importProfile:async()=>({ok:true,value:null}),
  checkProxy:async()=>({ok:true,value:{ip:'192.0.2.1',countryCode:'US',service:'test'}}),importCookies:async()=>({ok:true,value:null}),exportCookies:async()=>({ok:true,value:null}),clearCookies:async()=>({ok:true,value:null}),
  listExtensions:async()=>({ok:true,value:[entry]}),addExtensionFolder:async()=>({ok:true,value:null}),addExtensionZip:async()=>({ok:true,value:null}),addExtensionFromStore:async()=>({ok:true,value:null}),updateExtension:async()=>({ok:true,value:null}),removeExtension:async()=>({ok:true,value:undefined}),
  getUpdateState:async()=>({ok:true,value:{state:'idle'}}),checkForUpdate:async()=>({ok:true,value:{state:'up-to-date'}}),downloadUpdate:async()=>({ok:true,value:{state:'idle'}}),cancelUpdate:async()=>({ok:true,value:undefined}),installUpdate:async()=>({ok:true,value:undefined}),onUpdateState:()=>()=>undefined,onCloseRequested:()=>()=>undefined,confirmClose:async()=>true,...overrides};
}

function card(){const article=screen.getAllByRole('article')[0];if(!article)throw Error('card missing');return article;}
async function openProfile(){fireEvent.click(within(card()).getByRole('button',{name:'Settings'}));fireEvent.click(within(card()).getByRole('button',{name:'Edit'}));return screen.findByRole('dialog');}

it('lists library extensions and only removes one after confirmation',async()=>{
  const removeExtension=vi.fn(async()=>({ok:true as const,value:undefined}));
  render(<App api={api({removeExtension})}/>);await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Extensions'}));
  expect(await screen.findByText('TimeZone Changer')).toBeTruthy();
  expect(screen.getByText('v2.2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Remove'}));
  const dialog=await screen.findByRole('alertdialog');
  expect(removeExtension).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button',{name:'Remove'}));
  await waitFor(()=>expect(removeExtension).toHaveBeenCalledWith(entry.id));
});

it('adds extensions from a folder or archive through the main-process pickers',async()=>{
  const addExtensionFolder=vi.fn(async()=>({ok:true as const,value:null}));
  const addExtensionZip=vi.fn(async()=>({ok:true as const,value:null}));
  render(<App api={api({addExtensionFolder,addExtensionZip})}/>);await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Extensions'}));
  fireEvent.click(await screen.findByRole('button',{name:'Add folder…'}));
  await waitFor(()=>expect(addExtensionFolder).toHaveBeenCalledOnce());
  fireEvent.click(await screen.findByRole('button',{name:'Add archive…'}));
  await waitFor(()=>expect(addExtensionZip).toHaveBeenCalledOnce());
});

it('adds an extension from a pasted store link and closes the dialog',async()=>{
  const addExtensionFromStore=vi.fn(async()=>({ok:true as const,value:entry}));
  render(<App api={api({addExtensionFromStore})}/>);await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Extensions'}));
  fireEvent.click(await screen.findByRole('button',{name:'Add from store…'}));
  const dialog=await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('Chrome Web Store link')).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText('Chrome Web Store link'),{target:{value:'https://chromewebstore.google.com/detail/eagle/lieogkinebikhdchceieedcigeafdkid'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Add extension'}));
  await waitFor(()=>expect(addExtensionFromStore).toHaveBeenCalledWith('https://chromewebstore.google.com/detail/eagle/lieogkinebikhdchceieedcigeafdkid'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not submit a store link when the dialog is cancelled',async()=>{
  const addExtensionFromStore=vi.fn(async()=>({ok:true as const,value:null}));
  render(<App api={api({addExtensionFromStore})}/>);await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Extensions'}));
  fireEvent.click(await screen.findByRole('button',{name:'Add from store…'}));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Cancel'}));
  expect(screen.queryByRole('dialog')).toBeNull();expect(addExtensionFromStore).not.toHaveBeenCalled();
});

it('shows the localized store link error and marks store entries',async()=>{
  const addExtensionFromStore=vi.fn(async()=>({ok:false as const,error:{code:'EXTENSION_INVALID_LINK',message:'invalid'}}));
  render(<App api={api({addExtensionFromStore,listExtensions:async()=>({ok:true,value:[{...entry,source:'store' as const,storeId:'lieogkinebikhdchceieedcigeafdkid'}]})})}/>);await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Extensions'}));
  expect(await screen.findByText('Store')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Add from store…'}));
  const dialog=await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Chrome Web Store link'),{target:{value:'https://example.com/x'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Add extension'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Paste a Chrome Web Store link'));
});

it('saves the extension selection for one profile',async()=>{
  const update=vi.fn<ProfileApi['update']>(async(_id,input)=>({ok:true,value:{...p,...input,extensionIds:input.extensionIds??[]}}));
  render(<App api={api({update})}/>);await screen.findByText('Work');
  await openProfile();
  const checkbox=await screen.findByRole('checkbox',{name:'TimeZone Changer'});
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
  await waitFor(()=>expect(update).toHaveBeenCalled());
  expect(update.mock.calls[0][1].extensionIds).toEqual([entry.id]);
});

it('warns about a timezone extension in a non-manual mode without blocking the save',async()=>{
  const update=vi.fn<ProfileApi['update']>(async(_id,input)=>({ok:true,value:{...p,...input}}));
  render(<App api={api({update})}/>);await screen.findByText('Work');
  await openProfile();
  fireEvent.click(await screen.findByRole('checkbox',{name:'TimeZone Changer'}));
  expect(screen.getByText('This extension can also change the time zone. Check the profile time zone setting.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
  await waitFor(()=>expect(update).toHaveBeenCalled());
});

it('localizes the library heading and actions',async()=>{
  render(<App api={api()}/>);await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button',{name:'Extensions'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Extensions'})).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'Interface language'}));
  fireEvent.click(screen.getByRole('button',{name:ru['language.ru']}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:ru.Extensions})).toBeTruthy());
});
