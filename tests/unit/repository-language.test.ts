import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {localeName} from '../../src/shared/locales';
import {parseProfileInput} from '../../src/shared/validation';

it('keeps GitHub-bound repository text free of Cyrillic prose',()=>{
  const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const violations:string[]=[];
  for(const file of new Set(files)){
    if(/\p{Script=Cyrillic}/u.test(file))violations.push(`${file}: filename`);
    const bytes=readFileSync(file);
    if(bytes.includes(0))continue;
    bytes.toString('utf8').split('\n').forEach((line,index)=>{
      if(/\p{Script=Cyrillic}/u.test(line))violations.push(`${file}:${index+1}`);
    });
  }
  expect(violations.length,`Translate repository prose and fixtures before publishing to GitHub: ${violations.slice(0,30).join(', ')}`).toBe(0);
});

it('uses English language names without restricting supported locale codes',()=>{
  expect(localeName('ru')).toBe('Russian');
  expect(localeName('en')).toBe('English');
  expect(localeName('de')).toBe('German');
});

it('does not apply the publication language policy to user-entered profile data',()=>{
  const name=String.fromCodePoint(0x0410,0x03a9,0x4e2d,0x1f512);
  const result=parseProfileInput({name,note:name,startUrls:['about:blank'],languages:['ru-RU'],proxyId:null});
  expect(result.name).toBe(name);
  expect(result.note).toBe(name);
  expect(result.languages).toEqual(['ru-RU']);
});
