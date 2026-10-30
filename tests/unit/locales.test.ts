import {it,expect} from 'vitest';
import {localeName} from '../../src/shared/locales';
import {localeSchema} from '../../src/shared/validation';
it.each(['en-u-ca-gregory','de-DE-x-test'])('keeps valid custom locale %s displayable when Intl.DisplayNames cannot name it',code=>{
 expect(localeSchema.parse(code)).toBe(code);
 expect(localeName(code)).toBe(code);
});
