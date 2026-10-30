import {it,expect} from 'vitest';
import {validateEntryPath} from '../../src/main/backups/archive';
it.each(['../escape','/absolute','C:/secret','folder/file:stream','folder/CON','a/../b','a\\b','a./b','a /b','NUL.txt'])('rejects unsafe archive path %s',p=>expect(()=>validateEntryPath(p)).toThrow());
it('accepts ordinary Unicode archive paths',()=>expect(validateEntryPath('data/Work profile \u00e9/Cookies')).toBe('data/Work profile \u00e9/Cookies'));
