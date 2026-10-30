// Local choices for convenience, not a whitelist of valid BCP47 tags or UI resources.
const codes=['ru-RU','ru','en-US','en-GB','en','de-DE','fr-FR','es-ES','es-MX','pt-BR','pt-PT','it-IT','nl-NL','pl-PL','uk-UA','kk-KZ','tr-TR','et-EE','lv-LV','lt-LT','fi-FI','sv-SE','nb-NO','da-DK','cs-CZ','sk-SK','hu-HU','ro-RO','bg-BG','sr-RS','el-GR','he-IL','ar-SA','hi-IN','id-ID','vi-VN','th-TH','ja-JP','ko-KR','zh-CN','zh-TW'];
const names=new Intl.DisplayNames(['en'],{type:'language'});
export const localeChoices=codes.map(code=>({code,name:names.of(code)??code}));
export function localeName(code:string){try{return names.of(code)??code;}catch{return code;}}
