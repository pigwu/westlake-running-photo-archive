import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScanFace, X, Upload } from "lucide-react";
import { originalPhotoBlob } from "./westlake.js";
import { faceIndexKey, loadFaceIndices, saveFaceIndex, referencePhotoIds, needsFaceDetailsUpdate } from "./face-cache.js";
import { indexedFaces } from "./people.js";
import { loadReviews, saveReview } from "./people-review.js";
import PeoplePanel from "./PeoplePanel.jsx";
import PeopleWorker from "./people-worker.js?worker&inline";
import { photoLabel } from "./upload.js";
import { FACE_MATCH_THRESHOLD, MIN_MATCH_THRESHOLD, MAX_MATCH_THRESHOLD, normalizeMatchThreshold, restoreMatchThreshold } from "./sface-utils.js";

const MATCH_PREFERENCE = "run-face-match-threshold-v2";
const EMPTY_PEOPLE = { groups: [], pending: [], ignored: [], unrecognized: [], conflicts: [] };
function savedThreshold() {
  try {
    const value = restoreMatchThreshold(localStorage.getItem(MATCH_PREFERENCE), localStorage.getItem("run-face-match-threshold-v1"));
    localStorage.setItem(MATCH_PREFERENCE, String(value)); return value;
  }
  catch { return FACE_MATCH_THRESHOLD; }
}

export default function PersonFinder({ session, album, photos, onFilter, resetSelection = 0 }) {
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [indices, setIndices] = useState(new Map());
  const [diagnostics, setDiagnostics] = useState(new Map());
  const [review, setReview] = useState({ assignments: {}, names: {} });
  const [model, setModel] = useState(EMPTY_PEOPLE);
  const [grouping, setGrouping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [references, setReferences] = useState([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [threshold, setThreshold] = useState(savedThreshold);
  const operation = useRef(null), referenceInput = useRef(null);
  const legacyKeys = useRef([]);
  useEffect(() => { setActive(""); }, [resetSelection]);
  const signature = photos.map(faceIndexKey).join("\n");
  const scope = `${session.link}|${album.rootDocid || ""}|${album.albumId || "legacy"}`;
  useEffect(() => {
    setLoaded(false); setIndices(new Map()); setDiagnostics(new Map()); setReview({ assignments: {}, names: {} }); setModel(EMPTY_PEOPLE); setGrouping(false); setLegacyCount(0); setReferences([]); setActive(""); onFilter(null);
    setBusy(false); setStatus(""); setError("");
    return () => { operation.current?.abort(); operation.current = null; };
  }, [signature, scope]);
  const faces = useMemo(() => indexedFaces(photos, indices, diagnostics), [indices, diagnostics, signature]);
  useEffect(() => {
    if (!loaded || busy) return;
    setGrouping(true); let worker, cancelled = false;
    const timer = setTimeout(() => {
      try {
        worker = new PeopleWorker();
        worker.onmessage = ({ data }) => { if (cancelled) return; setGrouping(false); if (data.error) { setModel(EMPTY_PEOPLE); setError(data.error); } else setModel(data.result); worker.terminate(); };
        worker.onerror = () => { if (cancelled) return; setGrouping(false); setModel(EMPTY_PEOPLE); setError("人物分组失败，请刷新后重试"); worker.terminate(); };
        worker.postMessage({ faces, threshold, review });
      } catch (e) { setGrouping(false); setModel(EMPTY_PEOPLE); setError(`无法启动人物分组：${e.message}`); }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); worker?.terminate(); };
  }, [faces, threshold, review, loaded, busy]);
  useEffect(() => {
    if (!active.startsWith("reference-")) return;
    const face = references[Number(active.slice("reference-".length))];
    if (!face) return;
    const excluded = new Set(Object.keys(review.assignments).filter(key => review.assignments[key] === "ignore"));
    const matches = referencePhotoIds([face], indices, photos, threshold, excluded);
    onFilter(matches, `参照人脸 ${Number(active.slice("reference-".length)) + 1}`);
    setStatus(`找到 ${matches.length} 张相似照片。结果可能有遗漏或误匹配，请人工确认。`);
  }, [threshold, indices, signature, active, references, review]);
  function changeThreshold(value) {
    const next = normalizeMatchThreshold(value);
    setThreshold(next);
    try { localStorage.setItem(MATCH_PREFERENCE, String(next)); } catch { /* Browsing still works without storage. */ }
    if (!active.startsWith("reference-")) { setActive(""); onFilter(null); }
  }
  const indexed = photos.filter(p => indices.has(faceIndexKey(p))).length;
  const detailUpdates = photos.filter(p => needsFaceDetailsUpdate(diagnostics.get(faceIndexKey(p)))).length;
  const rootDocid = album.rootDocid || photos[0]?.docid.split("/").slice(0, 3).join("/");
  async function readIndex() {
    setActive(""); onFilter(null);
    setOpened(true); setLoaded(false); setBusy(true); setError(""); setStatus("读取已保存的人脸索引与纠错记录…");
    const abort = new AbortController(); operation.current = abort;
    try {
      const data = await loadFaceIndices(session, rootDocid, photos, abort.signal);
      const corrections = await loadReviews(session, rootDocid, album.albumId || "legacy", abort.signal, data.files);
      if (abort.signal.aborted) return;
      legacyKeys.current = data.legacyKeys || [];
      setIndices(data.indices); setDiagnostics(data.diagnostics); setReview(corrections); setLegacyCount(data.legacyCount || 0); setLoaded(true); setStatus(data.indices.size ? "已读取共享索引与人工纠错记录，人工确认优先保留。" : "索引检查完成，请先补建人脸索引。");
      if (data.warnings.length) setError(`${data.warnings.length} 张照片的索引暂时无法读取，可重试或补建。`);
    } catch (e) { if (!abort.signal.aborted) { setError(e.message); setStatus("读取未完成，请重试「刷新索引与纠错」。"); } }
    finally { if (operation.current === abort) setBusy(false); }
  }
  async function buildIndex(mode = "missing") {
    setActive(""); onFilter(null);
    setBusy(true); setError(""); setStatus("准备补建人脸索引…");
    const abort = new AbortController(); operation.current = abort;
    const next = new Map(indices);
    const nextDetails = new Map(diagnostics);
    let failed = 0, lastFailure = "", saved = 0;
    try {
      const { analyzePhoto, prepareFaceAnalysis } = await import("./faces.js");
      // A shared model failure should stop the batch before any original
      // downloads, rather than reporting the same error for all 14 photos.
      await prepareFaceAnalysis({ signal: abort.signal, onProgress: setStatus });
      const missing = photos.filter(p => {
        const key = faceIndexKey(p);
        return !next.has(key) || (mode === "details" && needsFaceDetailsUpdate(nextDetails.get(key)));
      });
      for (let i = 0; i < missing.length; i++) {
        if (abort.signal.aborted) break;
        const progress = message => { if (!abort.signal.aborted) setStatus(`照片 ${i + 1}/${missing.length} · ${message}`); };
        let url;
        try {
          progress("读取原图…");
          const blob = await originalPhotoBlob(session, missing[i], abort.signal);
          if (abort.signal.aborted) break;
          url = URL.createObjectURL(blob);
          let detail;
          const faces = await analyzePhoto({ url }, { signal: abort.signal, onProgress: progress, onDiagnostics: data => { detail = data; } });
          progress("保存共享人脸索引…");
          await saveFaceIndex(session, rootDocid, missing[i], faces, { signal: abort.signal, diagnostics: detail });
          next.set(faceIndexKey(missing[i]), faces); if (detail) nextDetails.set(faceIndexKey(missing[i]), detail); saved++; setIndices(new Map(next)); setDiagnostics(new Map(nextDetails));
        } catch (e) { if (abort.signal.aborted) break; failed++; lastFailure = e.message; }
        finally { if (url) URL.revokeObjectURL(url); }
      }
      if (operation.current !== abort) return;
      setLegacyCount(legacyKeys.current.filter(key => !next.has(key)).length);
      setLoaded(true); setStatus(`${abort.signal.aborted ? "已停止。" : failed && !saved ? "补建失败。" : "补建完成。"}已保存 ${saved} 张照片的人脸索引。${saved ? "其他跑友可直接使用。" : ""}`);
      if (failed) setError(`${failed} 张索引建立失败：${lastFailure}`);
    } catch (e) {
      if (!abort.signal.aborted) { setStatus("未开始补建，请刷新页面后重试。"); setError(`人脸模型加载失败：${e.message}`); }
      else if (operation.current === abort) setStatus("已停止。");
    }
    finally { if (operation.current === abort) setBusy(false); }
  }
  async function persistReview(change) {
    const abort = new AbortController(); operation.current = abort;
    setBusy(true); setError(""); setActive(""); onFilter(null);
    try {
      await saveReview(session, rootDocid, album.albumId || "legacy", change, { signal: abort.signal });
      if (abort.signal.aborted) return false;
      const local = { assignments: { ...review.assignments }, names: { ...review.names } };
      for (const key of change.faceKeys) {
        if (change.action === "reset") delete local.assignments[key];
        else local.assignments[key] = change.action === "ignore" ? "ignore" : change.personId;
      }
      if (change.action === "assign" && change.name.trim()) local.names[change.personId] = change.name.trim();
      setReview(local); setStatus("人物纠错已保存到网盘，其他跑友刷新即可同步。");
      try {
        const fresh = await loadReviews(session, rootDocid, album.albumId || "legacy", abort.signal);
        if (!abort.signal.aborted) setReview(fresh);
      } catch { if (!abort.signal.aborted) setError("纠错已保存，共享记录刷新失败。请点「刷新索引与纠错」重试，无需重复保存。"); }
      return true;
    } catch (e) { if (!abort.signal.aborted) setError(e.message); return false; }
    finally { if (operation.current === abort) setBusy(false); }
  }
  async function chooseReference(file) {
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024) { setError("请选择 20 MB 以内的 JPG、PNG 或 WebP 参照照片"); return; }
    setBusy(true); setError(""); setReferences([]); setActive(""); onFilter(null);
    const abort = new AbortController(); operation.current = abort;
    const url = URL.createObjectURL(file);
    try {
      const { analyzePhoto } = await import("./faces.js");
      const faces = await analyzePhoto({ url }, { signal: abort.signal, onProgress: message => { if (!abort.signal.aborted) setStatus(`参照照片 · ${message}`); } });
      if (abort.signal.aborted) return;
      setReferences(faces); setStatus(faces.length ? "请选择参照照片中的一张人脸，查看相似照片。" : "参照照片未检测到清晰人脸，请换一张正面照片。");
    } catch (e) { if (!abort.signal.aborted) setError(e.message); }
    finally { URL.revokeObjectURL(url); if (operation.current === abort) setBusy(false); }
  }
  function selectReference(face, index) {
    setActive(`reference-${index}`);
  }
  return <section className="person-finder">
    {!opened ? <button className="subtle" disabled={!photos.length || busy} onClick={readIndex}><ScanFace size={17} />按人找照片</button> : <>
      <div className="finder-heading"><h2><ScanFace size={20} />按人找照片</h2><button className="subtle" disabled={busy} aria-label="关闭人物筛选" onClick={() => { setOpened(false); setActive(""); onFilter(null); }}><X size={18} /></button></div>
      <p className="face-status">{loaded ? `${indexed}/${photos.length} 张照片已有共享索引 · ${grouping ? "正在全量分组…" : `${model.groups.filter(g => g.manual || g.faces.length > 1).length} 个人物组 · ${model.pending.length} 张待确认`}` : "请读取共享索引与纠错记录"}。索引包含人脸小图和特征，保存在当前公开网盘分享中。</p>
      <div className="match-slider"><div className="match-slider-heading"><label>匹配门槛 <output>{threshold.toFixed(2)}</output><input aria-label="人脸匹配门槛" type="range" min={MIN_MATCH_THRESHOLD} max={MAX_MATCH_THRESHOLD} step="0.01" value={threshold} disabled={busy} onChange={e => changeThreshold(e.target.value)} aria-valuetext={`${threshold.toFixed(2)}，数值越低越宽松`} /></label></div><div className="match-slider-scale"><span>0.10 · 更宽松</span><span>0.80 · 更严格</span></div><p className="upload-help">拖动即可更新分组，无需重建索引；已选参照人脸会自动重新比对。此设置仅影响你的浏览器，自动记住，下次打开仍生效。</p></div>
      {legacyCount > 0 && <p className="upload-help">已升级人脸识别，{legacyCount} 张照片的旧索引需要补建一次，照片无需重新上传。</p>}
      <div className="finder-actions"><button className="subtle" disabled={busy} onClick={() => { onFilter(null); setActive(""); }}>全部照片</button><button className="subtle" disabled={busy} onClick={readIndex}>刷新索引与纠错</button><button disabled={busy || !loaded || indexed === photos.length || !album.canUpload} onClick={() => buildIndex("missing")}>补建人脸索引（{photos.length - indexed} 张）</button><button className="subtle" disabled={busy || !loaded || detailUpdates === 0 || !album.canUpload} onClick={() => buildIndex("details")}>补充检测详情（{detailUpdates} 张）</button><button className="subtle" disabled={busy || !loaded || !indexed} onClick={() => referenceInput.current.click()}><Upload size={16} />选择参照照片</button>{busy && <button className="subtle" onClick={() => { operation.current?.abort(); setStatus("正在停止…"); }}>停止处理</button>}</div>
      <input ref={referenceInput} className="file-picker" type="file" accept=".jpg,.jpeg,.png,.webp" aria-label="选择人脸参照照片" onChange={e => { chooseReference(e.target.files[0]); e.target.value = ""; }} />
      <p className="upload-help">电脑、手机均在本机处理，参照照片不会上传。首次分析需下载约 51 MB 模型和运行文件。侧脸也会尝试提取特征并参与自动分组；检测到但因太小、模糊等原因被排除的人脸会保留原因供人工检查。旧索引可以直接用于新版分组；需要查看检测详情或更新旧的侧脸排除记录时，点一次「补充检测详情」。</p>
      {status && <p className="face-status" role="status">{status}</p>}{error && <p className="error" role="alert">{error}</p>}
      {references.length > 0 && <div className="reference-faces"><p>参照照片中的人脸：</p><div className="people">{references.map((face, i) => <button key={i} disabled={busy} className={active === `reference-${i}` ? "selected" : ""} onClick={() => selectReference(face, i)}><img src={face.avatar} alt="" />参照人脸 {i + 1}</button>)}</div></div>}
      {loaded && <PeoplePanel key={`${scope}|${signature}|${threshold}`} model={model} faces={faces} disabled={busy || grouping} canEdit={album.canUpload} onFilter={(ids, name) => { setActive(""); onFilter(ids, name); }} onSave={persistReview} />}
      {loaded && <details className="face-review-section"><summary>逐张照片检测状态 · {photos.length} 张</summary>{photos.map(photo => {
        const key = faceIndexKey(photo), detail = diagnostics.get(key), indexed = indices.has(key);
        return <div className="detection-row" key={key}><span>{photoLabel(photo.name).originalName}</span><small>{!indexed ? "尚无可用索引" : !detail ? `已有 ${indices.get(key).length} 张清晰人脸；旧索引未保存排除原因` : detail.totalDetected === 0 ? "未检测到人脸" : `检测到 ${detail.totalDetected} 张脸 · ${detail.accepted} 张参与自动识别 · ${detail.rejected.length} 张保留原因${detail.totalDetected > detail.accepted + detail.rejected.length ? " · 超过单张200脸处理上限" : ""}`}</small><button className="subtle" disabled={busy} onClick={() => { setActive(""); onFilter([photo.docid], photoLabel(photo.name).originalName); }}>查看照片</button></div>;
      })}</details>}
    </>}
  </section>;
}
