import { cosineSimilarity, GROUP_PAIR_FLOOR, normalizeMatchThreshold } from "./sface-utils.js";

// Geometry, original revision and file ID identify a detection across reloads.
// Array position is deliberately not used for real indexed detections.
export function faceKey(photo, face, index = 0) {
  return JSON.stringify([photo.docid, photo.rev, ...(face.box || [index, 0, 1, 1]).map((v, i) => i > 1 ? Math.max(1, Math.round(v)) : Math.round(v))]);
}
export function indexedFaces(photos, indices, diagnostics = new Map()) {
  return photos.flatMap(photo => {
    const key = `${photo.docid}|${photo.rev}`;
    return [...(indices.get(key) || []), ...(diagnostics.get(key)?.rejected || [])].map((face, i) => ({
      ...face, key: faceKey(photo, face, i), photoId: photo.docid, photoName: photo.name,
    }));
  }).sort((a, b) => a.key.localeCompare(b.key));
}
class MaxHeap {
  items = [];
  better(a, b) { return a.score > b.score || (a.score === b.score && (a.a < b.a || (a.a === b.a && a.b < b.b))); }
  push(value) {
    const a = this.items; a.push(value); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (!this.better(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop() {
    const a = this.items, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; while (true) {
      let j = i, l = 2 * i + 1, r = l + 1;
      if (l < a.length && this.better(a[l], a[j])) j = l;
      if (r < a.length && this.better(a[r], a[j])) j = r;
      if (j === i) break; [a[i], a[j]] = [a[j], a[i]]; i = j;
    } }
    return top;
  }
}
function group(id, faces, manual, names) {
  return { id, faces, manual, confirmedCount: manual ? faces.length : 0, suggestedCount: 0, name: names[id] || "", photos: [...new Set(faces.map(f => f.photoId))], avatar: faces[0]?.avatar };
}
const PROFILE_MARGIN = .08;
function profileEvidence(face, samples) {
  if (!face.descriptor) return null;
  const scores = samples.filter(f => f.descriptor).map(f => cosineSimilarity(face.descriptor, f.descriptor)).sort((a, b) => b - a);
  if (!scores.length) return null;
  const peak = scores[0], second = scores[1] ?? -1, support = scores.length > 1 ? (peak + second) / 2 : peak;
  return { peak, second, support, mean: scores.reduce((a, b) => a + b, 0) / scores.length, score: .75 * peak + .25 * support };
}
// Only user-confirmed samples are anchors. Fresh automatic matches never
// become training samples, preventing a chain of matches from drifting.
function attachToConfirmed(automatic, groups, threshold) {
  const profiles = groups.filter(g => g.manual && g.faces.some(f => f.descriptor)).map(g => ({ group: g, samples: [...g.faces] }));
  const remaining = [], pending = [], proposals = [];
  const hold = (face, reason) => pending.push({ ...face, reason, groupId: `review:${face.key}`, groupName: "待确认归属" });
  for (const face of automatic) {
    const ranked = profiles.map(p => ({ ...p, ...profileEvidence(face, p.samples) })).sort((a, b) => b.score - a.score || a.group.id.localeCompare(b.group.id));
    const best = ranked[0];
    if (!best || best.peak < Math.max(GROUP_PAIR_FLOOR, threshold - .05)) { remaining.push(face); continue; }
    const high = (best.second >= threshold && best.support >= Math.max(threshold, .50)) || best.peak >= Math.max(threshold + .15, .70);
    const margin = ranked[1] ? best.score - ranked[1].score : 1;
    if (best.group.photos.includes(face.photoId)) { hold(face, "候选人物已出现在同一张照片中，请人工确认。"); continue; }
    if (!high) { hold(face, "与已确认人物有相似之处，但分数不足以自动归入。"); continue; }
    if (margin < PROFILE_MARGIN) { hold(face, "与多个人物的匹配分数接近，请确认归属。"); continue; }
    proposals.push({ face, target: best.group, score: best.score, margin });
  }
  // Resolve simultaneous claims for one person in one photo before assigning.
  const claims = new Map();
  for (const p of proposals) {
    const key = JSON.stringify([p.target.id, p.face.photoId]);
    if (!claims.has(key)) claims.set(key, []);
    claims.get(key).push(p);
  }
  for (const candidates of claims.values()) {
    candidates.sort((a, b) => b.score - a.score || a.face.key.localeCompare(b.face.key));
    const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < PROFILE_MARGIN;
    candidates.forEach((p, i) => {
      if (ambiguous || i > 0) { hold(p.face, "同一照片的多张脸匹配到这个人物，请人工确认。"); return; }
      p.target.faces.push({ ...p.face, suggested: true, matchScore: p.score });
      p.target.photos.push(p.face.photoId); p.target.suggestedCount++;
    });
  }
  return { remaining, pending };
}
export function candidateGroups(face, groups, excludeId) {
  return groups.filter(g => g.id !== excludeId && !g.photos.includes(face.photoId)).map(g => {
    const evidence = profileEvidence(face, g.faces.filter(f => !g.manual || !f.suggested));
    return evidence && { id: g.id, name: g.name, avatar: g.avatar, ...evidence };
  }).filter(c => c && c.peak >= GROUP_PAIR_FLOOR).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);
}
export function assertNoPhotoConflict(faces) {
  if (new Set(faces.map(f => f.photoId)).size !== faces.length) throw new Error("同一张照片里有两张不同的人脸，不能归为同一个人。请取消其中一张后再保存。");
}
// Global average-link agglomeration. Every merge updates all cluster pairs;
// sorted detection keys and explicit tie-breaking remove input-order effects.
export function buildPeople(input, threshold, review = { assignments: {}, names: {} }) {
  threshold = normalizeMatchThreshold(threshold);
  const faces = [...input].sort((a, b) => a.key.localeCompare(b.key));
  const assignments = review.assignments || {}, names = review.names || {};
  const ignored = [], unrecognized = [], automatic = [], manual = new Map(), conflicts = [];
  for (const face of faces) {
    const assignment = assignments[face.key];
    if (assignment === "ignore") ignored.push(face);
    else if (assignment) { if (!manual.has(assignment)) manual.set(assignment, []); manual.get(assignment).push(face); }
    else if (!face.descriptor) unrecognized.push(face);
    else automatic.push(face);
  }
  const groups = [];
  for (const [id, members] of manual) {
    const counts = new Map(); members.forEach(f => counts.set(f.photoId, (counts.get(f.photoId) || 0) + 1));
    const valid = members.filter(f => counts.get(f.photoId) === 1);
    conflicts.push(...members.filter(f => counts.get(f.photoId) > 1).map(f => ({ ...f, reason: "人工归属冲突：同一照片的多张脸被归到同一人物，请调整或取消人工归属。" })));
    if (valid.length) groups.push(group(id, valid, true, names));
  }
  if (automatic.length > 1500) throw new Error("这个相册超过 1500 张待自动分组的人脸，请先按活动拆分相册后再分组。");
  const matched = attachToConfirmed(automatic, groups, threshold);
  automatic.splice(0, automatic.length, ...matched.remaining);
  const n = automatic.length;
  const means = new Float64Array(n * n), floors = new Float64Array(n * n);
  const clusters = automatic.map((face, i) => ({ i, faces: [face], photos: new Set([face.photoId]), version: 0, alive: true }));
  const heap = new MaxHeap();
  const allowed = (a, b) => ![...a.photos].some(p => b.photos.has(p));
  function offer(a, b) {
    if (a.i > b.i) [a, b] = [b, a];
    const k = a.i * n + b.i, score = means[k];
    if (score >= threshold && floors[k] >= GROUP_PAIR_FLOOR && allowed(a, b)) heap.push({ a: a.i, b: b.i, va: a.version, vb: b.version, score });
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const score = cosineSimilarity(automatic[i].descriptor, automatic[j].descriptor);
    means[i * n + j] = means[j * n + i] = floors[i * n + j] = floors[j * n + i] = score;
    offer(clusters[i], clusters[j]);
  }
  while (heap.items.length) {
    const edge = heap.pop(), a = clusters[edge.a], b = clusters[edge.b];
    if (!a.alive || !b.alive || a.version !== edge.va || b.version !== edge.vb) continue;
    const na = a.faces.length, nb = b.faces.length;
    for (const c of clusters) if (c.alive && c !== a && c !== b) {
      const mean = (means[a.i * n + c.i] * na + means[b.i * n + c.i] * nb) / (na + nb);
      const floor = Math.min(floors[a.i * n + c.i], floors[b.i * n + c.i]);
      means[a.i * n + c.i] = means[c.i * n + a.i] = mean;
      floors[a.i * n + c.i] = floors[c.i * n + a.i] = floor;
    }
    a.faces.push(...b.faces); b.photos.forEach(p => a.photos.add(p)); a.version++; b.alive = false;
    for (const c of clusters) if (c.alive && c !== a) offer(a, c);
  }
  for (const c of clusters) if (c.alive) {
    c.faces.sort((a, b) => a.key.localeCompare(b.key));
    groups.push(group(`auto:${c.faces[0].key}`, c.faces, false, names));
  }
  groups.sort((a, b) => Number(b.manual) - Number(a.manual) || b.faces.length - a.faces.length || a.id.localeCompare(b.id));
  groups.forEach((g, i) => { g.name ||= `${g.manual ? "已确认人物" : "人物"} ${i + 1}`; });
  const pending = [...matched.pending, ...groups.filter(g => !g.manual && g.faces.length === 1).map(g => ({ ...g.faces[0], groupId: g.id, groupName: g.name }))]
    .sort((a, b) => a.key.localeCompare(b.key)).map(f => ({ ...f, candidates: candidateGroups(f, groups, f.groupId) }));
  return { groups, pending, ignored, unrecognized, conflicts };
}
