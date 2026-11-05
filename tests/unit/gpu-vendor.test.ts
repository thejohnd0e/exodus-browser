import {it,expect} from 'vitest';
import {gpuVendorsFromDevices} from '../../src/main/engines/gpu-vendor';

it('maps known PCI vendor ids to preset families regardless of the active flag',()=>{
 expect(gpuVendorsFromDevices([{vendorId:0x8086},{vendorId:0x10de}])).toEqual(['Intel','NVIDIA']);
 expect(gpuVendorsFromDevices([{vendorId:0x1002}])).toEqual(['AMD']);
});

it('ignores unknown and software renderers',()=>{
 expect(gpuVendorsFromDevices([{vendorId:0x1414},{vendorId:0xffff}])).toEqual([]);
 expect(gpuVendorsFromDevices([])).toEqual([]);
});

it('deduplicates repeated adapters',()=>{
 expect(gpuVendorsFromDevices([{vendorId:0x8086},{vendorId:0x8086},{vendorId:0x10de}])).toEqual(['Intel','NVIDIA']);
});
