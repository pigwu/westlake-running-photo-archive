import { planarPixels } from "./sface-utils.js";

export const FUSION_ENGINE = "yunet-2026may-arcface-w600k-r50-rgb-align-v1";
export const FUSION_SIZE = 512;
export const FUSION_THRESHOLD = .48;
export const FUSION_MIN = .30;
export const FUSION_MAX = .80;
export const ARCFACE_SHA256 = "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43";
export const ARCFACE_BYTES = 174383860;
export const ARCFACE_CHUNK_BYTES = 48 * 1024 * 1024;
export function fusionThreshold(value) {
  const number = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
  return Number.isFinite(number) && number >= FUSION_MIN && number <= FUSION_MAX ? number : FUSION_THRESHOLD;
}
export function arcfacePixels(rgba, width=112, height=112) {
  const values=planarPixels(rgba,width,height,"RGB");
  for(let i=0;i<values.length;i++)values[i]=(values[i]-127.5)/127.5;
  return values;
}
// A geometry proxy, not an angle in degrees. Null cannot seed a new group.
export function yawProxy(points) {
  if(points?.length!==5||points.some(p=>p.length!==2||!p.every(Number.isFinite)))return null;
  const [left,right,nose]=points, dx=right[0]-left[0],dy=right[1]-left[1],distance2=dx*dx+dy*dy;
  if(distance2<1)return null;
  return ((nose[0]-(left[0]+right[0])/2)*dx+(nose[1]-(left[1]+right[1])/2)*dy)/distance2;
}
export function boxOverlap(a,b) {
  const area=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
  return area/Math.max(a[2]*a[3]+b[2]*b[3]-area,1e-9);
}
export function preserveReviewPositions(photo, assignments, previous=[]) {
  const result=[...previous], boxes=new Set(previous.map(f=>JSON.stringify(f.box.map(Math.round))));
  for(const key of Object.keys(assignments||{})){
    let parts;try{parts=JSON.parse(key);}catch{continue;}
    if(parts.length!==6||parts[0]!==photo.docid||parts[1]!==photo.rev)continue;
    const box=parts.slice(2);if(!box.every(Number.isFinite)||box[2]<=0||box[3]<=0)continue;
    const signature=JSON.stringify(box.map(Math.round));if(!boxes.has(signature)){result.push({box});boxes.add(signature);}
  }
  if(result.length>200)throw new Error("此照片的人工记录超过 200 张人脸，请先检查归属记录。");
  return result;
}
// Preserve the exact old boxes (and hence review keys) when re-extracting.
// A missing or ambiguous detection is retained for manual review, never dropped.
export function preserveFaceBoxes(previous, detected) {
  if(!previous?.length)return detected;
  const boxes=detected.map(b=>[b.x,b.y,b.width,b.height]), used=new Set();
  const result=previous.map(face=>{
    const matches=boxes.map((b,i)=>({i,score:boxOverlap(face.box,b)})).filter(m=>m.score>=.35).sort((a,b)=>b.score-a.score||a.i-b.i);
    const best=matches[0], valid=best&&!used.has(best.i)&&(!matches[1]||best.score-matches[1].score>=.1);
    if(valid)used.add(best.i);
    const [x,y,width,height]=face.box;
    return {...(valid?detected[best.i]:{}),x,y,width,height,...(!valid?{migrationReason:"未恢复关键点"}:{}),previousAvatar:face.avatar};
  });
  for(let i=0;i<detected.length;i++)if(!used.has(i)&&!previous.some(f=>boxOverlap(f.box,boxes[i])>=.2))result.push(detected[i]);
  result.totalDetected=Math.max(detected.totalDetected||detected.length,result.length);
  return result.slice(0,200).reduce((list,b)=>{list.push(b);list.totalDetected=result.totalDetected;return list;},[]);
}
