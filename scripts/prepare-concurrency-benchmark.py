"""Prepare local fixtures from the existing face experiment; never uploads."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'tmp/face-experiment'
dataset = json.loads((root / 'dataset.json').read_text('utf-8'))
eligible = []
for album in dataset['albums']:
    for photo in album['photos']:
        records = json.loads((root / 'features' / (photo['docid'].split('/')[-1] + '.json')).read_text('utf-8'))
        count = sum(bool(f.get('arcface') and f.get('sface')) for f in records)
        if 1 <= count <= 5:
            eligible.append({k: photo[k] for k in ['docid', 'rev', 'name']} | {'url': '/tmp/face-experiment/' + photo['local'], 'count': count})
if len(eligible) < 16:
    raise SystemExit('At least 16 eligible local photos are required.')
chosen = [eligible[round(i * (len(eligible) - 1) / 15)] for i in range(16)]
(root / 'parallel-fixture.json').write_text(json.dumps(chosen), 'utf-8')
albums = json.loads((root / 'fusion-final.json').read_text('utf-8'))
keys = ['key', 'photoId', 'photoName', 'descriptor', 'box', 'yawProxy', 'sharpness', 'detectorScore', 'reason']
slim = [{'id': a['id'], 'faces': [{k: f[k] for k in keys if k in f} for f in a['faces']]} for a in albums]
(root / 'parallel-groups.json').write_text(json.dumps(slim), 'utf-8')
print(f"Prepared 16 photos ({sum(p['count'] for p in chosen)} previously accepted faces); no network access.")
