import {it,expect} from 'vitest';
import {en} from '../../src/shared/i18n/en';
import {ru} from '../../src/shared/i18n/ru';
import {formatMessage} from '../../src/shared/i18n/format';
import {nativeMessage,messageForError} from '../../src/shared/i18n/messages';
import {errorsForLanguage} from '../../src/shared/i18n/messages';

it('keeps the English and Russian catalogs key-compatible',()=>{
 expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
});

it('uses locale plural rules and interpolates bounded count parameters',()=>{
 expect(formatMessage('en','profiles.count',{count:1})).toBe('1 profile');
 expect(formatMessage('en','profiles.count',{count:3})).toBe('3 profiles');
 const two=formatMessage('ru','profiles.count',{count:2});const five=formatMessage('ru','profiles.count',{count:5});
 expect(two).toContain('2');expect(five).toContain('5');expect(two).not.toBe(five);expect(two).not.toContain('profiles');
});

it('maps every allowlisted IPC error in both languages and uses a generic unknown fallback',()=>{
 for(const code of errorsForLanguage('en'))expect(messageForError(code,'en')).not.toBe('');
 for(const code of errorsForLanguage('ru'))expect(messageForError(code,'ru')).not.toBe('');
 expect(messageForError('__UNKNOWN__','ru')).toBe(ru['error.generic']);
 expect(messageForError('__UNKNOWN__','en')).toBe(en['error.generic']);
});

it('formats localized native confirmation prompts without altering user-provided names',()=>{
 expect(nativeMessage('cookie.clear.confirm','ru',{name:'User profile'})).toContain('«User profile»');
 expect(nativeMessage('cookie.clear.button','ru')).not.toBe(nativeMessage('cookie.clear.button','en'));
});

it('localizes every update error code in both languages',()=>{
 const codes=['UPDATE_CHECK_FAILED','UPDATE_INVALID_RELEASE','UPDATE_DOWNLOAD_FAILED','UPDATE_CHECKSUM_MISMATCH','UPDATE_TOO_LARGE','UPDATE_CANCELLED','UPDATE_UNTRUSTED_REDIRECT','UPDATE_BUSY','UPDATE_BUSY_PROFILES','UPDATE_NOT_READY'];
 for(const code of codes){
  expect(errorsForLanguage('en')).toContain(code);
  expect(messageForError(code,'en')).not.toBe(en['error.generic']);
  expect(messageForError(code,'ru')).not.toBe(ru['error.generic']);
 }
});

it('provides English and Russian copy for the update controls',()=>{
 for(const key of ['Check for updates','Checking for updates…','You have the latest version.','Version {{version}} is available ({{size}}).','Download update','Downloading {{percent}}%','Cancel download','Install and restart','Stop all browsers before installing the update.'] as const){
  expect(en[key]).toBeTruthy();
  expect(ru[key]).toBeTruthy();
  expect(ru[key]).not.toBe(en[key]);
 }
});
