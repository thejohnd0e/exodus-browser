// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {useState,type ReactNode} from 'react';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {FingerprintPanel} from '../../src/renderer/FingerprintPanel';
import {ProfileEditor} from '../../src/renderer/ProfileEditor';
import {DEFAULT_FINGERPRINT,type Fingerprint} from '../../src/shared/fingerprint';
import type {Profile} from '../../src/shared/contracts';
import {I18nProvider} from '../../src/renderer/i18n/provider';
afterEach(cleanup);
const id='d31bb0d8-7bfa-4341-a12a-83a801e8cb4a';
const profile:Profile={id,name:'Work',note:'',languages:['ru-RU'],startUrls:['about:blank'],proxyId:null,proxy:null,fingerprint:DEFAULT_FINGERPRINT,restoreLastSession:false,fingerprintSeed:1,createdAt:'now',updatedAt:'now'};
const group=(name:string)=>screen.getByRole('group',{name});
function Harness({chromeVersion='156.0.8078.80',onChange}:{chromeVersion?:string|null;onChange?:(next:Fingerprint)=>void}){
  const [value,setValue]=useState(DEFAULT_FINGERPRINT);
  return <FingerprintPanel value={value} disabled={false} chromeVersion={chromeVersion} onChange={next=>{onChange?.(next);setValue(next);}}/>;
}
function renderWithI18n(ui:ReactNode){return render(<I18nProvider language="en" onLanguageChange={()=>{}}>{ui}</I18nProvider>);}
it('shows fingerprint sections, switches modes and marks unsupported systems',()=>{
   const onChange=vi.fn();renderWithI18n(<Harness onChange={onChange}/>);
  expect((screen.getByRole('button',{name:/Android/}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:/iOS/}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(group('Canvas')).getByRole('button',{name:'Noise'}));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({canvas:'noise'}));
  fireEvent.click(within(group('WebRTC')).getByRole('button',{name:'Off'}));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({webRtc:'off'}));
});
it('new fingerprint uses the engine version in the UA and enables noise',()=>{
   const onChange=vi.fn();renderWithI18n(<Harness chromeVersion="156.0.8078.80" onChange={onChange}/>);
  fireEvent.click(screen.getByRole('button',{name:'New fingerprint'}));
  const next=onChange.mock.calls.at(-1)![0] as Fingerprint;
  expect(next.userAgent).toContain('Chrome/156.0.8078.80');
  expect(next.userAgent).toContain('Windows NT 10.0');
  expect(next.canvas).toBe('noise');expect(next.webgl).toBe('noise');expect(next.hardware.mode).toBe('manual');
});
it('requires vendor and renderer for manual WebGL Info',()=>{
   const onSave=vi.fn(async()=>{});renderWithI18n(<ProfileEditor profile={profile} proxies={[]} busy={false} chromeVersion="156.0.8078.80" onSave={onSave} onSaveProxy={async()=>false} onCancel={()=>{}}/>);
  fireEvent.click(within(group('WebGL Info')).getByRole('button',{name:'Manual'}));
  fireEvent.click(screen.getByRole('button',{name:'Save profile'}));
  expect(screen.getByRole('alert').textContent).toContain('fingerprint');
  expect(onSave).not.toHaveBeenCalled();
});
it('reveals manual timezone and geolocation fields',()=>{
   renderWithI18n(<Harness/>);
  fireEvent.click(within(group('Timezone')).getByRole('button',{name:'Manual'}));
  expect(screen.getByLabelText('Time zone')).toBeTruthy();
  fireEvent.click(within(group('Geolocation')).getByRole('button',{name:'Manual'}));
  expect(screen.getByLabelText('Latitude')).toBeTruthy();
  expect(screen.getByLabelText('Longitude')).toBeTruthy();
});
it('selects a searched time zone from the list and saves only its identifier',()=>{
  const onChange=vi.fn();renderWithI18n(<Harness onChange={onChange}/>);
  fireEvent.click(within(group('Timezone')).getByRole('button',{name:'Manual'}));
  const combo=screen.getByLabelText('Time zone');fireEvent.focus(combo);fireEvent.change(combo,{target:{value:'tallinn'}});
  expect(screen.getAllByRole('option').map(option=>option.textContent)).toEqual([expect.stringContaining('Europe/Tallinn')]);
  expect(onChange.mock.calls.every(([next])=>next.timezone.mode!=='manual'||next.timezone.value==='')).toBe(true);
  const callsBeforeSelect=onChange.mock.calls.length;
  fireEvent.mouseDown(screen.getByRole('option',{name:/Europe\/Tallinn/}));
  expect(onChange).toHaveBeenCalledTimes(callsBeforeSelect+1);
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({timezone:{mode:'manual',value:'Europe/Tallinn'}}));
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('chooses the active time zone with the keyboard and cancels with Escape',()=>{
  const onChange=vi.fn();renderWithI18n(<Harness onChange={onChange}/>);
  fireEvent.click(within(group('Timezone')).getByRole('button',{name:'Manual'}));
  const combo=screen.getByLabelText('Time zone');fireEvent.focus(combo);fireEvent.change(combo,{target:{value:'Europe/Pa'}});
  fireEvent.keyDown(combo,{key:'ArrowDown'});fireEvent.keyDown(combo,{key:'Enter'});
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({timezone:{mode:'manual',value:'Europe/Paris'}}));
  const callsBeforeCancel=onChange.mock.calls.length;
  fireEvent.focus(combo);fireEvent.change(combo,{target:{value:'Asia/'}});fireEvent.keyDown(combo,{key:'Escape'});
  expect(screen.queryByRole('listbox')).toBeNull();expect(onChange).toHaveBeenCalledTimes(callsBeforeCancel);
});
it('shows a localized empty result for an unmatched search',()=>{
  renderWithI18n(<Harness/>);
  fireEvent.click(within(group('Timezone')).getByRole('button',{name:'Manual'}));
  const combo=screen.getByLabelText('Time zone');fireEvent.focus(combo);fireEvent.change(combo,{target:{value:'Mars/Olympus'}});
  expect(screen.getByText('No matching time zones')).toBeTruthy();
});
it('disables every control while the profile is busy',()=>{
   renderWithI18n(<FingerprintPanel value={DEFAULT_FINGERPRINT} disabled onChange={()=>{}} chromeVersion="156.0.8078.80"/>);
  for(const button of screen.getAllByRole('button') as HTMLButtonElement[])expect(button.disabled).toBe(true);
});
it('does not generate a fingerprint from an external engine label',()=>{
  const onChange=vi.fn();renderWithI18n(<Harness chromeVersion="linked Chromium" onChange={onChange}/>);
 expect((screen.getByRole('button',{name:'New fingerprint'}) as HTMLButtonElement).disabled).toBe(true);
 expect(onChange).not.toHaveBeenCalled();
});
