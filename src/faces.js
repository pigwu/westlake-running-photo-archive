let loaded;
export async function analyzePhoto(photo) {
  const faceapi = await import("face-api.js");
  // Older TensorFlow WebGL kernels can silently miss faces in embedded browsers.
  // CPU keeps results consistent across campus PCs without requiring a GPU.
  if (faceapi.tf.getBackend() !== "cpu") faceapi.tf.setBackend("cpu");
  if (!loaded)
    loaded = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(`${import.meta.env.BASE_URL}models`),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(`${import.meta.env.BASE_URL}models`),
      faceapi.nets.faceRecognitionNet.loadFromUri(`${import.meta.env.BASE_URL}models`),
    ]).catch((e) => {
      loaded = null;
      throw e;
    });
  await loaded;
  const image = await faceapi.fetchImage(photo.url);
  const faces = await faceapi
    .detectAllFaces(
      image,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 608,
        scoreThreshold: 0.45,
      }),
    )
    .withFaceLandmarks(true)
    .withFaceDescriptors();
  return faces.map((face) => {
    const { x, y, width, height } = face.detection.box;
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    const pad = Math.max(width, height) * 0.18;
    context.drawImage(
      image,
      Math.max(0, x - pad),
      Math.max(0, y - pad),
      Math.min(image.width - x, width + pad * 2),
      Math.min(image.height - y, height + pad * 2),
      0,
      0,
      120,
      120,
    );
    return {
      descriptor: Array.from(face.descriptor),
      box: [Math.max(0, x), Math.max(0, y), width, height],
      avatar: canvas.toDataURL("image/jpeg", 0.75),
    };
  });
}
