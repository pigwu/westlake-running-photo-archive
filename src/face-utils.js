export function faceTiles(width, height, edge = 1800, limit = 36) {
  const positions = (length, size) => {
    const result = [], stride = Math.floor(size * 0.75);
    for (let p = 0; p < length; p += stride) {
      result.push(Math.min(p, Math.max(0, length - size)));
      if (p + size >= length) break;
    }
    return [...new Set(result)];
  };
  let xs, ys;
  do {
    xs = positions(width, edge); ys = positions(height, edge);
    if (xs.length * ys.length <= limit) break;
    edge = Math.ceil(edge * 1.2);
  } while (true);
  return ys.flatMap(y => xs.map(x => ({ x, y, width: Math.min(edge, width - x), height: Math.min(edge, height - y) })));
}
export function deduplicateFaces(boxes) {
  const kept = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    const duplicate = kept.some(a => {
      const width = Math.max(0, Math.min(a.x + a.width, box.x + box.width) - Math.max(a.x, box.x));
      const height = Math.max(0, Math.min(a.y + a.height, box.y + box.height) - Math.max(a.y, box.y));
      const intersection = width * height, areaA = a.width * a.height, areaB = box.width * box.height;
      return intersection / (areaA + areaB - intersection) > 0.35 || intersection / Math.min(areaA, areaB) > 0.65;
    });
    if (!duplicate) kept.push(box);
  }
  return kept;
}
export function boundedFaceCrop(box, width, height, padding = 0.18) {
  const pad = Math.max(box.width, box.height) * padding;
  const x = Math.max(0, Math.min(width - 1, box.x - pad)), y = Math.max(0, Math.min(height - 1, box.y - pad));
  return { x, y, width: Math.max(1, Math.min(width, box.x + box.width + pad) - x), height: Math.max(1, Math.min(height, box.y + box.height + pad) - y) };
}
export function groupDetectedFaces(groups, faces, photoId) {
  for (const face of faces) {
    const scores = groups.map(g => {
      if (g.photos.includes(photoId)) return -1;
      const scores=(g.descriptors || [g.descriptor]).map(d => cosineSimilarity(d,face.descriptor));
      // Average linkage with a pairwise floor avoids single-face chain merges.
      return Math.min(...scores) < GROUP_PAIR_FLOOR ? -1 : scores.reduce((sum,v)=>sum+v,0)/scores.length;
    });
    const closest = Math.max(...scores);
    const group = closest >= FACE_MATCH_THRESHOLD ? groups[scores.indexOf(closest)] : null;
    if (group) { group.photos.push(photoId); (group.descriptors ||= [group.descriptor]).push(face.descriptor); }
    else groups.push({ ...face, name: `人物 ${groups.length + 1}`, photos: [photoId], descriptors:[face.descriptor] });
  }
  return groups;
}
import { cosineSimilarity, FACE_MATCH_THRESHOLD, GROUP_PAIR_FLOOR } from "./sface-utils.js";
