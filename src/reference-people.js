import {cosineSimilarity} from "./sface-utils.js";
import {fusionEvidence} from "./fusion-people.js";
import {FUSION_SIZE,fusionThreshold} from "./fusion-utils.js";

const valid=f=>f.descriptor?.length===FUSION_SIZE&&f.descriptor.every(Number.isFinite);
// Build once when the classification changes. Keep diverse confirmed/seed views,
// rather than rescanning every photo for each reference face.
export function buildReferenceProfiles(groups,photoIds,excluded=new Set(),limit=12){
  const visible=new Set(photoIds);
  return groups.filter(g=>g.manual||g.faces.length>1).flatMap(group=>{
    const members=group.faces.filter(f=>visible.has(f.photoId)&&!excluded.has(f.key));
    const eligible=members.filter(f=>!f.suggested&&valid(f)).sort((a,b)=>
      Math.abs(a.yawProxy??1)-Math.abs(b.yawProxy??1)||(b.sharpness||0)-(a.sharpness||0)||String(a.key).localeCompare(String(b.key)));
    if(!eligible.length)return [];
    const samples=[eligible[0]],remaining=eligible.slice(1).map(face=>({face,nearest:cosineSimilarity(face.descriptor,samples[0].descriptor)}));
    while(samples.length<limit&&remaining.length){
      let best=0;for(let i=1;i<remaining.length;i++)if(remaining[i].nearest<remaining[best].nearest)best=i;
      const sample=remaining.splice(best,1)[0].face;samples.push(sample);
      for(const item of remaining)item.nearest=Math.max(item.nearest,cosineSimilarity(item.face.descriptor,sample.descriptor));
    }
    return [{id:group.id,name:group.name,manual:group.manual,avatar:group.avatar,samples,photos:[...new Set(members.map(f=>f.photoId))]}];
  });
}
export function matchReferencePerson(face,profiles,threshold){
  if(!face||!valid(face))return {candidates:[],automatic:null};
  const t=fusionThreshold(threshold);
  const ranked=profiles.map(profile=>({profile,evidence:fusionEvidence(face,profile.samples)}))
    .filter(c=>c.evidence&&Number.isFinite(c.evidence.score)&&c.evidence.peak>=t)
    // A distant confirmed side view must not hide an exact frontal match.
    .sort((a,b)=>b.evidence.peak-a.evidence.peak||b.evidence.score-a.evidence.score||a.profile.id.localeCompare(b.profile.id));
  const best=ranked[0],margin=ranked[1]?best.evidence.peak-ranked[1].evidence.peak:1;
  const strong=best&&((best.evidence.second>=Math.max(.30,t-.18)&&best.evidence.score>=Math.max(.45,t-.03))||best.evidence.peak>=Math.max(.60,t+.12));
  return {candidates:ranked.slice(0,3).map(({profile,evidence})=>({...profile,score:evidence.peak})),automatic:strong&&margin>=.08?best.profile.id:null};
}
