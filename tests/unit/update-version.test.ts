import {describe,expect,it} from 'vitest';
import {isNewer,parseVersion} from '../../src/main/update/version';

describe('parseVersion',()=>{
  it('accepts plain MAJOR.MINOR.PATCH',()=>{
    expect(parseVersion('1.1.78')).toEqual({major:1,minor:1,patch:78});
  });
  it('rejects prefixes, partial, pre-release and oversized values',()=>{
    for(const text of ['v1.1.78','1.1','1.1.78-beta','1.1.78.1','01.1.78x','1000000.0.0']){
      expect(parseVersion(text)).toBeNull();
    }
  });
});

describe('isNewer',()=>{
  it('compares numerically, not lexically',()=>{
    expect(isNewer('1.10.0','1.9.9')).toBe(true);
    expect(isNewer('1.1.79','1.1.78')).toBe(true);
  });
  it('is false for equal or older versions',()=>{
    expect(isNewer('1.1.78','1.1.78')).toBe(false);
    expect(isNewer('1.1.77','1.1.78')).toBe(false);
  });
  it('treats an invalid candidate as not newer',()=>{
    expect(isNewer('v9.0.0','1.1.78')).toBe(false);
  });
});
