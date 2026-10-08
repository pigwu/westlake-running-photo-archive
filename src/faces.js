import { faceTiles, deduplicateFaces, boundedFaceCrop } from "./face-utils.js";
import { loadAnalysisImage } from "./image-input.js";

let detectorLoaded, recognitionLoaded;
function checkAbort(signal) { if (signal?.aborted) throw new DOMException("分析已停止", "AbortError"); }
// Paint progress and accept cancellation between tiles, including hidden tabs.
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
async function loadDetector() {
  const faceapi = await import("face-api.js");
  // CPU avoids inconsistent WebGL kernels in embedded campus browsers.
  if (faceapi.tf.getBackend() !== "cpu") faceapi.tf.setBackend("cpu");
  if (!detectorLoaded) detectorLoaded = faceapi.nets.tinyFaceDetector.loadFromUri(import.meta.env.BASE_URL + "models")
    .catch(e => { detectorLoaded = null; throw e; });
  await detectorLoaded;
  return faceapi;
}
async function loadRecognition(faceapi) {
  if (!recognitionLoaded) recognitionLoaded = Promise.all([
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(import.meta.env.BASE_URL + "models"),
    faceapi.nets.faceRecognitionNet.loadFromUri(import.meta.env.BASE_URL + "models"),
  ]).catch(e => { recognitionLoaded = null; throw e; });
  await recognitionLoaded;
}
export async function prepareFaceAnalysis({ signal, onProgress = () => {} } = {}) {
  checkAbort(signal);
  onProgress("加载人脸检测模型…");
  const faceapi = await loadDetector();
  checkAbort(signal);
  onProgress("加载人脸特征模型…");
  await loadRecognition(faceapi);
  checkAbort(signal);
}
function imageCrop(image, box, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const scale = size / Math.max(box.width, box.height);
  const width = box.width * scale, height = box.height * scale;
  canvas.getContext("2d").drawImage(image, box.x, box.y, box.width, box.height, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}
// Keep detection independently testable without extracting identity features.
export async function detectOriginalFaces(image, { signal, onProgress = () => {} } = {}) {
  checkAbort(signal);
  onProgress("加载人脸检测模型…");
  const faceapi = await loadDetector();
  checkAbort(signal);
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const tiles = faceTiles(width, height);
  // A full-frame pass catches large faces that cross tile boundaries.
  const regions = tiles.length === 1 ? tiles : [{ x: 0, y: 0, width, height }, ...tiles];
  const boxes = [];
  const canvas = document.createElement("canvas");
  try {
    for (let i = 0; i < regions.length; i++) {
      checkAbort(signal);
      onProgress("原图检测 " + (i + 1) + "/" + regions.length);
      await yieldUI(); checkAbort(signal);
      const region = regions[i], scale = Math.min(1, 608 / Math.max(region.width, region.height));
      canvas.width = Math.max(1, Math.round(region.width * scale));
      canvas.height = Math.max(1, Math.round(region.height * scale));
      canvas.getContext("2d").drawImage(image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
      const detections = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.45 }));
      checkAbort(signal);
      for (const detection of detections) {
        const box = detection.box;
        boxes.push({ x: box.x * region.width / canvas.width + region.x, y: box.y * region.height / canvas.height + region.y,
          width: box.width * region.width / canvas.width, height: box.height * region.height / canvas.height, score: detection.score });
      }
    }
    return deduplicateFaces(boxes);
  } finally { canvas.width = 0; canvas.height = 0; }
}
export async function analyzePhoto(photo, { signal, onProgress = () => {} } = {}) {
  checkAbort(signal);
  const image = await loadAnalysisImage(photo.url, signal);
  try {
    checkAbort(signal);
    const boxes = await detectOriginalFaces(image, { signal, onProgress });
    return await describeDetectedFaces(image, boxes, { signal, onProgress });
  } finally { image.src = ""; }
}

export async function describeDetectedFaces(image, boxes, { signal, onProgress = () => {} } = {}) {
  checkAbort(signal);
  const faceapi = await loadDetector();
    if (!boxes.length) return [];
    onProgress("加载人脸特征模型…");
    await loadRecognition(faceapi); checkAbort(signal);
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const faces = [];
    for (let i = 0; i < boxes.length; i++) {
      onProgress("处理人脸 " + (i + 1) + "/" + boxes.length);
      await yieldUI(); checkAbort(signal);
      // Only each face crop is resized; original pixels remain the source.
      const box = boxes[i], cropBox = boundedFaceCrop(box, width, height);
      const crop = imageCrop(image, cropBox, 256);
      let aligned, avatar;
      try {
        const landmarks = await faceapi.nets.faceLandmark68TinyNet.detectLandmarks(crop);
        checkAbort(signal);
        const alignedBox = boundedFaceCrop(landmarks.align(null, { useDlibAlignment: true }), 256, 256, 0);
        aligned = imageCrop(crop, alignedBox, 150);
        const descriptor = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(aligned);
        checkAbort(signal);
        avatar = imageCrop(image, cropBox, 120);
        faces.push({ descriptor: Array.from(descriptor), box: [box.x, box.y, box.width, box.height], avatar: avatar.toDataURL("image/jpeg", 0.75) });
      } finally {
        crop.width = 0; crop.height = 0;
        if (aligned) { aligned.width = 0; aligned.height = 0; }
        if (avatar) { avatar.width = 0; avatar.height = 0; }
      }
    }
    return faces;
}
