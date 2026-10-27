import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScanFace, X, Upload } from "lucide-react";
import { originalPhotoBlob } from "./westlake.js";
import { faceIndexKey, loadFaceIndices, saveFaceIndex, needsFaceDetailsUpdate, needsFusionUpgrade } from "./face-cache.js";
import { indexedFaces } from "./people.js";
import { loadReviews, saveReview } from "./people-review.js";
import { prepareCachedPhoto, finishCachedPhoto } from "./analysis-cache.js";
import { createPhotoPool, supportsPhotoWorkers } from "./photo-pool.js";
import { runConcurrentPhotos, recommendedPhotoConcurrency, normalizePhotoConcurrency } from "./concurrent-photos.js";
import { buildReferenceProfiles, matchReferencePerson } from "./reference-people.js";
import ReferencePeople from "./ReferencePeople.jsx";
import PeoplePanel from "./PeoplePanel.jsx";
import PeopleWorker from "./people-worker.js?worker&inline";
import { photoLabel } from "./upload.js";
import { FUSION_THRESHOLD as FACE_MATCH_THRESHOLD, FUSION_MIN as MIN_MATCH_THRESHOLD, FUSION_MAX as MAX_MATCH_THRESHOLD, fusionThreshold as normalizeMatchThreshold, preserveReviewPositions } from "./fusion-utils.js";

const PHOTO_CONCURRENCY = "run-photo-concurrency-v1";
const autoConcurrency = () => supportsPhotoWorkers() ? recommendedPhotoConcurrency(navigator.hardwareConcurrency,navigator.deviceMemory) : 1;
function savedConcurrency(){try{return normalizePhotoConcurrency(localStorage.getItem(PHOTO_CONCURRENCY),autoConcurrency());}catch{return autoConcurrency();}}
const MATCH_PREFERENCE = "run-face-fusion-threshold-v1";
const EMPTY_PEOPLE = { groups: [], pending: [], ignored: [], unrecognized: [], conflicts: [] };
function savedThreshold() {
  try {
    const value = normalizeMatchThreshold(localStorage.getItem(MATCH_PREFERENCE));
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
  const [groupedInput,setGroupedInput] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [references, setReferences] = useState([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [threshold, setThreshold] = useState(savedThreshold);
  const [concurrency,setConcurrency] = useState(savedConcurrency);
  const operation = useRef(null), referenceInput = useRef(null);
  const legacyKeys = useRef([]), groupingWorker = useRef(null), groupingRequest = useRef(0);
  useEffect(() => { setActive(""); }, [resetSelection]);
  const signature = photos.map(faceIndexKey).join("\n");
  const scope = `${session.link}|${album.rootDocid || ""}|${album.albumId || "legacy"}`;
  useEffect(() => {
    setLoaded(false); setIndices(new Map()); setDiagnostics(new Map()); setReview({ assignments: {}, names: {} }); setModel(EMPTY_PEOPLE); setGrouping(false); setLegacyCount(0); setReferences([]); setActive(""); onFilter(null);
    setBusy(false); setStatus(""); setError("");
    return () => { operation.current?.abort(); operation.current = null; };
  }, [signature, scope]);
  const faces = useMemo(() => indexedFaces(photos, indices, diagnostics), [indices, diagnostics, signature]);
  const groupingInput=useMemo(()=>({faces,threshold,review}),[faces,threshold,review]);
  useEffect(() => {
    if (!loaded) return;
    let worker;
    try {
      worker=new PeopleWorker();groupingWorker.current=worker;
      worker.onmessage=({data})=>{
        if(data.requestId!==groupingRequest.current)return;
        setGrouping(false);
        if(data.error){setModel(EMPTY_PEOPLE);setGroupedInput(null);setError(data.error);}else {setModel(data.result);setGroupedInput(worker.pendingInput);}
      };
      worker.onerror=()=>{setGrouping(false);setModel(EMPTY_PEOPLE);setGroupedInput(null);setError("人物分组失败，请刷新后重试");};
      // The next effect sends the initial snapshot once. Later threshold and
      // review changes reuse both the worker and its exact similarity matrix.
      worker.faceSnapshot=null;
    }catch(e){setGrouping(false);setError(`无法启动人物分组：${e.message}`);}
    return ()=>{groupingRequest.current++;worker?.terminate();groupingWorker.current=null;};
  },[loaded]);
  useEffect(()=>{
    const worker=groupingWorker.current;if(!worker||busy||groupedInput===groupingInput)return;
    const requestId=++groupingRequest.current;setGrouping(true);
    const timer=setTimeout(()=>{
      worker.pendingInput=groupingInput;
      worker.postMessage({requestId,threshold,review,...(worker.faceSnapshot!==faces?{faces}:{})});worker.faceSnapshot=faces;
    },120);
    return ()=>{clearTimeout(timer);groupingRequest.current++;};
  },[groupingInput,groupedInput,loaded,busy]);
  const modelReady=loaded&&!grouping&&groupedInput===groupingInput;
  const referenceProfiles=useMemo(()=>buildReferenceProfiles(model.groups,photos.map(p=>p.docid),new Set(Object.keys(review.assignments).filter(key=>review.assignments[key]==="ignore"))),[model,signature,review]);
  const referenceMatch=useMemo(()=>active.startsWith("reference-")?matchReferencePerson(references[Number(active.slice("reference-".length))],referenceProfiles,threshold):null,[active,references,referenceProfiles,threshold]);
  useEffect(()=>{
    if(!referenceMatch||!modelReady||busy)return;
    const selected=referenceMatch.candidates.find(g=>g.id===referenceMatch.automatic);
    if(selected){
      onFilter(selected.photos,selected.name);
      setStatus(`已匹配到「${selected.name}」，显示该人物类别的全部 ${selected.photos.length} 张照片。`);
    }else{
      onFilter(null);
      setStatus(referenceMatch.candidates.length?"找到相近的人物类别，请选择你自己；不会自动合并不同人物。":"未匹配到可靠人物类别，请更换参照照片或在人物列表中选择。");
    }
  },[referenceMatch,modelReady,busy]);
  function changeThreshold(value) {
    const next = normalizeMatchThreshold(value);
    setThreshold(next);
    try { localStorage.setItem(MATCH_PREFERENCE, String(next)); } catch { /* Browsing still works without storage. */ }
    if (!active.startsWith("reference-")) setActive("");
    onFilter(null);
  }
  const indexed = photos.filter(p => indices.has(faceIndexKey(p))).length;

  const upgrades = photos.filter(p => needsFusionUpgrade(indices.get(faceIndexKey(p)), diagnostics.get(faceIndexKey(p)))).length;
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
    let failed = 0, lastFailure = "", saved = 0, completed = 0;
    const parallel=supportsPhotoWorkers(), lanes=parallel?concurrency:1;
    const pool=parallel?createPhotoPool({signal:abort.signal}):null;
    try {
      const missing = photos.filter(p => {
        const key = faceIndexKey(p);
        return !next.has(key) || (mode === "fusion" && needsFusionUpgrade(next.get(key),nextDetails.get(key))) || (mode === "details" && needsFaceDetailsUpdate(nextDetails.get(key)));
      });
      const previousFor = photo => preserveReviewPositions(photo, review.assignments, [...(next.get(faceIndexKey(photo))||[]), ...(nextDetails.get(faceIndexKey(photo))?.rejected||[])]);
      const models=new Map();let firstModel;
      const ensureModel=(lane,progress)=>{
        if(!models.has(lane)){
          const start=()=>parallel?pool.prepare(lane,progress):import("./faces.js").then(({prepareFaceAnalysis})=>prepareFaceAnalysis({signal:abort.signal,onProgress:progress}));
          // Download/cache the weights once before the other lanes load them.
          if(!firstModel){firstModel=start();models.set(lane,firstModel);}
          else models.set(lane,firstModel.then(start));
        }
        return models.get(lane);
      };
      await runConcurrentPhotos(missing,lanes,async(photo,index,lane)=>{
        const progress=message=>{if(!abort.signal.aborted)setStatus(`${lanes} 路并行 · 已完成 ${completed}/${missing.length} · 通道 ${lane+1} / 照片 ${index+1} · ${message}`);};
        try{
          const prior=previousFor(photo);
          const prepared=await prepareCachedPhoto(photo,{scope:session.link,previousFaces:prior,signal:abort.signal,loadBlob:async()=>{
            await ensureModel(lane,progress);progress("读取原图…");return originalPhotoBlob(session,photo,abort.signal);
          }});
          const {faces,diagnostics:detail}=await finishCachedPhoto(prepared,{signal:abort.signal,previousFaces:prior,onProgress:progress,
            ...(parallel?{analyze:(p,o)=>pool.analyze(lane,p,o)}:{})});
          progress("保存共享人脸索引…");
          await saveFaceIndex(session,rootDocid,photo,faces,{signal:abort.signal,diagnostics:detail});
          if(abort.signal.aborted||operation.current!==abort)return;
          next.set(faceIndexKey(photo),faces);if(detail)nextDetails.set(faceIndexKey(photo),detail);
          saved++;setIndices(new Map(next));setDiagnostics(new Map(nextDetails));
        }catch(e){if(!abort.signal.aborted){failed++;lastFailure=e.message;}}
        finally{completed++;}
      },abort.signal);
      if (operation.current !== abort) return;
      setLegacyCount(legacyKeys.current.filter(key => !next.has(key)).length);
      setLoaded(true); setStatus(`${abort.signal.aborted ? "已停止。" : failed && !saved ? "补建失败。" : "补建完成。"}已保存 ${saved} 张照片的人脸索引。${saved ? "其他跑友可直接使用。" : ""}`);
      if (failed) setError(`${failed} 张索引建立失败：${lastFailure}`);
    } catch (e) {
      if (!abort.signal.aborted) { setStatus("未开始补建，请刷新页面后重试。"); setError(`索引建立失败：${e.message}`); }
      else if (operation.current === abort) setStatus("已停止。");
    }
    finally { pool?.close();if (operation.current === abort) setBusy(false); }
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
      setReferences(faces); setStatus(faces.length ? "请选择参照照片中的你，匹配已分类人物并查看该人物全部照片。" : "参照照片未检测到清晰人脸，请换一张正面照片。");
    } catch (e) { if (!abort.signal.aborted) setError(e.message); }
    finally { URL.revokeObjectURL(url); if (operation.current === abort) setBusy(false); }
  }
  function selectReference(face, index) {
    setActive(`reference-${index}`);
  }
  return <section className="person-finder">
    {!opened ? <button className="subtle" disabled={!photos.length || busy} onClick={readIndex}><ScanFace size={17} />按人找照片</button> : <>
      <div className="finder-heading"><h2><ScanFace size={20} />按人找照片 · 多角度融合版</h2><button className="subtle" disabled={busy} aria-label="关闭人物筛选" onClick={() => { setOpened(false); setActive(""); onFilter(null); }}><X size={18} /></button></div>
      <p className="face-status">{loaded ? `${indexed}/${photos.length} 张照片已有共享索引 · ${grouping ? "正在全量分组…" : `${model.groups.filter(g => g.manual || g.faces.length > 1).length} 个人物组 · ${model.pending.length} 张待确认`}` : "请读取共享索引与纠错记录"}。索引包含人脸小图和特征，保存在当前公开网盘分享中。</p>
      <div className="match-slider"><div className="match-slider-heading"><label>匹配门槛 <output>{threshold.toFixed(2)}</output><input aria-label="人脸匹配门槛" type="range" min={MIN_MATCH_THRESHOLD} max={MAX_MATCH_THRESHOLD} step="0.01" value={threshold} disabled={busy} onChange={e => changeThreshold(e.target.value)} aria-valuetext={`${threshold.toFixed(2)}，数值越低越宽松`} /></label><button className="subtle" disabled={busy} onClick={()=>changeThreshold(FACE_MATCH_THRESHOLD)}>恢复推荐值</button></div><div className="match-slider-scale"><span>0.30 · 更宽松</span><span>0.80 · 更严格</span></div><p className="upload-help">推荐 0.48。先用清晰的正脸、微侧脸建立人物组，再用多个固定样本匹配侧脸；分数接近或证据不足时保留待确认。调节不会拆散人工确认，设置仅保存在当前浏览器。</p></div>
      {loaded && upgrades > 0 && <label className="upload-help">同时处理照片数 <select aria-label="同时处理照片数" value={concurrency} disabled={busy||!supportsPhotoWorkers()} onChange={e=>{const n=normalizePhotoConcurrency(e.target.value);setConcurrency(n);try{localStorage.setItem(PHOTO_CONCURRENCY,String(n));}catch{}}}>{[1,2,4,6,8].map(n=><option key={n} value={n}>{n} 路{n===autoConcurrency()?"（自动建议）":""}</option>)}</select> 每路独立检测和识别，完成一张就保存一张。{!supportsPhotoWorkers()&&"此浏览器暂不支持并行图像计算，使用单路。"}</label>}
      {loaded && upgrades > 0 && <div className="fusion-upgrade"><strong>融合索引待建立 · {upgrades} 张照片</strong><p>网站只使用新版索引。原图无需重传，已有人工确认和忽略记录继续保留；按照片保存，可停止后继续。</p><button disabled={busy || !album.canUpload} onClick={()=>buildIndex("fusion")}>建立融合索引（{upgrades} 张）</button>{!album.canUpload && <p>请有上传权限的跑友用电脑完成建立。</p>}</div>}
      {legacyCount > 0 && <p className="upload-help">已升级人脸识别，{legacyCount} 张照片的旧索引需要补建一次，照片无需重新上传。</p>}
      <div className="finder-actions"><button className="subtle" disabled={busy} onClick={() => { onFilter(null); setActive(""); }}>全部照片</button><button className="subtle" disabled={busy} onClick={readIndex}>刷新索引与纠错</button><button className="subtle" disabled={busy || !modelReady || !indexed} onClick={() => referenceInput.current.click()}><Upload size={16} />选择参照照片</button>{busy && <button className="subtle" onClick={() => { operation.current?.abort(); setStatus("正在停止…"); }}>停止处理</button>}</div>
      <input ref={referenceInput} className="file-picker" type="file" accept=".jpg,.jpeg,.png,.webp" aria-label="选择人脸参照照片" onChange={e => { chooseReference(e.target.files[0]); e.target.value = ""; }} />
      <p className="upload-help">参照照片仅在本机识别，优先匹配已分类人物，再显示该人物类别的全部照片；不再逐张扫描相册来决定返回哪些照片。首次分析需下载约 190 MB 模型和运行文件，建议用电脑建立索引；手机可直接查看共享结果。大侧脸会尝试匹配，但不会保证归入；模糊、过小或未恢复关键点的人脸保留供人工检查。旧模型与新模型的特征不会混比。</p>
      {status && <p className="face-status" role="status">{status}</p>}{error && <p className="error" role="alert">{error}</p>}
      {references.length > 0 && <div className="reference-faces"><p>参照照片中的人脸：</p><div className="people">{references.map((face, i) => <button key={i} disabled={busy||!modelReady} className={active === `reference-${i}` ? "selected" : ""} onClick={() => selectReference(face, i)}><img src={face.avatar} alt="" />参照人脸 {i + 1}</button>)}</div></div>}
      {modelReady && <ReferencePeople match={referenceMatch} disabled={busy} onChoose={group=>{setActive("");onFilter(group.photos,group.name);setStatus(`显示「${group.name}」类别的全部 ${group.photos.length} 张照片。`);}}/>}
      {loaded && <PeoplePanel key={`${scope}|${signature}|${threshold}`} model={model} faces={faces} disabled={busy || grouping} canEdit={album.canUpload} onFilter={(ids, name) => { setActive(""); onFilter(ids, name); }} onSave={persistReview} />}
      {loaded && <details className="face-review-section"><summary>逐张照片检测状态 · {photos.length} 张</summary>{photos.map(photo => {
        const key = faceIndexKey(photo), detail = diagnostics.get(key), indexed = indices.has(key);
        return <div className="detection-row" key={key}><span>{photoLabel(photo.name).originalName}</span><small>{!indexed ? "尚无可用索引" : !detail ? `已有 ${indices.get(key).length} 张清晰人脸；旧索引未保存排除原因` : detail.totalDetected === 0 ? "未检测到人脸" : `检测到 ${detail.totalDetected} 张脸 · ${detail.accepted} 张参与自动识别 · ${detail.rejected.length} 张保留原因${detail.totalDetected > detail.accepted + detail.rejected.length ? " · 超过单张200脸处理上限" : ""}`}</small><button className="subtle" disabled={busy} onClick={() => { setActive(""); onFilter([photo.docid], photoLabel(photo.name).originalName); }}>查看照片</button></div>;
      })}</details>}
    </>}
  </section>;
}
