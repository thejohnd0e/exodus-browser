import {writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {ProfileState,ProxyInput} from '../../shared/contracts';
import {ProfileService} from '../profiles/service';
import {profilePath} from '../profiles/paths';
import type {BrowserEngineAdapter,EngineProcess,ProxyLease} from '../engines/types';
import {openProxyBridge} from '../proxy/bridge';
import {probeProfileProcesses,type ProcessRecord} from './recovery';
import type {SessionStore} from '../sessions/store';
type Run={process:EngineProcess;lease?:ProxyLease;proxyVersion:string|null};
export class Supervisor {
  private state:Record<string,ProfileState>={};private locks=new Set<string>();
  private running=new Map<string,Run>();
  private probe:()=>Promise<ProcessRecord[]>;private bridge:(p:ProxyInput)=>Promise<ProxyLease>;
  constructor(private profiles:ProfileService,private engine:BrowserEngineAdapter,options:{probe?:()=>Promise<ProcessRecord[]>;bridge?:(p:ProxyInput)=>Promise<ProxyLease>;sessions?:SessionStore;extensionDirectory?:(id:string)=>string}={}){this.probe=options.probe??probeProfileProcesses;this.bridge=options.bridge??openProxyBridge;this.sessions=options.sessions;this.extensionDirectory=options.extensionDirectory??(id=>id);}
  private sessions?:SessionStore;
  private extensionDirectory:(id:string)=>string;
  states(){return {...this.state};}
  hasActiveWork():boolean{return this.locks.size>0||this.running.size>0||Object.values(this.state).some(s=>['starting','running','stopping','blocked'].includes(s));}
  runningProxyVersions():Record<string,string|null>{return Object.fromEntries([...this.running].map(([id,run])=>[id,run.proxyVersion]));}
  private journal(id:string){return join(this.profiles.root,'runtime-'+id+'.json');}
  async assertStopped(id:string){this.profiles.get(id);if(this.running.has(id)||this.locks.has(id)||['starting','running','stopping','blocked'].includes(this.state[id]))throw Error('PROFILE_BUSY');}
  async withStopped<T>(id:string,fn:()=>Promise<T>):Promise<T>{await this.assertStopped(id);if(this.locks.has(id))throw Error('PROFILE_BUSY');this.locks.add(id);try{return await fn();}finally{this.locks.delete(id);}}
  async recover(){
    const profiles=await this.profiles.list();
    let journals:Set<string>;try{journals=new Set((await readdir(this.profiles.root)).filter(n=>n.startsWith('runtime-')));}catch{journals=new Set();}
    try{const rows=await this.probe();for(const p of profiles){if(this.running.has(p.id)||this.locks.has(p.id))continue;const dir=profilePath(this.profiles.root,p.id).toLowerCase();const journal='runtime-'+p.id+'.json';
        this.state[p.id]=journals.has(journal)||rows.some(r=>r.commandLine.toLowerCase().includes(dir))?'blocked':'stopped';}}
    catch{for(const p of profiles)if(!this.running.has(p.id))this.state[p.id]='blocked';}
  }
  async start(id:string){
    await this.assertStopped(id);if(this.locks.has(id)||this.running.has(id))throw Error('PROFILE_BUSY');this.locks.add(id);this.state[id]='starting';let lease:ProxyLease|undefined;
    try{
      const rows=await this.probe();const dir=profilePath(this.profiles.root,id);
      if(rows.some(r=>r.commandLine.toLowerCase().includes(dir.toLowerCase()))){this.state[id]='blocked';throw Error('ORPHAN_BROWSER');}
       const p=this.profiles.getLaunchInput(id);await this.engine.validate();if(p.proxy)lease=await this.bridge(p.proxy);
       let startUrls=p.startUrls;
       if(p.restoreLastSession&&this.sessions){const snapshot=await this.sessions.read(id).catch(()=>null);if(snapshot?.urls.length)startUrls=snapshot.urls;}
       const process=await this.engine.launch({profileId:id,userDataDir:dir,startUrls,languages:p.languages,fingerprint:p.fingerprint,fingerprintSeed:p.fingerprintSeed,proxyUrl:lease?.url,extensionDirs:p.extensionIds.map(extensionId=>this.extensionDirectory(extensionId)),onSessionSnapshot:this.sessions?value=>this.sessions!.write(id,value):undefined});
      const run:Run={process,lease,proxyVersion:p.proxyVersion};this.running.set(id,run);
      void process.exit.then(async result=>{
        if(this.running.get(id)!==run)return;
        try{await lease?.close();if(this.running.get(id)!==run)return;this.state[id]=result.code===0?'stopped':'error';await rm(this.journal(id),{force:true});}
        catch{this.state[id]='blocked';}
        finally{if(this.running.get(id)===run)this.running.delete(id);}
      });
      // The lifecycle observer is installed before journal IO, so a failed write cannot orphan an untracked browser.
      await writeFile(this.journal(id),JSON.stringify({pid:process.pid,executable:process.executable,startedAt:process.startedAt,userDataDir:dir}));
      if(this.running.get(id)===run)this.state[id]='running';
    }catch(e){if(!this.running.has(id))await lease?.close();if(this.state[id]!=='blocked')this.state[id]=this.running.has(id)?'blocked':'error';throw e;}finally{this.locks.delete(id);}
  }
  async stop(id:string){
    if(this.locks.has(id))throw Error('PROFILE_BUSY');const active=this.running.get(id);if(!active){if(this.state[id]==='blocked')throw Error('ORPHAN_BROWSER');return;}
    this.locks.add(id);this.state[id]='stopping';
    try{await active.process.stop();await active.process.exit;await active.lease?.close();if(this.running.get(id)===active)this.running.delete(id);await rm(this.journal(id),{force:true});this.state[id]='stopped';}
    catch(e){this.state[id]='blocked';throw e;}finally{this.locks.delete(id);}
  }
  async shutdown(){const results=await Promise.allSettled([...this.running.keys()].map(id=>this.stop(id)));if(results.some(r=>r.status==='rejected')||this.locks.size)throw Error('SHUTDOWN_BLOCKED');}
}
