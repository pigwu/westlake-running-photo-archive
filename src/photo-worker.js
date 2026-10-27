import {configureFaceAssets,faceSessionInfo,runFaceTensor} from "./faces.js";
self.onmessage=async({data})=>{
  const {id,base}=data;
  try{
    configureFaceAssets(base);
    if(data.type==="prepare"){
      const info=await faceSessionInfo({onProgress:progress=>self.postMessage({id,progress})});self.postMessage({id,info});return;
    }
    const outputs=await runFaceTensor(data.kind,data.values,data.dims);
    self.postMessage({id,outputs},Object.values(outputs).map(t=>t.data.buffer));
  }catch(error){self.postMessage({id,error:error.message});}
};
