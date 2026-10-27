import test from "node:test";
import assert from "node:assert/strict";
import {buildReferenceProfiles,matchReferencePerson} from "./reference-people.js";
const face=(key,degrees=0,extra={})=>{const a=degrees*Math.PI/180;return {key,photoId:key,descriptor:[Math.cos(a),Math.sin(a),...Array(510).fill(0)],yawProxy:0,sharpness:100,...extra};};
const group=(id,faces,manual=true)=>({id,name:id,faces,manual,photos:faces.map(f=>f.photoId),avatar:'avatar'});
const profiles=groups=>buildReferenceProfiles(groups,groups.flatMap(g=>g.photos));

test("reference selects a category and returns all members including distant profiles and manual faces without features",()=>{
  const front=face('front'),side=face('side',100),blur=face('manual-blur',0,{descriptor:undefined}),g=group('本人',[front,side,blur]);
  const result=matchReferencePerson(face('query'),profiles([g]),.48);
  assert.equal(result.automatic,'本人');assert.deepEqual(result.candidates[0].photos,['front','side','manual-blur']);
  assert.equal(result.candidates[0].photos.length,3);
});
test("ambiguous people remain separate candidates rather than pooling unrelated photos",()=>{
  const a=group('甲',[face('a',0),face('a2',3)]),b=group('乙',[face('b',5),face('b2',8)]);
  const result=matchReferencePerson(face('query',4),profiles([a,b]),.48);
  assert.equal(result.automatic,null);assert.equal(result.candidates.length,2);
  assert.deepEqual(result.candidates.find(g=>g.id==='甲').photos,['a','a2']);
  assert.deepEqual(result.candidates.find(g=>g.id==='乙').photos,['b','b2']);
});
test("distant side views cannot demote an exact match or hide a competing identity",()=>{
  const target=group('多角度本人',[face('front'),face('side',170)]);
  const distractors=[20,25,30].map((angle,i)=>group('其他'+i,[face('x'+i,angle),face('y'+i,angle+1)]));
  assert.equal(matchReferencePerson(face('query'),profiles([...distractors,target]),.48).candidates[0].id,target.id);
  const duplicate=group('近似人物',[face('b'),face('b2',1)]);
  assert.equal(matchReferencePerson(face('query'),profiles([target,duplicate]),.48).automatic,null);
});
test("an automatic suggestion cannot become a matching anchor, but stays in its category's returned photos",()=>{
  const g=group('类别',[face('anchor',90),face('suggestion',0,{suggested:true})]);
  const built=profiles([g]);assert.equal(matchReferencePerson(face('query'),built,.48).candidates.length,0);
  assert.deepEqual(matchReferencePerson(face('query',90),built,.48).candidates[0].photos,['anchor','suggestion']);
});
test("ignored faces, deleted photos and unclassified singletons do not enter category lookup",()=>{
  const a=face('visible'),b=face('ignored'),c=face('deleted');
  const built=buildReferenceProfiles([group('甲',[a,b,c]),group('singleton',[face('lonely')],false)],['visible','ignored','lonely'],new Set(['ignored']));
  assert.equal(built.length,1);assert.deepEqual(built[0].photos,['visible']);assert.deepEqual(built[0].samples,[a]);
  assert.equal(matchReferencePerson(face('query',180),built,.48).automatic,null);
});
test("representative views are bounded, deterministic and retain profile diversity",()=>{
  const faces=Array.from({length:100},(_,i)=>face('p'+i,i*1.5));
  const a=profiles([group('本人',faces)]),b=profiles([group('本人',[...faces].reverse())]);
  assert.equal(a[0].samples.length,12);assert.deepEqual(a[0].samples,b[0].samples);
  const match=matchReferencePerson(face('query',145),a,.48);assert.equal(match.automatic,'本人');assert.equal(match.candidates[0].photos.length,100);
});
test("no identity is fabricated when no group matches, and old vectors cannot be used",()=>{
  assert.deepEqual(matchReferencePerson(face('query'),[],.48),{candidates:[],automatic:null});
  assert.deepEqual(profiles([group('old',[face('old',0,{descriptor:[1,...Array(127).fill(0)]})])]),[]);
  const built=profiles([group('weak',[face('anchor',55)])]);
  const result=matchReferencePerson(face('query'),built,.48);assert.equal(result.candidates.length,1);assert.equal(result.automatic,null);
  assert.equal(matchReferencePerson(face('query'),built,.8).candidates.length,0);
});
