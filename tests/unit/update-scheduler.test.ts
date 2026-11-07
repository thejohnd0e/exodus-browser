import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {UpdateScheduler,FileCheckTimeStore,CHECK_INTERVAL_MS,STARTUP_DELAY_MS,type CheckTimeStore} from '../../src/main/update/scheduler';

let root:string;
let stored:number|null;
let writes:number[];
const checks=()=>vi.fn(async()=>undefined);
const store:CheckTimeStore={read:async()=>stored,write:async time=>{writes.push(time);stored=time;}};
beforeEach(async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-07T10:00:00Z'));stored=null;writes=[];root=await mkdtemp(join(tmpdir(),'exodus-sched-'));});
afterEach(async()=>{vi.useRealTimers();await rm(root,{recursive:true,force:true});});

describe('UpdateScheduler',()=>{
  it('makes no request while background checks are disabled',async()=>{
    const check=checks();const scheduler=new UpdateScheduler({store,check});
    await scheduler.setEnabled(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS*3);
    expect(check).not.toHaveBeenCalled();
  });

  it('checks shortly after start when it was never checked, then once per interval',async()=>{
    const check=checks();const scheduler=new UpdateScheduler({store,check});
    await scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS-1);expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS-1);expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(check).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('waits out the rest of the interval after a recent check instead of checking on every start',async()=>{
    stored=Date.now()-60*60*1000;
    const check=checks();const scheduler=new UpdateScheduler({store,check});
    await scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS-60*60*1000-1);expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(check).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('records the time of each attempt, even a failed one, so a failure is not retried in a loop',async()=>{
    const check=vi.fn(async()=>{throw new Error('offline');});
    const scheduler=new UpdateScheduler({store,check});
    await scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([Date.now()]);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS-1);expect(check).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('cancels a pending check when disabled and resumes when enabled again',async()=>{
    const check=checks();const scheduler=new UpdateScheduler({store,check});
    await scheduler.setEnabled(true);await scheduler.setEnabled(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS*2);expect(check).not.toHaveBeenCalled();
    await scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);expect(check).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('never runs two checks at once',async()=>{
    let release:()=>void=()=>undefined;let running=0;let peak=0;
    const check=vi.fn(()=>new Promise<void>(resolve=>{running+=1;peak=Math.max(peak,running);release=()=>{running-=1;resolve();};}));
    const scheduler=new UpdateScheduler({store,check});
    await scheduler.setEnabled(true);await scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(1);expect(peak).toBe(1);
    release();scheduler.dispose();
  });
});

describe('FileCheckTimeStore',()=>{
  beforeEach(()=>{vi.useRealTimers();});
  it('round-trips the time and treats a missing, corrupt or future value as never checked',async()=>{
    const file=new FileCheckTimeStore(root);
    expect(await file.read()).toBeNull();
    const now=Date.now();await file.write(now-1000);expect(await file.read()).toBe(now-1000);
    await writeFile(join(root,'update-check.json'),'{not json');expect(await file.read()).toBeNull();
    await writeFile(join(root,'update-check.json'),JSON.stringify({lastCheckedAt:new Date(Date.now()+86400000).toISOString()}));expect(await file.read()).toBeNull();
    await writeFile(join(root,'update-check.json'),JSON.stringify({lastCheckedAt:42}));expect(await file.read()).toBeNull();
  });
  it('does not throw when the state cannot be written',async()=>{
    await writeFile(join(root,'blocker'),'file');
    await expect(new FileCheckTimeStore(join(root,'blocker','sub')).write(Date.now())).resolves.toBeUndefined();
  });
});
