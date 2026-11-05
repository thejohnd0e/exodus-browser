import {it,expect} from 'vitest';
import {nextZoom,ZOOM_MAX,ZOOM_MIN} from '../../src/renderer/zoom';

it('steps the zoom factor up and down and clamps it',()=>{
 expect(nextZoom('+',1)).toBe(1.1);
 expect(nextZoom('=',1)).toBe(1.1);
 expect(nextZoom('-',1)).toBe(0.9);
 expect(nextZoom('0',1.4)).toBe(1);
 expect(nextZoom('+',ZOOM_MAX)).toBe(ZOOM_MAX);
 expect(nextZoom('-',ZOOM_MIN)).toBe(ZOOM_MIN);
});

it('ignores unrelated keys',()=>{
 for(const key of ['a','Enter','Tab','1'])expect(nextZoom(key,1)).toBeNull();
});
