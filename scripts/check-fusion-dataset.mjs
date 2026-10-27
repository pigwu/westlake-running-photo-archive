// Read-only local regression against the recorded experiment; never uploads.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildPeople } from '../src/people.js';
import { FUSION_ENGINE } from '../src/fusion-utils.js';
const root=path.resolve('tmp/face-experiment'),dataset=JSON.parse(await fs.readFile(path.join(root,'dataset.json'),'utf8'));
const output=[];
let smoke;
for(const album of dataset.albums){
  const faces=[];
  for(const photo of album.photos){
    const records=JSON.parse(await fs.readFile(path.join(root,'features',photo.docid.split('/').at(-1)+'.json'),'utf8'));
    for(const f of records){
      const avatar='data:image/jpeg;base64,'+(await fs.readFile(path.join(root,f.crop))).toString('base64');
      faces.push({...f,descriptor:f.sface?f.arcface:undefined,engine:FUSION_ENGINE,avatar,...(f.sface&&!f.arcface?{reason:'未恢复关键点'}:{})});
    }
    if(!smoke && records.filter(f=>f.sface&&f.arcface).length===1){
      const f=records.find(f=>f.sface&&f.arcface);
      smoke={photo:'/tmp/face-experiment/'+photo.local,box:{x:f.box[0],y:f.box[1],width:f.box[2],height:f.box[3],score:f.detectorScore,landmarks:f.landmarks},expected:f.arcface};
    }
  }
  const model=buildPeople(faces,.48,album.review);
  const represented=[...model.groups.flatMap(g=>g.faces),...model.pending,...model.ignored,...model.unrecognized,...model.conflicts];
  assert.equal(represented.length,faces.length);assert.equal(new Set(represented.map(f=>f.key)).size,faces.length);
  for(const group of model.groups)assert.equal(new Set(group.photos).size,group.faces.length);
  const confirmed=faces.filter(f=>album.review.assignments[f.key]&&album.review.assignments[f.key]!=='ignore');
  for(const f of confirmed)assert.ok(model.groups.some(g=>g.id===album.review.assignments[f.key]&&g.faces.some(item=>item.key===f.key)));
  const summary={album:album.title,groups:model.groups.length,pending:model.pending.length,manual:confirmed.length,suggested:model.groups.reduce((n,g)=>n+g.suggestedCount,0)};
  console.log(JSON.stringify(summary));output.push({id:album.id,title:album.title,model,faces,summary});
}
await fs.writeFile(path.join(root,'fusion-final.json'),JSON.stringify(output));
await fs.writeFile(path.join(root,'fusion-smoke.json'),JSON.stringify(smoke));
console.log('PASS: all detections accounted for, manual identities retained, no same-photo conflicts.');
