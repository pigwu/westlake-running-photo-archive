Face analysis models: OpenCV Zoo, downloaded 2026-10-09.

YuNet: face_detection_yunet_2026may.onnx
Source: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
Copyright (c) 2020 Shiqi Yu. MIT license; see YUNET-LICENSE.txt.
SHA-256: ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0

SFace: face_recognition_sface_2021dec.onnx
Source: https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
Copyright (C) 2021, Shenzhen Institute of Artificial Intelligence and Robotics for Society.
Apache License 2.0; see SFACE-LICENSE.txt.
SHA-256: 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79

Models are used without modifying their weights. Browser preprocessing follows
OpenCV FaceDetectorYN and FaceRecognizerSF: BGR input for YuNet, five-landmark
similarity alignment to 112x112 and RGB 0..255 input for SFace. SFace emits a
128-dimensional vector; cosine comparison uses L2-normalized descriptors.
Inference uses ONNX Runtime Web 1.24.3, MIT licensed. The WASM binary is copied
from the pinned npm package at build. License and third-party notices are in
ONNXRUNTIME-LICENSE.txt and ONNXRUNTIME-ThirdPartyNotices.txt, obtained from
https://github.com/microsoft/onnxruntime/tree/v1.24.3 .
