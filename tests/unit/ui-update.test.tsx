// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {UpdateButton} from '../../src/renderer/UpdateButton';
import {I18nProvider} from '../../src/renderer/i18n/provider';
import type {ProfileApi,Result} from '../../src/shared/contracts';
import type {UpdateState} from '../../src/shared/update';

afterEach(cleanup);

function harness(overrides:Partial<ProfileApi>={}){
  let push:(state:UpdateState)=>void=()=>undefined;
  const api={
    getUpdateState:vi.fn(async():Promise<Result<UpdateState>>=>({ok:true,value:{state:'idle'}})),
    checkForUpdate:vi.fn(async():Promise<Result<UpdateState>>=>({ok:true,value:{state:'up-to-date'}})),
    downloadUpdate:vi.fn(async():Promise<Result<UpdateState>>=>({ok:true,value:{state:'ready',version:'1.1.78'}})),
    cancelUpdate:vi.fn(async()=>({ok:true as const,value:undefined})),
    installUpdate:vi.fn(async():Promise<Result<void>>=>({ok:true,value:undefined})),
    onUpdateState:vi.fn((callback:(state:UpdateState)=>void)=>{push=callback;return ()=>undefined;}),
    ...overrides,
  } as unknown as ProfileApi;
  const view=render(<I18nProvider language="en" onLanguageChange={()=>undefined}><UpdateButton api={api}/></I18nProvider>);
  return {api,view,push:(state:UpdateState)=>act(()=>push(state))};
}

it('does not contact the update service when it is rendered',async()=>{
  const {api}=harness();
  await waitFor(()=>expect(api.getUpdateState).toHaveBeenCalled());
  expect(api.checkForUpdate).not.toHaveBeenCalled();
});

it('checks for updates on click and offers an available release',async()=>{
  const {api}=harness({checkForUpdate:vi.fn(async()=>({ok:true as const,value:{state:'available' as const,version:'1.1.78',size:138654375}}))} as never);
  fireEvent.click(screen.getByRole('button',{name:/Check for updates/}));
  expect(await screen.findByText('Version 1.1.78 is available (132 MB).')).toBeTruthy();
  expect(api.checkForUpdate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Download update'}));
  await waitFor(()=>expect(api.downloadUpdate).toHaveBeenCalledTimes(1));
});

it('shows download progress from pushed state and cancels on request',async()=>{
  const {api,push}=harness();
  push({state:'downloading',version:'1.1.78',received:40,total:100});
  expect(await screen.findByText('Downloading 40%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Cancel download'}));
  await waitFor(()=>expect(api.cancelUpdate).toHaveBeenCalledTimes(1));
});

it('offers installation only after verification and starts it on click',async()=>{
  const {api,push}=harness();
  push({state:'ready',version:'1.1.78'});
  fireEvent.click(await screen.findByRole('button',{name:'Install and restart'}));
  await waitFor(()=>expect(api.installUpdate).toHaveBeenCalledTimes(1));
});

it('explains that installation waits for running browsers',async()=>{
  const {push}=harness({installUpdate:vi.fn(async()=>({ok:false as const,error:{code:'UPDATE_BUSY_PROFILES',message:''}}))} as never);
  push({state:'ready',version:'1.1.78'});
  fireEvent.click(await screen.findByRole('button',{name:'Install and restart'}));
  expect(await screen.findByText('Stop all running profile browsers, then install the update.')).toBeTruthy();
});

it('shows a localized error state from the service',async()=>{
  const {push}=harness();
  push({state:'error',code:'UPDATE_CHECKSUM_MISMATCH'});
  expect(await screen.findByText('The update checksum does not match. The file was removed.')).toBeTruthy();
});

it('closes the panel on Escape, on outside click and with the close button',async()=>{
  const {push}=harness();
  push({state:'available',version:'1.1.78',size:138000000});
  expect(await screen.findByRole('button',{name:'Download update'})).toBeTruthy();
  fireEvent.keyDown(document,{key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Download update'})).toBeNull());

  push({state:'available',version:'1.1.78',size:138000000});
  fireEvent.mouseDown(document.body);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Download update'})).toBeNull());

  push({state:'available',version:'1.1.78',size:138000000});
  fireEvent.click(await screen.findByRole('button',{name:'Close update panel'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Download update'})).toBeNull());
});

it('keeps the panel open while a click inside it happens',async()=>{
  const {push}=harness();
  push({state:'available',version:'1.1.78',size:138000000});
  const download=await screen.findByRole('button',{name:'Download update'});
  fireEvent.mouseDown(download);
  expect(screen.getByRole('button',{name:'Download update'})).toBeTruthy();
});

it('hides the up-to-date message by itself after a short delay',async()=>{
  vi.useFakeTimers();
  try{
    const {push}=harness();
    push({state:'up-to-date'});
    expect(screen.getByText('You have the latest version.')).toBeTruthy();
    act(()=>{vi.advanceTimersByTime(6000);});
    expect(screen.queryByText('You have the latest version.')).toBeNull();
  }finally{vi.useRealTimers();}
});

it('keeps an available update on screen until the user acts',async()=>{
  vi.useFakeTimers();
  try{
    const {push}=harness();
    push({state:'available',version:'1.1.78',size:138000000});
    act(()=>{vi.advanceTimersByTime(30000);});
    expect(screen.getByRole('button',{name:'Download update'})).toBeTruthy();
  }finally{vi.useRealTimers();}
});
