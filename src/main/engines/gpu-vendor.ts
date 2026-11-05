const FAMILIES:Record<number,string>={0x10de:'NVIDIA',0x1002:'AMD',0x8086:'Intel',0x106b:'Apple'};

/**
 * Maps the host adapters reported by `app.getGPUInfo('basic')` to the GPU families used by the
 * fingerprint presets. Windows often reports `active: false` for every adapter, so membership of
 * the machine is used instead of a single "active" card. Software renderers are ignored.
 */
export function gpuVendorsFromDevices(devices:readonly {vendorId?:number}[]):string[]{
 const found=new Set<string>();
 for(const device of devices){
  const family=FAMILIES[device.vendorId??0];
  if(family)found.add(family);
 }
 return [...found];
}

/** Adapter names such as "NVIDIA GeForce RTX 3060", used when the user asks to match the installed card. */
export function gpuModelsFromDevices(devices:readonly {vendorId?:number;deviceString?:string}[]):string[]{
 const models=new Set<string>();
 for(const device of devices){
  if(!FAMILIES[device.vendorId??0])continue;
  const name=device.deviceString?.trim();
  if(name)models.add(name);
 }
 return [...models];
}
