import PhotoWorker from "./photo-worker.js?worker&inline";
import {analyzePhoto} from "./faces.js";
const abortError=()=>new DOMException("分析已停止","AbortError");
export function supportsPhotoWorkers(){return typeof Worker!=="undefined";}
export function createPhotoPool({signal,base=new URL(import.meta.env.BASE_URL,document.baseURI).href}={}) {
  const lanes=new Map();let serial=0,closed=false;
  function stop(){closed=true;for(const lane of lanes.values()){lane.worker.terminate();lane.pending?.reject(abortError());lane.pending=null;}lanes.clear();}
  signal?.addEventListener("abort",stop,{once:true});
  function laneFor(index){
    if(closed||signal?.aborted)throw abortError();
    if(lanes.has(index))return lanes.get(index);
    const worker=new PhotoWorker(),lane={worker,pending:null};
    worker.onmessage=({data})=>{
      const pending=lane.pending;if(!pending||pending.id!==data.id)return;
      if(data.progress){pending.progress?.(data.progress);return;}
      lane.pending=null;data.error?pending.reject(new Error(data.error)):pending.resolve(data);
    };
    worker.onerror=()=>{lane.pending?.reject(new Error("并行计算线程异常，请降低并发数后继续；已缓存结果会保留"));lane.pending=null;worker.terminate();lanes.delete(index);};
    lanes.set(index,lane);return lane;
  }
  function request(index,data,progress,transfer=[]){
    const lane=laneFor(index);if(lane.pending)throw new Error("计算线程仍在处理上一张照片");
    return new Promise((resolve,reject)=>{
      const id=++serial;lane.pending={id,resolve,reject,progress};
      try{lane.worker.postMessage({id,base,...data},transfer);}catch(error){lane.pending=null;reject(error);}
    });
  }
  const sessions=new Map(),loading=new Map(),warmups=[Promise.resolve(),Promise.resolve()];let warmupSlot=0;
  async function prepare(index,progress){
    if(closed||signal?.aborted)throw abortError();
    if(sessions.has(index))return sessions.get(index);
    if(loading.has(index))return loading.get(index);
    const slot=warmupSlot++%2;
    const task=warmups[slot].catch(()=>{}).then(async()=>{
      const {info}=await request(index,{type:"prepare"},progress);
      const proxies=Object.fromEntries(Object.entries(info).map(([kind,metadata])=>[kind,{...metadata,run:async feeds=>{
        const input=Object.values(feeds)[0],values=input.data.slice();
        const {outputs}=await request(index,{type:"run",kind,values,dims:input.dims},null,[values.buffer]);return outputs;
      }}]));sessions.set(index,proxies);return proxies;
    });
    warmups[slot]=task;loading.set(index,task);
    try{return await task;}finally{loading.delete(index);}
  }
  return {
    prepare,
    async analyze(index,photo,options={}){
      signal?.throwIfAborted();const proxies=await prepare(index,options.onProgress);
      return analyzePhoto(photo,{...options,signal,sessions:proxies});
    },
    close(){stop();sessions.clear();signal?.removeEventListener("abort",stop);},
  };
}
