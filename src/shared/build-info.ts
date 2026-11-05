declare const __BUILD_INFO__: {version:string;buildNumber:number};
export const BUILD_INFO=typeof __BUILD_INFO__==='undefined'?{version:'0.1.0',buildNumber:0}:__BUILD_INFO__;
