import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {it,expect} from 'vitest';

it('provides a valid 256px Windows icon generated from Exodus artwork',()=>{
  const icon=readFileSync(fileURLToPath(new URL('../../ico/exodus-icon.ico',import.meta.url)));
  expect(icon.readUInt16LE(0)).toBe(0);
  expect(icon.readUInt16LE(2)).toBe(1);
  const imageCount=icon.readUInt16LE(4);
  expect(imageCount).toBeGreaterThan(0);
  let has256=false;
  for(let i=0;i<imageCount;i++){
    const entry=6+i*16;
    const width=icon[entry]||256;
    const height=icon[entry+1]||256;
    const bytes=icon.readUInt32LE(entry+8);
    const offset=icon.readUInt32LE(entry+12);
    expect(offset+bytes).toBeLessThanOrEqual(icon.length);
    const image=icon.subarray(offset,offset+bytes);
    if(image.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){
      expect(image.readUInt32BE(16)).toBe(width);
      expect(image.readUInt32BE(20)).toBe(height);
    }else{
      expect(image.readUInt32LE(0)).toBe(40);
      expect(image.readInt32LE(4)).toBe(width);
      expect(image.readInt32LE(8)/2).toBe(height);
    }
    if(width===256&&height===256)has256=true;
  }
  expect(has256).toBe(true);
});
