import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const CHECK_INTERVAL_MS=24*60*60*1000;
export const STARTUP_DELAY_MS=60*1000;

export interface CheckTimeStore {
  read():Promise<number|null>;
  write(time:number):Promise<void>;
}

export type UpdateSchedulerOptions={
  /** Runs one background check. Failures are the caller's to hide; the scheduler only needs it to settle. */
  check:()=>Promise<unknown>;
  store:CheckTimeStore;
};

/** Keeps the time of the last attempt in `update-check.json` inside the application data root. */
export class FileCheckTimeStore implements CheckTimeStore {
  constructor(private readonly root:string){}

  private path():string{
    return join(this.root,'update-check.json');
  }

  async read():Promise<number|null>{
    try{
      const parsed=JSON.parse(await readFile(this.path(),'utf8')) as {lastCheckedAt?:unknown};
      const time=typeof parsed.lastCheckedAt==='string'?Date.parse(parsed.lastCheckedAt):NaN;
      // A timestamp from the future (clock change) must not postpone checks indefinitely.
      return Number.isFinite(time)&&time<=Date.now()?time:null;
    }catch{
      return null;
    }
  }

  async write(time:number):Promise<void>{
    try{
      await mkdir(this.root,{recursive:true});
      const file=this.path();
      const temporary=`${file}.partial-${randomUUID()}`;
      try{await writeFile(temporary,JSON.stringify({lastCheckedAt:new Date(time).toISOString()})+'\n',{flag:'wx'});await rename(temporary,file);}
      finally{await rm(temporary,{force:true});}
    }catch{
      /* Without a stored time the next start simply checks after the startup delay. */
    }
  }
}

/**
 * Runs the opt-in background update check about once a day (DECISIONS #71). Nothing is scheduled
 * until `setEnabled(true)`, so with the option off the application makes no network call of its own.
 * The time of every attempt is stored, including failed ones, so a restart loop or an offline
 * machine cannot turn into a stream of requests.
 */
export class UpdateScheduler {
  private enabled=false;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private running=false;
  private generation=0;

  constructor(private readonly options:UpdateSchedulerOptions){}

  async setEnabled(enabled:boolean):Promise<void>{
    if(enabled===this.enabled&&(enabled===false||this.timer||this.running))return;
    this.enabled=enabled;
    this.clear();
    if(!enabled)return;
    const generation=++this.generation;
    const last=await this.options.store.read();
    if(!this.enabled||generation!==this.generation)return;
    const due=last===null?STARTUP_DELAY_MS:Math.max(STARTUP_DELAY_MS,last+CHECK_INTERVAL_MS-Date.now());
    this.schedule(due);
  }

  dispose():void{
    this.enabled=false;
    this.generation+=1;
    this.clear();
  }

  private clear():void{
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
  }

  private schedule(delay:number):void{
    this.clear();
    this.timer=setTimeout(()=>{this.timer=null;void this.run();},delay);
    // A pending check must never keep the process alive.
    (this.timer as {unref?:()=>void}).unref?.();
  }

  private async run():Promise<void>{
    if(!this.enabled||this.running)return;
    this.running=true;
    try{
      await this.options.store.write(Date.now());
      await this.options.check();
    }catch{
      /* A failed or interrupted check is retried at the next interval, never immediately. */
    }finally{
      this.running=false;
      if(this.enabled)this.schedule(CHECK_INTERVAL_MS);
    }
  }
}
