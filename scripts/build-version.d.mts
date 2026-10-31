export type BuildInfo={version:string;buildNumber:number};
export function resolveBuildInfo(options:{counterInfo:BuildInfo;packageVersion:string;release:boolean}):BuildInfo;
export function withBuildVersion(options:{root:string;run:(info:BuildInfo)=>Promise<void>}):Promise<BuildInfo>;
export function recoverBuildVersion(options:{root:string;buildNumber:number;confirm:()=>Promise<boolean>}):Promise<void>;
