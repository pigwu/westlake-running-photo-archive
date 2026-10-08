import React, { useEffect, useRef, useState } from "react";
import { Upload, FolderOpen, ArrowLeft, CheckCircle2, X, LockKeyhole } from "lucide-react";
import { parseShare, isExpired, shareRequest } from "./westlake";
import { validatePhoto, uploadPhoto, todayShanghai } from "./upload";
import { albumPhotoName } from "./albums.js";

export default function Uploader({ albums, onOpen, onCreate, onRename, selectedAlbumId }) {
  const [id, setId] = useState("");
  const album = albums.find(a => a.id === id) || albums[0];
  useEffect(() => { if (selectedAlbumId) setId(selectedAlbumId); }, [selectedAlbumId]);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [session, setSession] = useState(null);
  const [trail, setTrail] = useState([]);
  const [listing, setListing] = useState({ dirs: [], files: [] });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(todayShanghai);
  const [activity, setActivity] = useState("");
  const [queue, setQueue] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const operation = useRef(null);
  const fileInput = useRef(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!album || isExpired(album)) return;
    setSession(null); setQueue([]); setTrail([]); setNeedsPassword(false);
    connect(null, album.accessPassword || "");
    return () => operation.current?.abort();
  }, [album?.id]);
  async function connect(e, accessPassword = password || album?.accessPassword || "") {
    e?.preventDefault(); setConnecting(true); setError("");
    const abort = new AbortController(); operation.current = abort;
    try {
      const link = parseShare(album.url);
      const info = await shareRequest(link, accessPassword, "get", {}, abort.signal);
      if (info.size !== -1) throw new Error("请使用文件夹分享链接上传照片");
      if (!(info.perm & 4)) throw new Error("此分享未开启上传权限，请在学校网盘共享设置中勾选“上传”");
      const data = await shareRequest(link, accessPassword, "listdir", { docid: info.docid, attr: [], by: "name", sort: "asc" }, abort.signal);
      if (abort.signal.aborted) return;
      setSession({ link, password: accessPassword }); setPassword(""); setTrail([{ docid: info.docid, name: album.title }]); setListing(data);
    } catch (e) { if (!abort.signal.aborted) { setNeedsPassword(e.code === 401002); setError(e.code === 401002 ? "网盘分享密码已变更，请更新相册连接或输入新密码。" : e.message); } }
    finally { if (!abort.signal.aborted) setConnecting(false); }
  }
  async function navigate(next) {
    setConnecting(true); setError("");
    const abort = new AbortController(); operation.current = abort;
    try {
      const data = await shareRequest(session.link, session.password, "listdir", { docid: next.at(-1).docid, attr: [], by: "name", sort: "asc" }, abort.signal);
      if (abort.signal.aborted) return;
      setListing(data); setTrail(next);
    } catch (e) { if (!abort.signal.aborted) setError(e.message); }
    finally { if (!abort.signal.aborted) setConnecting(false); }
  }
  function choose(files) {
    setError(""); setResult("");
    const chosen = Array.from(files);
    if (queue.length + chosen.length > 100) { setError("一次最多选择 100 张照片"); return; }
    const items = [], invalid = [];
    for (const file of chosen) {
      try { validatePhoto(file); items.push({ id: crypto.randomUUID(), file, status: "pending", progress: 0, message: "待上传" }); }
      catch (e) { invalid.push(`${file.name}：${e.message}`); }
    }
    setQueue(q => [...q, ...items]); if (invalid.length) setError(invalid.join("；"));
  }
  const update = (id, patch) => setQueue(q => q.map(item => item.id === id ? { ...item, ...patch } : item));
  async function start() {
    setError(""); setResult("");
    const pending = queue.filter(q => q.status !== "done");
    let names;
    try { names = pending.map(q => albumPhotoName(q.file, date, activity, album.albumId)); }
    catch (e) { setError(e.message); return; }
    if (!pending.length) return;
    setRunning(true); const abort = new AbortController(); operation.current = abort;
    const folder = trail.at(-1).docid;
    let success = 0, failed = 0;
    for (let i = 0; i < pending.length; i++) {
      if (abort.signal.aborted) break;
      const item = pending[i]; update(item.id, { status: "uploading", progress: 0, message: "正在上传" });
      try {
        await uploadPhoto(session, folder, item.file, names[i], { signal: abort.signal, onProgress: progress => update(item.id, { progress }) });
        success++; update(item.id, { status: "done", progress: 100, message: "已保存到学校网盘", storedName: names[i] });
      } catch (e) {
        if (abort.signal.aborted) { update(item.id, { status: "pending", progress: 0, message: "已取消，可重试" }); break; }
        failed++; update(item.id, { status: "error", message: e.message, progress: 0 });
      }
    }
    setRunning(false);
    setResult(`${abort.signal.aborted ? "上传已停止。" : "本次上传完成。"}成功 ${success} 张${failed ? `，失败 ${failed} 张，可重试失败项` : ""}。`);
    if (!abort.signal.aborted) {
      try { const data = await shareRequest(session.link, session.password, "listdir", { docid: folder, attr: [], by: "name", sort: "asc" }); setListing(data); }
      catch { setError("上传已完成，目录刷新失败。稍后打开相册查看。"); }
    }
  }
  const done = queue.filter(q => q.status === "done").length;
  function lock() {
    operation.current?.abort(); setSession(null); setPassword(""); setQueue([]); setTrail([]); setError(""); setResult("");
  }
  return <section className="uploader">
    <div className="intro"><div><span className="eyebrow">CONTRIBUTE YOUR MEMORIES</span><h1>把你的照片，留在这里<span>。</span></h1><p>每次活动一个相册，选择相册后上传照片。日期默认当天，活动名称可选。</p></div><Upload size={40} strokeWidth={1} /></div>
    {!session ? <form className="upload-connect" onSubmit={connect}><div className="upload-section-title"><LockKeyhole size={21} /><h2>连接上传相册</h2></div><div className="upload-fields"><label>目标相册<select value={album?.id || ""} disabled={connecting} onChange={e => { setId(e.target.value); setError(""); }}>{albums.map(a => <option key={a.id} value={a.id} disabled={isExpired(a)}>{a.title}{isExpired(a) ? "（已到期）" : ""}</option>)}</select></label>{needsPassword && <label>网盘分享密码<input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} placeholder="输入目标相册的分享密码" disabled={connecting} /></label>}</div><p className="upload-help">自动连接学校网盘，无需填写密码。</p><button disabled={!album || isExpired(album) || connecting}>{connecting ? "连接中…" : "进入上传页面"}</button></form> : <>
      <div className="album-upload-controls"><label>上传到相册<select aria-label="上传到相册" value={album?.id || ""} disabled={running || connecting || queue.some(q => q.status !== "done")} onChange={e => { setId(e.target.value); setResult(""); }}>{albums.map(a => <option key={a.id} value={a.id} disabled={isExpired(a)}>{a.title}</option>)}</select></label><button className="subtle" disabled={running || connecting || queue.some(q => q.status !== "done")} onClick={onCreate}>＋ 新建相册</button><button className="subtle" disabled={running || connecting || queue.some(q => q.status !== "done")} onClick={() => onRename(album)}>重命名相册</button></div>
      <div className="upload-destination"><FolderOpen size={22} /><div><small>网盘存储位置</small><div className="breadcrumbs">{trail.map((folder, i) => <button key={folder.docid} disabled={running || connecting || i === trail.length - 1} onClick={() => navigate(trail.slice(0, i + 1))}>{folder.name}{i < trail.length - 1 ? " /" : ""}</button>)}</div></div><button className="subtle" disabled={running || connecting} onClick={lock}><X size={17} />断开连接</button></div>
      {listing.dirs.length > 0 && <div className="folders">{listing.dirs.map(d => <button key={d.docid} disabled={running || connecting} onClick={() => navigate([...trail, d])}><FolderOpen size={18} />{d.name}</button>)}</div>}
      <div className="upload-fields"><label>活动名称（选填）<input value={activity} disabled={running} onChange={e => setActivity(e.target.value)} placeholder="不填则不标记活动" maxLength={40} /></label><label>拍摄日期<input type="date" value={date} disabled={running} onChange={e => setDate(e.target.value)} /></label></div>
      <p className="upload-help">活动和日期会写入照片文件名，跑友可在相册中看到这些标记。原始图片内容保持不变。上传时请保持本页打开。</p>
      <input ref={fileInput} className="file-picker" type="file" aria-label="选择要上传的照片" accept=".jpg,.jpeg,.png,.webp,.gif" multiple disabled={running} onChange={e => { choose(e.target.files); e.target.value = ""; }} />
      <button className="upload-dropzone" disabled={running} onClick={() => fileInput.current.click()}><Upload size={32} /><strong>点击选择照片</strong><span>支持多选 · JPG / PNG / WebP / GIF · 每张最多 50 MB</span></button>
      {queue.length > 0 && <div className="upload-queue"><div className="queue-heading"><span>{queue.length} 张照片 · 已完成 {done} 张</span><button className="subtle" disabled={running} onClick={() => { setQueue(q => q.filter(i => i.status === "done")); setResult(""); }}>清除待上传项</button></div>{queue.map(item => <div key={item.id} className={`queue-row ${item.status}`}><div><strong>{item.file.name}</strong><small>{(item.file.size / 1024 / 1024).toFixed(1)} MB</small><p role={item.status === "error" ? "alert" : undefined}>{item.message}</p>{item.status === "uploading" && <progress value={item.progress} max="100" />}</div><span>{item.status === "done" ? <CheckCircle2 size={20} /> : item.status === "uploading" ? `${item.progress}%` : <button className="subtle" aria-label={`移除 ${item.file.name}`} disabled={running} onClick={() => setQueue(q => q.filter(i => i.id !== item.id))}><X size={17} /></button>}</span></div>)}</div>}
      <div className="upload-bottom"><button disabled={running || connecting || !queue.some(q => q.status !== "done")} onClick={start}><Upload size={17} />{running ? "上传中…" : done ? "继续上传待处理照片" : "开始上传"}</button>{running && <button className="subtle" onClick={() => operation.current?.abort()}>停止上传</button>}<button className="subtle" disabled={running || connecting} onClick={() => onOpen(album, session, listing, trail)}><ArrowLeft size={17} />查看相册</button></div>
      {result && <p className="upload-result" role="status">{result}</p>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
