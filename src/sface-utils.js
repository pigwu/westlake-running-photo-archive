export const FACE_ENGINE = "yunet-2026may-sface-2021dec-align-v1";
export const FEATURE_SIZE = 128;
export const GROUP_THRESHOLD = 0.5;
export const REFERENCE_THRESHOLD = 0.45;
export const ALIGN_POINTS = [[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]];
export function normalizeDescriptor(values) {
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("人脸特征无效，请换一张清晰照片");
  return Array.from(values, value => value / norm);
}
export function cosineSimilarity(a,b) {
  if (!a?.length || a.length !== b?.length) return -1;
  let dot=0,normA=0,normB=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];normA+=a[i]**2;normB+=b[i]**2;}
  return normA&&normB?dot/Math.sqrt(normA*normB):-1;
}
// OpenCV five-point SFace alignment as a least-squares similarity transform.
// Canvas order: x'=ax+cy+e, y'=bx+dy+f.
export function similarityTransform(points,target=ALIGN_POINTS) {
  if(points?.length!==5||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw new Error("人脸关键点无效");
  const mean=list=>[0,1].map(axis=>list.reduce((sum,p)=>sum+p[axis],0)/list.length);
  const src=mean(points),dst=mean(target);let denominator=0,real=0,imaginary=0;
  for(let i=0;i<points.length;i++){
    const x=points[i][0]-src[0],y=points[i][1]-src[1],u=target[i][0]-dst[0],v=target[i][1]-dst[1];
    denominator+=x*x+y*y;real+=x*u+y*v;imaginary+=x*v-y*u;
  }
  if(denominator<1e-8)throw new Error("人脸关键点无法对齐");
  const a=real/denominator,b=imaginary/denominator;
  return[a,b,-b,a,dst[0]-a*src[0]+b*src[1],dst[1]-b*src[0]-a*src[1]];
}
export function planarPixels(rgba,width,height,order="RGB") {
  const count=width*height,data=new Float32Array(count*3),channels=order==="BGR"?[2,1,0]:[0,1,2];
  for(let i=0;i<count;i++)for(let c=0;c<3;c++)data[c*count+i]=rgba[i*4+channels[c]];
  return data;
}
export function decodeYuNet(outputs,edge=640,threshold=0.7) {
  const faces=[];
  for(const stride of[8,16,32]){
    const cols=edge/stride,cls=outputs[`cls_${stride}`]?.data,obj=outputs[`obj_${stride}`]?.data;
    const bbox=outputs[`bbox_${stride}`]?.data,kps=outputs[`kps_${stride}`]?.data;
    if(!cls||!obj||!bbox||!kps)throw new Error("YuNet 模型输出不兼容");
    for(let i=0;i<cls.length;i++){
      const score=Math.sqrt(Math.max(0,Math.min(1,cls[i]))*Math.max(0,Math.min(1,obj[i])));
      if(score<threshold)continue;
      const c=i%cols,r=Math.floor(i/cols),width=Math.exp(bbox[i*4+2])*stride,height=Math.exp(bbox[i*4+3])*stride;
      const x=(c+bbox[i*4])*stride-width/2,y=(r+bbox[i*4+1])*stride-height/2;
      const landmarks=Array.from({length:5},(_,n)=>[(kps[i*10+n*2]+c)*stride,(kps[i*10+n*2+1]+r)*stride]);
      if([x,y,width,height,...landmarks.flat()].every(Number.isFinite)&&width>0&&height>0)faces.push({x,y,width,height,score,landmarks});
    }
  }
  return faces;
}
export function blurVariance(rgba,width,height) {
  const gray=new Float32Array(width*height);
  for(let i=0;i<gray.length;i++)gray[i]=.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2];
  let sum=0,square=0,count=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,value=gray[i-1]+gray[i+1]+gray[i-width]+gray[i+width]-4*gray[i];
    sum+=value;square+=value*value;count++;
  }
  return count?Math.max(0,square/count-(sum/count)**2):0;
}
export function faceQualityReason(box,pixels,size=112) {
  if(box.score<.7)return"低置信度";
  if(Math.min(box.width,box.height)<42)return"人脸太小";
  const[left,right,nose]=box.landmarks||[];
  if(!left||!right||!nose)return"关键点无效";
  const eyeDistance=Math.hypot(right[0]-left[0],right[1]-left[1]);
  if(eyeDistance<1||Math.hypot(nose[0]-(left[0]+right[0])/2,nose[1]-(left[1]+right[1])/2)/eyeDistance>1.1)return"侧脸角度过大";
  if(pixels&&blurVariance(pixels,size,size)<25)return"人脸模糊";
  return"";
}
