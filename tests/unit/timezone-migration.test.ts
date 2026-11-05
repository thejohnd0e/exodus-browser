import {it,expect} from 'vitest';
import {DEFAULT_FINGERPRINT,normalizeFingerprint,strictFingerprint} from '../../src/shared/fingerprint';

it('migrates the removed proxy time zone mode into plain auto',()=>{
  expect(strictFingerprint({...DEFAULT_FINGERPRINT,timezone:{mode:'proxy'}}).timezone).toEqual({mode:'auto'});
  expect(strictFingerprint({...DEFAULT_FINGERPRINT,timezone:{mode:'proxy',zone:'America/Chicago'}}).timezone).toEqual({mode:'auto'});
  expect(normalizeFingerprint({...DEFAULT_FINGERPRINT,timezone:{mode:'proxy'}}).timezone).toEqual({mode:'auto'});
});

it('drops a saved zone from auto, which now follows the exit IP',()=>{
  expect(strictFingerprint({...DEFAULT_FINGERPRINT,timezone:{mode:'auto',zone:'Europe/Warsaw'}}).timezone).toEqual({mode:'auto'});
  expect(normalizeFingerprint({...DEFAULT_FINGERPRINT,timezone:{mode:'auto'}}).timezone).toEqual({mode:'auto'});
  expect(normalizeFingerprint({...DEFAULT_FINGERPRINT,timezone:{mode:'manual',value:'Asia/Tokyo'}}).timezone).toEqual({mode:'manual',value:'Asia/Tokyo'});
});
