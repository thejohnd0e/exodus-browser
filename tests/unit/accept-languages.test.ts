import { describe, it, expect } from 'vitest';
import { browserLanguages } from '../../src/shared/accept-languages';

describe('browserLanguages', () => {
  it('appends the base language like a default Chrome installation', () => {
    expect(browserLanguages('en-US')).toEqual(['en-US', 'en']);
    expect(browserLanguages('de-DE')).toEqual(['de-DE', 'de']);
    expect(browserLanguages('zh-Hans-CN')).toEqual(['zh-Hans-CN', 'zh']);
    expect(browserLanguages('sr-Latn-RS')).toEqual(['sr-Latn-RS', 'sr']);
  });
  it('keeps a bare language as it is', () => {
    expect(browserLanguages('en')).toEqual(['en']);
  });
});
