import { normalizeDescriptor } from "./sface-utils.js";
const unsupported = new WeakSet();
export async function recognizeBatch(session, ort, pixels, {signal,batchSize=4}={}) {
  const dimension=session.inputMetadata?.[0]?.shape?.[0];
  const maximum=unsupported.has(session)||dimension===1?1:Math.max(1,Math.min(4,Math.floor(batchSize)||1));
  async function run(items) {
    signal?.throwIfAborted();
    const values=new Float32Array(items.length*3*112*112);
    items.forEach((p,i)=>values.set(p,i*3*112*112));
    const input=new ort.Tensor("float32",values,[items.length,3,112,112]);let outputs;
    try {
      outputs=await session.run({[session.inputNames[0]]:input});signal?.throwIfAborted();
      const data=outputs[session.outputNames[0]].data;
      if(data.length!==items.length*512)throw new Error("人脸特征维度不兼容");
      return items.map((_,i)=>normalizeDescriptor(data.subarray(i*512,(i+1)*512)));
    }finally{input.dispose?.();for(const output of Object.values(outputs||{}))output.dispose?.();}
  }
  const descriptors=[];
  for(let i=0;i<pixels.length;){
    const count=unsupported.has(session)?1:maximum,items=pixels.slice(i,i+count);
    try{descriptors.push(...await run(items));i+=items.length;}
    catch(error){
      signal?.throwIfAborted();
      if(items.length===1)throw error;
      // Some browsers/models reject dynamic batches or run short of memory.
      // Retry every face singly with the same model; never drop a detection.
      unsupported.add(session);
    }
  }
  return descriptors;
}
