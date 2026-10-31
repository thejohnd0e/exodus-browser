import {sessionSnapshotSchema,type SessionSnapshot} from '../../shared/session';

type Target={targetId:string;type:string;url?:string};
type Persist=(snapshot:SessionSnapshot)=>Promise<void>;

export class SessionTracker {
  private pages=new Map<string,string>();
  private lastNonEmptyUrls:string[]=[];
  private timer:ReturnType<typeof setTimeout>|undefined;
  private dirty=false;
  private disposed=false;
  private revision=0;
  private flushing:Promise<void>|undefined;
  constructor(private persist:Persist,private now=Date.now,private debounceMs=1000){}
  onEvent(message:{method?:string;params?:unknown}):void{
    if(this.disposed)return;
    const params=message.params as {targetInfo?:Target;targetId?:string}|undefined;
    if(message.method==='Target.targetDestroyed'&&typeof params?.targetId==='string'){
      if(this.pages.delete(params.targetId)){
        if(this.pages.size>0)this.schedule();
        else{clearTimeout(this.timer);this.timer=undefined;this.dirty=true;this.revision++;}
      }
      return;
    }
    if(!['Target.targetCreated','Target.targetInfoChanged'].includes(message.method??''))return;
    const target=params?.targetInfo;
    if(!target||target.type!=='page'||typeof target.targetId!=='string')return;
    const checked=sessionSnapshotSchema.shape.urls.element.safeParse(target.url??'');
    if(!checked.success){
      if(this.pages.delete(target.targetId)){
        if(this.pages.size>0)this.schedule();
        else{clearTimeout(this.timer);this.timer=undefined;this.dirty=true;this.revision++;}
      }
      return;
    }
    if(!this.pages.has(target.targetId)&&this.pages.size>=100)return;
    if(this.pages.get(target.targetId)!==checked.data){this.pages.set(target.targetId,checked.data);this.lastNonEmptyUrls=[...this.pages.values()];this.schedule();}
  }
  updateTargets(targets:Target[]):void{
    if(this.disposed)return;
    const targetsById=new Map<string,string>();
    for(const target of targets){
      if(target.type!=='page'||typeof target.targetId!=='string')continue;
      const checked=sessionSnapshotSchema.shape.urls.element.safeParse(target.url??'');
      if(checked.success&&targetsById.size<100)targetsById.set(target.targetId,checked.data);
    }
    const current=new Map<string,string>();
    for(const id of this.pages.keys())if(targetsById.has(id))current.set(id,targetsById.get(id)!);
    for(const [id,url] of targetsById)if(!current.has(id)&&current.size<100)current.set(id,url);
    if(current.size!==this.pages.size||[...current].some(([id,url])=>this.pages.get(id)!==url)){
      const becameEmpty=this.pages.size>0&&current.size===0;
      this.pages=current;
      if(current.size){this.lastNonEmptyUrls=[...current.values()];this.schedule();}
      else if(becameEmpty){clearTimeout(this.timer);this.timer=undefined;this.dirty=true;this.revision++;}
    }
  }
  private schedule(){
    this.dirty=true;this.revision++;clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(()=>undefined);},this.debounceMs);
  }
  async flush(preserveLastOnEmpty=false):Promise<void>{
    clearTimeout(this.timer);this.timer=undefined;
    if(this.flushing){await this.flushing;if(this.dirty)return this.flush(preserveLastOnEmpty);return;}
    if(!this.dirty)return;
    const revision=this.revision;
    const urls=this.pages.size?[...this.pages.values()]:preserveLastOnEmpty?this.lastNonEmptyUrls:[];
    const snapshot=sessionSnapshotSchema.parse({version:1,urls:urls.slice(0,100),updatedAt:new Date(this.now()).toISOString()});
    this.flushing=this.persist(snapshot).then(()=>{if(this.revision===revision)this.dirty=false;});
    try{await this.flushing;}finally{this.flushing=undefined;}
    if(this.dirty)return this.flush(preserveLastOnEmpty);
  }
  dispose():void{this.disposed=true;clearTimeout(this.timer);this.timer=undefined;}
}
