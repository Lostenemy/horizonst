// This is a resource bound, NOT an accepted operating-capacity/SLA limit.
export const PRESENCE_CLOSE_CONCURRENCY=4;
export async function runBoundedPresenceClosures<T>(items:T[],close:(item:T)=>Promise<void>,
  onError:(item:T,error:unknown)=>void,concurrency=PRESENCE_CLOSE_CONCURRENCY):Promise<void>{
  let index=0;
  const worker=async()=>{while(index<items.length){const item=items[index++];
    try{await close(item);}catch(error){onError(item,error);}
  }};
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),items.length)},worker));
}

export function nonOverlapping(work:()=>Promise<void>):()=>Promise<void>{
  let running:Promise<void>|undefined;
  return()=>{
    if(!running)running=work().finally(()=>{running=undefined;});
    return running;
  };
}
