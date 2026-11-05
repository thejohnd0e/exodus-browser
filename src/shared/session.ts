import {z} from 'zod';

const tabUrl=z.string().min(1).max(8192).refine(value=>{
  if(value==='about:blank')return true;
  if(/[\x00-\x20]/.test(value))return false;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}
  catch{return false;}
},'Unsupported saved tab URL');

export const sessionSnapshotSchema=z.object({
  version:z.literal(1),
  urls:z.array(tabUrl).max(100),
  updatedAt:z.string().datetime(),
}).strict();
export type SessionSnapshot=z.infer<typeof sessionSnapshotSchema>;
