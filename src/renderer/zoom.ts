export const ZOOM_MIN=0.75;
export const ZOOM_MAX=1.75;
export const ZOOM_STEP=0.1;

const round=(value:number)=>Math.round(value*100)/100;

/** Returns the next zoom factor for a Ctrl/Cmd shortcut, or null when the key is unrelated. */
export function nextZoom(key:string,current:number):number|null{
  if(key==='+'||key==='=')return round(Math.min(ZOOM_MAX,current+ZOOM_STEP));
  if(key==='-'||key==='_')return round(Math.max(ZOOM_MIN,current-ZOOM_STEP));
  if(key==='0')return 1;
  return null;
}
