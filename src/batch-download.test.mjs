import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadPhotos } from './batch-download.js';
const session={link:'test',password:'test'};
const file=(id,name='照片.jpg')=>({docid:'root/'+id,name,size:3});
function mockFiles(t,reply,events=[]){t.mock.method(globalThis,'fetch',async(url,options)=>{
 if(url.startsWith('https://pan.westlake.edu.cn/')){const body=JSON.parse(options.body);events.push('request:'+body.docid);return Response.json({authrequest:['GET','https://driveoss.westlake.edu.cn/'+body.docid.split('/').at(-1)]});}
 assert.equal(options.credentials,'omit');return reply(url.split('/').at(-1));
});}
function directoryMock(events=[]){const files=new Map([['照片.jpg',new Uint8Array([99])]]);return{files,name:'测试文件夹',async removeEntry(name){files.delete(name)},async getFileHandle(name,options){
 if(!files.has(name)&&!options?.create)throw new DOMException('Missing','NotFoundError');if(!files.has(name))files.set(name,new Uint8Array(0));
 return{async createWritable(){const chunks=[];return{async write(chunk){chunks.push(...chunk)},async close(){files.set(name,new Uint8Array(chunks));events.push('saved:'+name)},async abort(){events.push('aborted:'+name)}}}};
}};}
test('directory downloads preserve original bytes and existing files, saving sequentially',async t=>{
 const events=[],directory=directoryMock(events);mockFiles(t,id=>new Response(new Uint8Array(id==='a'?[1,2,3]:[4,5,6])),events);
 const result=await downloadPhotos(session,[file('a'),file('b')],{directory});assert.equal(result.completed,2);assert.deepEqual(result.failed,[]);
 assert.deepEqual(Array.from(directory.files.get('照片.jpg')),[99]);assert.deepEqual(Array.from(directory.files.get('照片 (2).jpg')),[1,2,3]);assert.deepEqual(Array.from(directory.files.get('照片 (3).jpg')),[4,5,6]);
 assert.deepEqual(events,['request:root/a','saved:照片 (2).jpg','request:root/b','saved:照片 (3).jpg']);
});
test('browser fallback saves separate original blobs with safe filenames',async t=>{
 mockFiles(t,()=>new Response(new Uint8Array([1,2,3])));const saved=[];
 const result=await downloadPhotos(session,[file('a','../照片.jpg'),file('b','../照片.jpg')],{saveBlob:async(blob,name)=>saved.push({name,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))})});
 assert.equal(result.completed,2);assert.deepEqual(saved,[{name:'_照片.jpg',bytes:[1,2,3]},{name:'_照片 (2).jpg',bytes:[1,2,3]}]);
});
test('failed and empty originals are reported while later photos continue',async t=>{
 mockFiles(t,id=>id==='a'?new Response('',{status:403}):new Response(id==='b'?new Uint8Array(0):new Uint8Array([4,5,6])));const directory=directoryMock();
 const result=await downloadPhotos(session,[file('a'),file('b'),file('c')],{directory});assert.equal(result.completed,1);assert.equal(result.failed.length,2);assert.match(result.failed[0].error,/403/);assert.match(result.failed[1].error,/原图为空/);assert.equal(directory.files.size,2);
});
test('cancellation preserves completed files and stops before the next request',async t=>{
 const abort=new AbortController();let requests=0;mockFiles(t,()=>{requests++;return new Response(new Uint8Array([1,2,3]))});
 await assert.rejects(downloadPhotos(session,[file('a'),file('b')],{signal:abort.signal,saveBlob:async()=>abort.abort()}),{name:'AbortError'});assert.equal(requests,1);
});
test('invalid batch counts fail before network access',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected network')});await assert.rejects(downloadPhotos(session,[],{saveBlob:()=>{}}),/1–100/);await assert.rejects(downloadPhotos(session,Array(101).fill(file('a')),{saveBlob:()=>{}}),/1–100/);
});
