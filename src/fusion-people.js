import { buildSeedPeople, candidateGroups } from "./people.js";
import { cosineSimilarity } from "./sface-utils.js";
import { FUSION_SIZE, fusionThreshold } from "./fusion-utils.js";

const valid=face=>face.descriptor?.length===FUSION_SIZE;
const pose=face=>Number.isFinite(face.yawProxy)?Math.abs(face.yawProxy):Infinity;
export function fusionEvidence(face,samples) {
  if(!valid(face))return null;
  const scores=samples.filter(valid).map(f=>cosineSimilarity(face.descriptor,f.descriptor)).sort((a,b)=>b-a);
  if(!scores.length)return null;
  const peak=scores[0],second=scores[1]??-1,score=scores.length>1?.65*peak+.35*second:peak;
  return {peak,second,score,support:scores.length>1?(peak+second)/2:peak,mean:scores.reduce((a,b)=>a+b,0)/scores.length};
}
export function buildFusionPeople(input,threshold,review={assignments:{},names:{}}) {
  threshold=fusionThreshold(threshold);
  const faces=[...input].sort((a,b)=>a.key.localeCompare(b.key)),assignments=review.assignments||{};
  // Reuse the established manual-conflict handling and ignore semantics.
  const protectedFaces=faces.filter(f=>assignments[f.key]||!f.descriptor);
  const result=buildSeedPeople(protectedFaces,threshold,review),groups=result.groups;
  const automatic=faces.filter(f=>!assignments[f.key]&&valid(f));
  if(automatic.length>1500)throw new Error("这个相册超过 1500 张待自动分组的人脸，请先按活动拆分相册后再分组。");
  const core=automatic.filter(f=>pose(f)<=.8&&f.detectorScore>=.8&&f.sharpness>=25);
  const clustered=buildSeedPeople(core,threshold,{assignments:{},names:review.names||{}}).groups;
  for(const g of clustered){
    if(g.faces.length<2||!g.faces.some(f=>pose(f)<=.35))continue;
    const sims=[];for(let i=0;i<g.faces.length;i++)for(let j=i+1;j<g.faces.length;j++)sims.push(cosineSimilarity(g.faces[i].descriptor,g.faces[j].descriptor));
    const mean=sims.reduce((a,b)=>a+b,0)/sims.length;
    const anchor=g.faces.some(f=>f.sharpness>=90&&f.box[2]>=90&&pose(f)<=.5);
    if(g.faces.length<=5&&mean<.52&&(!anchor||sims.filter(s=>s>=threshold).length/sims.length<.5))continue;
    groups.push(g);
  }
  // Freeze seed membership before any second-pass addition.
  const profiles=groups.map(g=>({group:g,samples:[...g.faces].filter(valid)}));
  const assigned=new Set(groups.flatMap(g=>g.faces.map(f=>f.key))),proposals=[],pending=[];
  const hold=(face,reason)=>pending.push({...face,reason,groupId:`review:${face.key}`,groupName:"待确认归属"});
  for(const face of automatic.filter(f=>!assigned.has(f.key))){
    const candidates=profiles.map(p=>{const evidence=fusionEvidence(face,p.samples);return evidence?{...p,...evidence}:null;}).filter(Boolean).sort((a,b)=>b.score-a.score||a.group.id.localeCompare(b.group.id));
    const best=candidates[0];
    if(!best){hold(face,"暂无可靠人物样本，可手动确认正脸和侧脸。");continue;}
    const margin=candidates[1]?best.score-candidates[1].score:1;
    if(best.group.photos.includes(face.photoId)){hold(face,"候选人物已出现在同一张照片中，请人工确认。");continue;}
    const high=(best.second>=Math.max(.30,threshold-.18)&&best.score>=Math.max(.45,threshold-.03))||best.peak>=Math.max(.60,threshold+.12);
    if(!high){hold(face,"多角度匹配证据不足，请确认归属。");continue;}
    if(margin<.08){hold(face,"与多个人物的匹配分数接近，请确认归属。");continue;}
    proposals.push({face,target:best.group,score:best.score});
  }
  const claims=new Map();for(const p of proposals){const key=JSON.stringify([p.target.id,p.face.photoId]);if(!claims.has(key))claims.set(key,[]);claims.get(key).push(p);}
  for(const candidates of claims.values()){
    candidates.sort((a,b)=>b.score-a.score||a.face.key.localeCompare(b.face.key));
    const ambiguous=candidates.length>1&&candidates[0].score-candidates[1].score<.08;
    candidates.forEach((p,i)=>{if(ambiguous||i>0){hold(p.face,"同一照片的多张脸匹配到这个人物，请人工确认。");return;}
      p.target.faces.push({...p.face,suggested:true,matchScore:p.score});p.target.photos.push(p.face.photoId);p.target.suggestedCount++;
    });
  }
  faces.filter(f=>!assignments[f.key]&&f.descriptor&&!valid(f)).forEach(f=>hold(f,"此照片仍使用旧版特征，请升级融合索引后匹配。"));
  groups.sort((a,b)=>Number(b.manual)-Number(a.manual)||b.faces.length-a.faces.length||a.id.localeCompare(b.id));
  groups.forEach((g,i)=>{g.name=review.names?.[g.id]||`${g.manual?"已确认人物":"人物"} ${i+1}`;g.engine="fusion";});
  result.pending=pending.sort((a,b)=>a.key.localeCompare(b.key)).map(f=>({...f,candidates:candidateGroups(f,groups,f.groupId)}));
  return {...result,engine:"fusion"};
}
