import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, FolderOpen, ArrowUpRight, ArrowLeft, Search, CalendarDays, LockKeyhole, ScanFace, X, Download, Upload } from "lucide-react";
import { isExpired, parseShare, shareRequest, originalDownload } from "./westlake";
import { photoLabel } from "./upload";
import Uploader from "./Uploader";
import "./shared.css";

function Thumb({ file, session, onReady, hidden }) {
  const label = photoLabel(file.name);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const downloadAbort = useRef(null);
  useEffect(() => () => downloadAbort.current?.abort(), []);
  async function download() {
    setDownloading(true); setDownloadError("");
    const abort = new AbortController(); downloadAbort.current = abort;
    try {
      const href = await originalDownload(session.link, session.password, file, abort.signal);
      if (abort.signal.aborted) return;
      // The school's signed URL returns Content-Disposition: attachment.
      // Let the browser save original bytes without navigating to the share page.
      const anchor = document.createElement("a");
      anchor.href = href; anchor.download = file.name; anchor.referrerPolicy = "no-referrer";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (e) { if (!abort.signal.aborted) setDownloadError(e.message); }
    finally { if (!abort.signal.aborted) setDownloading(false); }
  }
  useEffect(() => {
    let objectURL;
    const abort = new AbortController();
    shareRequest(session.link, session.password, "thumbnail", { docid: file.docid, rev: file.rev, height: 900, width: 1200, quality: 85 }, abort.signal)
      .then(blob => {
        if (abort.signal.aborted) return;
        objectURL = URL.createObjectURL(blob); setUrl(objectURL); onReady(file.docid, objectURL);
      }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => { abort.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [file.docid, file.rev, session]);
  return <div className="photo" hidden={hidden}><div className="photo-image">{url ? <img src={url} alt={label.originalName} /> : <span>{error || "正在读取照片…"}</span>}</div>{label.date && <div className="photo-label">{label.date}{label.activity && ` · ${label.activity}`}</div>}<p title={file.name}>{label.originalName}</p><div className="photo-actions"><span>{(file.size / 1024 / 1024).toFixed(1)} MB · 原图</span><button aria-label={`下载原图 ${file.name}`} disabled={downloading} onClick={download}><Download size={15} />{downloading ? "准备下载…" : "下载原图"}</button></div>{downloadError && <p className="download-error" role="alert">{downloadError}</p>}</div>;
}

function SharedArchive() {
  const [view, setView] = useState(location.hash === "#/upload" ? "upload" : "gallery");
  const [albums, setAlbums] = useState([]);
  const [configError, setConfigError] = useState("");
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState("");
  const [month, setMonth] = useState("");
  const [album, setAlbum] = useState(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [session, setSession] = useState(null);
  const [listing, setListing] = useState({ dirs: [], files: [] });
  const [trail, setTrail] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState([]);
  const [person, setPerson] = useState(null);
  const [faceStatus, setFaceStatus] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const urls = useRef(new Map());
  const generation = useRef(0);
  useEffect(() => {
    const route = () => { closeAlbum(); setView(location.hash === "#/upload" ? "upload" : "gallery"); };
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}albums.json`, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("相册配置读取失败"); return r.json(); })
      .then(data => {
        if (!Array.isArray(data)) throw new Error("相册配置应为列表");
        data.forEach(a => parseShare(a.url)); setAlbums(data);
      }).catch(e => setConfigError(e.message));
  }, []);
  function clearView() {
    generation.current++; urls.current.clear(); setGroups([]); setPerson(null); setFaceStatus(""); setAnalyzing(false);
  }
  function closeAlbum() {
    clearView(); setAlbum(null); setSession(null); setPassword(""); setError(""); setListing({ dirs: [], files: [] }); setTrail([]); setBusy(false);
  }
  useEffect(() => {
    if (album && !session) { setNeedsPassword(false); unlock(null, album.accessPassword || ""); }
  }, [album]);
  async function unlock(e, accessPassword = password || album?.accessPassword || "") {
    e?.preventDefault(); setBusy(true); setError("");
    const version = generation.current;
    try {
      const link = parseShare(album.url);
      const info = await shareRequest(link, accessPassword, "get");
      const data = info.size === -1 ? await shareRequest(link, accessPassword, "listdir", { docid: info.docid, attr: [], by: "name", sort: "asc" }) : { dirs: [], files: [info] };
      if (version !== generation.current) return;
      setSession({ link, password: accessPassword }); setPassword(""); setListing(data); setTrail([{ docid: info.docid, name: "相册" }]);
    } catch (e) { if (version === generation.current) { setNeedsPassword(e.code === 401002); setError(e.code === 401002 ? "网盘分享密码已变更，请更新相册连接或输入新密码。" : e.message === "Failed to fetch" ? "无法连接学校网盘，请检查网络，或直接打开网盘链接" : e.message); } }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function navigate(folder, nextTrail) {
    clearView(); const version = generation.current; setBusy(true); setError("");
    try {
      const data = await shareRequest(session.link, session.password, "listdir", { docid: folder.docid, attr: [], by: "name", sort: "asc" });
      if (version !== generation.current) return;
      setListing(data); setTrail(nextTrail);
    } catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setBusy(false); }
  }
  const photos = listing.files.filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f.name));
  async function analyze() {
    const version = generation.current;
    setAnalyzing(true); setGroups([]); setPerson(null); setError("");
    try {
      const { analyzePhoto } = await import("./faces");
      const found = []; let failed = 0;
      for (let i = 0; i < photos.length; i++) {
        if (version !== generation.current) return;
        setFaceStatus(`正在分析 ${i + 1} / ${photos.length}`);
        try {
          const faces = await analyzePhoto({ url: urls.current.get(photos[i].docid) });
          for (const face of faces) {
            const distances = found.map(g => Math.sqrt(g.descriptor.reduce((sum, v, j) => sum + (v - face.descriptor[j]) ** 2, 0)));
            const closest = Math.min(...distances);
            const group = closest < 0.5 ? found[distances.indexOf(closest)] : null;
            if (group) { if (!group.photos.includes(photos[i].docid)) group.photos.push(photos[i].docid); }
            else found.push({ ...face, name: `人物 ${found.length + 1}`, photos: [photos[i].docid] });
          }
        } catch { failed++; }
      }
      if (version !== generation.current) return;
      setGroups(found); setFaceStatus(`识别到 ${found.length} 个人物分组${failed ? `，${failed} 张分析失败` : ""}。结果仅保留在当前页面，可能需要人工确认。`);
    } catch (e) { if (version === generation.current) setError(`人脸模型加载失败：${e.message}`); }
    finally { if (version === generation.current) setAnalyzing(false); }
  }
  const filtered = albums.filter(a => `${a.title} ${a.activity} ${a.description || ""}`.toLowerCase().includes(query.toLowerCase()) && (!activity || a.activity === activity) && (!month || a.date?.startsWith(month)));
  const ready = photos.length > 0 && photos.every(p => urls.current.has(p.docid));
  const [, setReadyCount] = useState(0);
  return <div className="shared-layout">
    <aside><a className="brand" href={import.meta.env.BASE_URL}><Camera size={26} /><span>拾光<small>跑团照片档案</small></span></a><nav className="shared-nav"><a className={view === "gallery" ? "nav-active" : "nav-link"} href="#/"><FolderOpen size={18} />共享相册</a><a className={view === "upload" ? "nav-active" : "nav-link"} href="#/upload"><Upload size={18} />上传照片</a></nav><div className="sidebar-note"><span className="status-dot" />原图存于学校网盘<p>把每一次出发，<br />留在共同的记忆里。</p></div></aside>
    <main><header><span>WESTLAKE RUNNING CLUB</span><span className="pill">学校网盘 · 在线读取</span></header>
      {configError && <p role="alert" className="error">{configError}</p>}
      {view === "upload" ? <Uploader albums={albums} onOpen={(a, s, data, path) => {
        clearView(); history.replaceState(null, "", "#/"); setView("gallery"); setAlbum(a); setSession(s); setListing(data); setTrail(path);
      }} /> : !album ? <>
        <div className="intro"><div><span className="eyebrow">OUR SHARED MEMORIES</span><h1>一起跑过的时光<span>。</span></h1><p>按活动与日期寻找照片，打开相册，重温每一次出发。</p></div><div className="album-total"><strong>{albums.length.toString().padStart(2, "0")}</strong><span>共享相册</span></div></div>
        <div className="filters"><label className="search"><Search size={18} /><input aria-label="搜索相册" placeholder="搜索活动、相册…" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="活动筛选" value={activity} onChange={e => setActivity(e.target.value)}><option value="">全部活动</option>{[...new Set(albums.map(a => a.activity))].map(a => <option key={a}>{a}</option>)}</select><input aria-label="月份筛选" type="month" value={month} onChange={e => setMonth(e.target.value)} /><button className="subtle" onClick={() => { setQuery(""); setActivity(""); setMonth(""); }}>重置</button></div>
        <div className="album-grid">{filtered.map((a, i) => <article key={a.id} className="album-card"><div className="album-art"><span className="art-ring" /><Camera size={54} strokeWidth={1} /><span className="art-number">{String(i + 1).padStart(2, "0")}</span><span className="art-label">RUN / REMEMBER / REPEAT</span></div><div className="album-content"><span className="activity">{a.activity}</span><h2>{a.title}</h2><p>{a.description}</p><div className="meta"><CalendarDays size={15} />{a.date || "拍摄日期待标记"}</div><div className="card-bottom"><small>{isExpired(a) ? "分享已到期" : a.expiresAt ? `有效至 ${new Date(a.expiresAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "以网盘分享设置为准"}</small><button disabled={isExpired(a)} onClick={() => { clearView(); setReadyCount(0); setAlbum(a); }}>浏览相册 <ArrowUpRight size={17} /></button></div></div></article>)}</div>
        {!configError && filtered.length === 0 && <div className="empty">没有符合条件的相册。</div>}
      </> : <>
        <button className="back" onClick={closeAlbum}><ArrowLeft size={17} />全部相册</button><div className="album-heading"><div><span className="eyebrow">{album.activity}</span><h1>{album.title}</h1><p>{album.date || "拍摄日期待标记"}</p></div><a className="external" href={album.url} target="_blank" rel="noopener noreferrer">在网盘中打开 <ArrowUpRight size={17} /></a></div>
        {!session ? <form className="unlock" onSubmit={unlock}><FolderOpen size={28} /><h2>{needsPassword ? "更新相册连接" : "连接学校网盘"}</h2><p>无需填写密码，自动打开共享照片。</p>{needsPassword && <label>分享密码<input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} autoFocus placeholder="输入更新后的分享密码" /></label>}<button disabled={busy}>{busy ? "正在连接学校网盘…" : "打开照片"}</button></form> : <>
          <div className="gallery-toolbar"><div className="breadcrumbs">{trail.map((folder, i) => <button key={folder.docid} disabled={busy || i === trail.length - 1} onClick={() => navigate(folder, trail.slice(0, i + 1))}>{folder.name}{i < trail.length - 1 ? " /" : ""}</button>)}</div><span>{photos.length} 张照片</span><button disabled={!ready || busy || analyzing} onClick={analyze}><ScanFace size={17} />{analyzing ? "分析中…" : "本机人脸分组"}</button><button className="subtle" onClick={() => { clearView(); setReadyCount(0); setSession(null); setListing({ dirs: [], files: [] }); }}><X size={16} />断开连接</button></div>
          {faceStatus && <p className="face-status" role="status">{faceStatus}</p>}
          {groups.length > 0 && <div className="people"><button className={person === null ? "selected" : ""} onClick={() => setPerson(null)}>全部照片</button>{groups.map((g, i) => <button key={i} className={person === i ? "selected" : ""} onClick={() => setPerson(i)}><img src={g.avatar} alt="" />{g.name} · {g.photos.length}</button>)}</div>}
          {busy ? <p>正在读取文件夹…</p> : <><div className="folders">{listing.dirs.map(d => <button key={d.docid} onClick={() => navigate(d, [...trail, d])}><FolderOpen size={20} />{d.name}</button>)}</div><div className="photo-grid">{photos.map(file => <Thumb key={file.docid} file={file} session={session} hidden={person !== null && !groups[person]?.photos.includes(file.docid)} onReady={(id, url) => { urls.current.set(id, url); setReadyCount(n => n + 1); }} />)}</div>{photos.length === 0 && <div className="empty">当前文件夹没有可预览照片，可进入子文件夹或在网盘中查看。</div>}</>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </>}
      <footer>拾光 · 每一步，都值得被记住。<span>照片读取遵循网盘分享权限与有效期</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById("root")).render(<SharedArchive />);
