ArcFace w600k_r50.onnx (InsightFace buffalo_l, official v0.7 distribution).
Source: https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
SHA-256: 4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43
Input: RGB, 112x112, (pixel - 127.5) / 127.5. Output: 512-D L2-normalized descriptor.
Packaged into four byte-exact shards by scripts/prepare-arcface.py. No quantization.

InsightFace code is MIT; its provided pretrained models are for non-commercial
research purposes only, not automatically covered by the code's MIT license.
Licensing information: https://github.com/deepinsight/insightface#license
Obtain appropriate model rights for uses outside those terms.
