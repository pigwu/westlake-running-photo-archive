import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildPeople} from '../src/people.js';
import {cacheSimilarities,clearSimilarityCache} from '../src/sface-utils.js';
const albums=JSON.parse(await fs.readFile('tmp/face-experiment/fusion-final.json','utf8'));
const snapshots=JSON.parse(await fs.readFile('tmp/face-experiment/dataset.json','utf8'));
for(const album of albums){
 const review=snapshots.albums.find(a=>a.id===album.id).review,thresholds=[.3,.48,.65,.8];
 clearSimilarityCache();let start=performance.now();const expected=thresholds.map(t=>buildPeople(album.faces,t,review));const uncachedMs=performance.now()-start;
 const stats=cacheSimilarities(album.faces.map(f=>f.descriptor));thresholds.forEach((t,i)=>assert.deepEqual(buildPeople(album.faces,t,review),expected[i]));
 const misses=stats.misses;start=performance.now();const actual=thresholds.map(t=>buildPeople(album.faces,t,review));const cachedMs=performance.now()-start;
 assert.deepEqual(actual,expected);assert.equal(stats.misses,misses);
 console.log(JSON.stringify({album:album.title,uncachedMs,cachedMs,speedup:uncachedMs/cachedMs,...stats,identical:true}));
}
clearSimilarityCache();
