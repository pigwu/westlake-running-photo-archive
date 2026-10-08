import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScanFace, X, Upload } from "lucide-react";
import { originalPhotoBlob } from "./westlake.js";
import { faceIndexKey, loadFaceIndices, saveFaceIndex, referencePhotoIds } from "./face-cache.js";
import { groupDetectedFaces } from "./face-utils.js";
import { MATCHING_PRESETS } from "./sface-utils.js";

export default function PersonFinder({ session, album, photos, onFilter }) {
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [indices, setIndices] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [references, setReferences] = useState([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [matching, setMatching] = useState("standard");
  const preset = MATCHING_PRESETS[matching];
  const operation = useRef(null), referenceInput = useRef(null);
  const legacyKeys = useRef([]);
  const signature = photos.map(faceIndexKey).join("\n");
  useEffect(() => {
    setLoaded(false); setIndices(new Map()); setLegacyCount(0); setReferences([]); setActive(""); onFilter(null);
    return () => operation.current?.abort();
  }, [signature]);
  const groups = useMemo(() => {
    const found = [];
    for (const photo of photos) groupDetectedFaces(found, indices.get(faceIndexKey(photo)) || [], photo.docid, preset.group, preset.pairFloor);
    return found;
  }, [indices, signature, preset]);
  const indexed = photos.filter(p => indices.has(faceIndexKey(p))).length;
  const rootDocid = album.rootDocid || photos[0]?.docid.split("/").slice(0, 3).join("/");
  async function readIndex() {
    setActive(""); onFilter(null);
    setOpened(true); setBusy(true); setError(""); setStatus("读取已保存的人脸索引…");
    const abort = new AbortController(); operation.current = abort;
    try {
      const data = await loadFaceIndices(session, rootDocid, photos, abort.signal);
      if (abort.signal.aborted) return;
      legacyKeys.current = data.legacyKeys || [];
      setIndices(data.indices); setLegacyCount(data.legacyCount || 0); setLoaded(true); setStatus(data.indices.size ? "已读取新版共享索引，已有索引的照片无需重新分析。" : "索引检查完成，请先补建新版人脸索引。");
      if (data.warnings.length) setError(`${data.warnings.length} 张照片的索引暂时无法读取，可重试或补建。`);
    } catch (e) { if (!abort.signal.aborted) setError(e.message); }
    finally { if (operation.current === abort) setBusy(false); }
  }
  async function buildIndex() {
    setActive(""); onFilter(null);
    setBusy(true); setError(""); setStatus("准备补建人脸索引…");
    const abort = new AbortController(); operation.current = abort;
    const next = new Map(indices);
    let failed = 0, lastFailure = "", saved = 0;
    try {
      const { analyzePhoto, prepareFaceAnalysis } = await import("./faces.js");
      // A shared model failure should stop the batch before any original
      // downloads, rather than reporting the same error for all 14 photos.
      await prepareFaceAnalysis({ signal: abort.signal, onProgress: setStatus });
      const missing = photos.filter(p => !next.has(faceIndexKey(p)));
      for (let i = 0; i < missing.length; i++) {
        if (abort.signal.aborted) break;
        const progress = message => { if (!abort.signal.aborted) setStatus(`照片 ${i + 1}/${missing.length} · ${message}`); };
        let url;
        try {
          progress("读取原图…");
          const blob = await originalPhotoBlob(session, missing[i], abort.signal);
          if (abort.signal.aborted) break;
          url = URL.createObjectURL(blob);
          const faces = await analyzePhoto({ url }, { signal: abort.signal, onProgress: progress });
          progress("保存共享人脸索引…");
          await saveFaceIndex(session, rootDocid, missing[i], faces, { signal: abort.signal });
          next.set(faceIndexKey(missing[i]), faces); saved++; setIndices(new Map(next));
        } catch (e) { if (abort.signal.aborted) break; failed++; lastFailure = e.message; }
        finally { if (url) URL.revokeObjectURL(url); }
      }
      setLegacyCount(legacyKeys.current.filter(key => !next.has(key)).length);
      setLoaded(true); setStatus(`${abort.signal.aborted ? "已停止。" : failed && !saved ? "补建失败。" : "补建完成。"}已保存 ${saved} 张照片的人脸索引。${saved ? "其他跑友可直接使用。" : ""}`);
      if (failed) setError(`${failed} 张索引建立失败：${lastFailure}`);
    } catch (e) {
      if (!abort.signal.aborted) { setStatus("未开始补建，请刷新页面后重试。"); setError(`人脸模型加载失败：${e.message}`); }
      else setStatus("已停止。");
    }
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
    const matches = referencePhotoIds([face], indices, photos, preset.reference);
    onFilter(matches); setActive(`reference-${index}`);
    setStatus(`找到 ${matches.length} 张相似照片。结果可能有遗漏或误匹配，请人工确认。`);
  }
  return <section className="person-finder">
    {!opened ? <button className="subtle" disabled={!photos.length || busy} onClick={readIndex}><ScanFace size={17} />按人找照片</button> : <>
      <div className="finder-heading"><h2><ScanFace size={20} />按人找照片</h2><button className="subtle" disabled={busy} aria-label="关闭人物筛选" onClick={() => { setOpened(false); setActive(""); onFilter(null); }}><X size={18} /></button></div>
      <p className="face-status">{loaded ? `${indexed}/${photos.length} 张照片已有共享索引 · ${groups.length} 个人物组` : "正在读取索引"}。索引包含人脸小图和特征，保存在当前公开网盘分享中。分组需人工确认。</p>
      {legacyCount > 0 && <p className="upload-help">已升级人脸识别，{legacyCount} 张照片的旧索引需要补建一次，照片无需重新上传。</p>}
      <label className="finder-strict">匹配范围<select aria-label="匹配范围" value={matching} disabled={busy} onChange={e => { setMatching(e.target.value); setActive(""); onFilter(null); setStatus("匹配范围已更新，请重新选择人物头像或参照人脸。"); }}><option value="standard">标准匹配（默认）</option><option value="relaxed">更宽松地匹配（减少人物拆分）</option><option value="strict">更严格地匹配（减少混入别人）</option></select></label>
      <p className="upload-help">同一个人被分成多个组时，试试“更宽松地匹配”；混入其他人时，改用“更严格地匹配”。切换立即使用已有索引重新分组，无需重建索引。</p>
      <div className="finder-actions"><button className="subtle" disabled={busy} onClick={() => { onFilter(null); setActive(""); }}>全部照片</button><button className="subtle" disabled={busy} onClick={readIndex}>刷新索引</button><button disabled={busy || !loaded || indexed === photos.length || !album.canUpload} onClick={buildIndex}>补建人脸索引（{photos.length - indexed} 张）</button><button className="subtle" disabled={busy || !loaded || !indexed} onClick={() => referenceInput.current.click()}><Upload size={16} />选择参照照片</button>{busy && <button className="subtle" onClick={() => { operation.current?.abort(); setStatus("正在停止…"); }}>停止处理</button>}</div>
      <input ref={referenceInput} className="file-picker" type="file" accept=".jpg,.jpeg,.png,.webp" aria-label="选择人脸参照照片" onChange={e => { chooseReference(e.target.files[0]); e.target.value = ""; }} />
      <p className="upload-help">电脑、手机均在本机处理，参照照片不会上传。首次分析需下载约 51 MB 模型和运行文件。模糊、小脸和大角度侧脸会跳过；计算时保持页面打开。手机也可只上传照片，稍后由电脑补建。</p>
      {status && <p className="face-status" role="status">{status}</p>}{error && <p className="error" role="alert">{error}</p>}
      {references.length > 0 && <div className="reference-faces"><p>参照照片中的人脸：</p><div className="people">{references.map((face, i) => <button key={i} disabled={busy} className={active === `reference-${i}` ? "selected" : ""} onClick={() => selectReference(face, i)}><img src={face.avatar} alt="" />参照人脸 {i + 1}</button>)}</div></div>}
      <div className="people">{groups.map((group, i) => <button key={i} disabled={busy} className={active === `group-${i}` ? "selected" : ""} onClick={() => { onFilter(group.photos); setActive(`group-${i}`); }}><img src={group.avatar} alt="" />{group.name} · {group.photos.length} 张</button>)}</div>
      {loaded && !groups.length && <p className="face-status">暂时没有可用人物分组，可先补建索引。</p>}
    </>}
  </section>;
}
