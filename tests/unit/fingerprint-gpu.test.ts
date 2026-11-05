import {it,expect} from 'vitest';
import {newFingerprint} from '../../src/shared/fingerprint-presets';
import type {Fingerprint} from '../../src/shared/fingerprint';

const manualGpu=(fingerprint:Fingerprint)=>{
  if(fingerprint.webglInfo.mode!=='manual')throw Error('expected a manual WebGL preset');
  return fingerprint.webglInfo;
};

const generate=(hostGpuVendors?:readonly string[],random=()=>0)=>newFingerprint({os:'windows11',chromeVersion:'156.0.8078.80',random,hostGpuVendors});

it('only picks a GPU family that exists on the host',()=>{
 for(const random of [0,0.2,0.4,0.6,0.8,0.99]){
  const gpu=manualGpu(generate(['NVIDIA','Intel'],()=>random));
  expect(gpu.vendor).not.toContain('AMD');
 }
});

it('offers several card models within the installed family',()=>{
 const models=new Set<string>();
 for(let step=0;step<20;step++)models.add(manualGpu(generate(['NVIDIA','Intel'],()=>step/20)).renderer);
 expect(models.size).toBeGreaterThan(1);
});

it('falls back to the OS catalog when no host family is known',()=>{
 expect(manualGpu(generate()).vendor.length).toBeGreaterThan(0);
});

it('matches the installed card only when the opt-in list is provided',()=>{
 for(const random of [0,0.3,0.6,0.9]){
  const gpu=manualGpu(newFingerprint({os:'windows11',chromeVersion:'156.0.8078.80',random:()=>random,hostGpuVendors:['NVIDIA','Intel'],hostGpuModels:['NVIDIA GeForce RTX 3060']}));
  expect(gpu.renderer).toContain('RTX 3060');
  expect(gpu.renderer).not.toContain('RTX 3060 Ti');
 }
});
