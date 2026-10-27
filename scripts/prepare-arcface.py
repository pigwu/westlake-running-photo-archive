"""Reproducible, hash-verified model packaging. No photo data is read."""
import hashlib
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / 'tmp/face-experiment/models/w600k_r50.onnx'
DEST = ROOT / 'public/models/arcface-v1'
SHA = '4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43'
CHUNK = 48 * 1024 * 1024
files = [DEST / f'w600k_r50.part{i}.bin' for i in range(4)]
if all(p.exists() for p in files) and hashlib.sha256(b''.join(p.read_bytes() for p in files)).hexdigest() == SHA:
    print('ArcFace model shards verified.')
else:
    if not MODEL.exists():
        MODEL.parent.mkdir(parents=True, exist_ok=True)
        archive = MODEL.parent / 'buffalo_l.zip'
        if not archive.exists():
            print('Downloading official InsightFace buffalo_l (research/non-commercial weights)...', flush=True)
            url = 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip'
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(url, timeout=120) as response, archive.open('wb') as target:
                import shutil
                shutil.copyfileobj(response, target)
        with zipfile.ZipFile(archive) as z:
            name = next(name for name in z.namelist() if name.split('/')[-1] == 'w600k_r50.onnx')
            MODEL.write_bytes(z.read(name))
    content = MODEL.read_bytes()
    if hashlib.sha256(content).hexdigest() != SHA:
        raise SystemExit('ArcFace SHA-256 mismatch. Refusing to package an unverified model.')
    DEST.mkdir(parents=True, exist_ok=True)
    for i, target in enumerate(files):
        target.write_bytes(content[i*CHUNK:(i+1)*CHUNK])
    print('Verified ArcFace packaged as four shards (174 MB total).')
