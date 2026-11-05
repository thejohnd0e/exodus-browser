export type SenderEvent={sender:unknown;senderFrame:{url:string}|null};
export type TrustedContents={id:number;mainFrame:unknown};
/** Accepts only the exact top-level frame of our own renderer, loaded from the packaged UI document. */
export function isTrustedSender(event:SenderEvent,contents:TrustedContents,ui:string){
  return event.sender===contents&&event.senderFrame!==null&&event.senderFrame===contents.mainFrame&&event.senderFrame.url===ui;
}
