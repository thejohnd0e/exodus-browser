import {useEffect,useRef} from 'react';

export type ConfirmDialogProps={title:string;message:string;cancelLabel:string;confirmLabel:string;danger?:boolean;onCancel:()=>void;onConfirm:()=>void};

export function ConfirmDialog({title,message,cancelLabel,confirmLabel,danger=false,onCancel,onConfirm}:ConfirmDialogProps){
 const dialog=useRef<HTMLDivElement>(null);const cancel=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;cancel.current?.focus();return()=>previous?.focus();},[]);
 function onKeyDown(event:React.KeyboardEvent<HTMLDivElement>){
  if(event.key==='Escape'){event.preventDefault();onCancel();return;}
  if(event.key==='Tab'){
   const buttons=dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');if(!buttons?.length)return;
   const first=buttons[0],last=buttons[buttons.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 }
 return <div className="confirm-layer" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel();}}><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" ref={dialog} onKeyDown={onKeyDown}><span className="confirm-symbol" aria-hidden="true">!</span><h2 id="confirm-title">{title}</h2><p id="confirm-message">{message}</p><div className="confirm-actions"><button ref={cancel} onClick={onCancel}>{cancelLabel}</button><button className={danger?'danger confirm-danger':'primary'} onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}
