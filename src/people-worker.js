import { buildPeople } from "./people.js";
import { cacheSimilarities } from "./sface-utils.js";
let faces=[],pending,timer;
self.onmessage = ({data}) => {
  if(data.faces){faces=data.faces;cacheSimilarities(faces.map(f=>f.descriptor));}
  pending=data;clearTimeout(timer);
  timer=setTimeout(()=>{
    const request=pending;
    try {self.postMessage({requestId:request.requestId,result:buildPeople(faces,request.threshold,request.review)});}
    catch(error){self.postMessage({requestId:request.requestId,error:error.message});}
  },0);
};
