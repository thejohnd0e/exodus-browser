import {it,expect} from 'vitest';
import {Supervisor} from '../../src/main/runtime/supervisor';
import {ProfileService} from '../../src/main/profiles/service';
import {tempRoot,testSecrets,valid,cleanup} from '../fixtures/profiles';
import {profilePath} from '../../src/main/profiles/paths';
it('blocks an orphan browser or unknown process inventory without terminating any PID',async()=>{
 const root=tempRoot();const profiles=new ProfileService(root,testSecrets());
 try{const a=await profiles.create(valid);const engine={capabilities:{fingerprints:false as const},validate:async()=>{},launch:async()=>{throw Error('must not launch');}};
 const s=new Supervisor(profiles,engine,{probe:async()=>[{pid:42,executable:'other.exe',createdAt:'other time',commandLine:'--user-data-dir='+profilePath(root,a.id)}]});await s.recover();expect(s.states()[a.id]).toBe('blocked');await expect(s.start(a.id)).rejects.toThrow();
 const unknown=new Supervisor(profiles,engine,{probe:async()=>{throw Error('access denied');}});await unknown.recover();expect(unknown.states()[a.id]).toBe('blocked');
 }finally{profiles.close();cleanup(root);}
});
