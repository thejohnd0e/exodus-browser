export type UpdateState =
  |{state:'idle'}
  |{state:'checking'}
  |{state:'up-to-date'}
  |{state:'available';version:string;size:number}
  |{state:'downloading';version:string;received:number;total:number}
  |{state:'ready';version:string}
  |{state:'error';code:string};
