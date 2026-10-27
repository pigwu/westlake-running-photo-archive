export function recommendedPhotoConcurrency(cores=2,memory=4) {
  return cores>=12&&memory>=8?4:cores>=4&&memory>=4?2:1;
}
export function normalizePhotoConcurrency(value,fallback=1) {
  const n=Number(value);return [1,2,4,6,8].includes(n)?n:fallback;
}
// Each lane owns its model; indices are claimed once even when completion order differs.
export async function runConcurrentPhotos(items,count,handle,signal) {
  let next=0;
  await Promise.all(Array.from({length:Math.min(items.length,count)},async(_,lane)=>{
    while(next<items.length&&!signal?.aborted){const index=next++;await handle(items[index],index,lane);}
  }));
}
