import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, FolderOpen, ArrowUpRight, ArrowLeft, Search, CalendarDays, X, Download, Upload, Trash2, RotateCcw } from "lucide-react";
import { isExpired, parseShare, shareRequest, originalDownload } from "./westlake";
import PersonFinder from "./PersonFinder";
import { photoLabel } from "./upload";
import Uploader from "./Uploader";
import AlbumEditor from "./AlbumEditor";
import PhotoRemovalDialog from "./PhotoRemovalDialog";
import BatchDownload from "./BatchDownload";
import { loadLibrary, albumFiles, assignPhotos } from "./albums.js";
import "./shared.css";

function Thumb({ file, session, onReady, hidden, selectable, selected, onSelect, selectionDisabled, onRemove, recycled }) {
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
    setUrl(""); setError("");
    const abort = new AbortController();
    shareRequest(session.link, session.password, "thumbnail", { docid: file.docid, rev: file.rev, height: 900, width: 1200, quality: 85 }, abort.signal)
      .then(blob => {
        if (abort.signal.aborted) return;
        objectURL = URL.createObjectURL(blob); setUrl(objectURL); onReady(file.docid, objectURL);
      }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => { abort.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [file.docid, file.rev, session]);
  return <div className="photo" hidden={hidden}><div className="photo-image">{selectable && <label className="photo-select"><input type="checkbox" aria-label={`选择照片 ${label.originalName}`} checked={selected} disabled={selectionDisabled} onChange={onSelect} /></label>}{url ? <img src={url} alt={label.originalName} /> : <span>{error || "正在读取照片…"}</span>}</div>{label.date && <div className="photo-label">{label.date}{label.activity && ` · ${label.activity}`}</div>}<p title={file.name}>{label.originalName}</p><div className="photo-actions"><span>{(file.size / 1024 / 1024).toFixed(1)} MB · 原图</span><button aria-label={`下载原图 ${file.name}`} disabled={downloading} onClick={download}><Download size={15} />{downloading ? "准备下载…" : "下载原图"}</button></div>{onRemove && <div className="photo-manage"><button className={recycled ? "subtle" : "danger-subtle"} disabled={selectionDisabled} aria-label={`${recycled ? "恢复" : "删除"}照片 ${label.originalName}`} onClick={onRemove}>{recycled ? <RotateCcw size={14} /> : <Trash2 size={14} />}{recycled ? "恢复照片" : "删除照片"}</button></div>}{downloadError && <p className="download-error" role="alert">{downloadError}</p>}</div>;
}

function SharedArchive() {
  const [view, setView] = useState(location.hash === "#/upload" ? "upload" : "gallery");
  const [albums, setAlbums] = useState([]);
  const [sources, setSources] = useState([]);
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [editor, setEditor] = useState(null);
  const [uploadAlbumId, setUploadAlbumId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [moveTarget, setMoveTarget] = useState("");
  const [moving, setMoving] = useState(false);
  const [recycled, setRecycled] = useState(false);
  const [removal, setRemoval] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState("");
  const mutation = useRef(false);
  const [configError, setConfigError] = useState("");
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState("");
  const [month, setMonth] = useState("");
  const [album, setAlbum] = useState(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [session, setSession] = useState(null);
  useLayoutEffect(() => {
    if (!album) return;
    const top = () => window.scrollTo({ top: 0, behavior: "instant" });
    // Reset both when opening the album and after its async connection renders
    // the photo grid. Prevent the previous page's footer becoming the anchor.
    top(); const frame = requestAnimationFrame(top);
    return () => cancelAnimationFrame(frame);
  }, [album?.id, session?.link]);
  const [listing, setListing] = useState({ dirs: [], files: [] });
  const [trail, setTrail] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [matchedPhotos, setMatchedPhotos] = useState(null);
  const [personName, setPersonName] = useState("");
  const [resetSelection, setResetSelection] = useState(0);
  const galleryScroll = useRef(0), finderContainer = useRef(null), personHeading = useRef(null);
  const personView = matchedPhotos !== null && !recycled;
  function showPersonPhotos(ids, name = "所选人物") {
    if (ids !== null && matchedPhotos === null) galleryScroll.current = window.scrollY;
    setMatchedPhotos(ids); setSelectedPhotos([]); setSelecting(false);
    if (ids !== null) {
      setPersonName(name);
      requestAnimationFrame(() => { window.scrollTo({ top: 0, behavior: "instant" }); personHeading.current?.focus({ preventScroll: true }); });
    }
  }
  function returnToAlbum() {
    setMatchedPhotos(null); setSelectedPhotos([]); setSelecting(false); setResetSelection(value => value + 1);
    requestAnimationFrame(() => { finderContainer.current?.focus({ preventScroll: true }); window.scrollTo({ top: galleryScroll.current, behavior: "instant" }); });
  }
  const urls = useRef(new Map());
  const generation = useRef(0);
  useEffect(() => {
    const route = () => { if (mutation.current) { history.replaceState(null, "", "#/"); return; } closeAlbum(); setView(location.hash === "#/upload" ? "upload" : "gallery"); };
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${import.meta.env.BASE_URL}albums.json`, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("相册配置读取失败"); return r.json(); })
      .then(async data => {
        if (!Array.isArray(data)) throw new Error("相册配置应为列表");
        data.forEach(a => parseShare(a.url)); setSources(data);
        const library = await loadLibrary(data, abort.signal);
        if (!abort.signal.aborted) setAlbums(library);
      }).catch(e => { if (!abort.signal.aborted) setConfigError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoadingAlbums(false); });
    return () => abort.abort();
  }, []);
  async function refreshAlbums() {
    setLoadingAlbums(true); setConfigError("");
    try {
      const library = await loadLibrary(sources);
      setAlbums(library);
      return library;
    } catch (e) { setConfigError(e.message); throw e; }
    finally { setLoadingAlbums(false); }
  }
  async function savedAlbum(nextId) {
    const library = await refreshAlbums();
    if (album) setAlbum(library.find(a => a.id === album.id) || null);
    setUploadAlbumId(nextId); setEditor(null);
  }
  async function movePhotos() {
    const target = albums.find(a => a.id === moveTarget);
    if (!target || target.sourceId !== album.sourceId) return;
    const version = generation.current;
    mutation.current = true; setMoving(true); setError("");
    try {
      await assignPhotos(sources.find(s => s.id === album.sourceId), target.albumId, selectedPhotos);
      const library = await refreshAlbums();
      if (version !== generation.current) return;
      setAlbum(library.find(a => a.id === album.id)); clearView(); setSession(s => ({ ...s }));
      setSelectedPhotos([]); setSelecting(false);
    } catch (e) { setError(e.message); }
    finally { mutation.current = false; setMoving(false); }
  }
  async function refreshGallery() {
    const version = generation.current;
    setBusy(true); setError("");
    try {
      const library = await refreshAlbums();
      const data = await shareRequest(session.link, session.password, "listdir", { docid: trail.at(-1).docid, attr: [], by: "name", sort: "asc" });
      if (version !== generation.current) return;
      setAlbum(library.find(a => a.id === album.id)); setListing(data);
      setBusy(false); clearView(); setSelectedPhotos([]);
    } catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function removedPhotos() {
    // Apply the committed record immediately. A failed refresh must never
    // report the write as failed or encourage duplicate submissions.
    const docids = removal.photos.map(p => p.docid), deleted = removal.deleted;
    const visibility = { ...album.visibility };
    docids.forEach(d => { visibility[d] = deleted; });
    const updated = { ...album, visibility };
    setAlbum(updated); clearView(); setSelectedPhotos([]); setSelecting(false); setRemoval(null);
    setNotice(deleted ? `已将 ${docids.length} 张照片移入网站回收站。` : `已恢复 ${docids.length} 张照片。`);
    const version = generation.current;
    try {
      const library = await refreshAlbums();
      if (version === generation.current) setAlbum(library.find(a => a.id === updated.id) || updated);
    } catch {
      if (version === generation.current) { setConfigError(""); setError("删除或恢复记录已保存，列表刷新失败。请点「刷新照片」重试，无需重复操作。"); }
    }
  }
  function clearView() {
    generation.current++; urls.current.clear(); setMatchedPhotos(null);
  }
  function closeAlbum() {
    clearView(); setAlbum(null); setSession(null); setPassword(""); setError(""); setListing({ dirs: [], files: [] }); setTrail([]); setBusy(false); setSelectedPhotos([]); setSelecting(false); setMoveTarget(""); setRecycled(false); setRemoval(null); setNotice("");
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
    clearView(); setSelectedPhotos([]); const version = generation.current; setBusy(true); setError("");
    try {
      const data = await shareRequest(session.link, session.password, "listdir", { docid: folder.docid, attr: [], by: "name", sort: "asc" });
      if (version !== generation.current) return;
      setListing(data); setTrail(nextTrail);
    } catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setBusy(false); }
  }
  const photos = albumFiles(listing.files, album?.albumId, album?.assignments, album?.visibility, recycled);
  const recycledPhotos = albumFiles(listing.files, album?.albumId, album?.assignments, album?.visibility, true);
  const visiblePhotos = photos.filter(p => recycled || matchedPhotos === null || matchedPhotos.includes(p.docid));
  const locked = busy || moving || removing || Boolean(removal);
  function requestRemoval(items) {
    if (!items.length || !album.canUpload || locked) return;
    setError(""); setNotice(""); setRemoval({ photos: items, deleted: !recycled });
  }
  const filtered = albums.filter(a => `${a.title} ${a.activity} ${a.description || ""}`.toLowerCase().includes(query.toLowerCase()) && (!activity || a.activity === activity) && (!month || a.date?.startsWith(month)));
  const [, setReadyCount] = useState(0);
  return <div className="shared-layout">
    <aside><a className="brand" href={import.meta.env.BASE_URL}><Camera size={26} /><span>拾光<small>跑团照片档案</small></span></a><nav className="shared-nav"><a className={view === "gallery" ? "nav-active" : "nav-link"} href="#/"><FolderOpen size={18} />共享相册</a><a className={view === "upload" ? "nav-active" : "nav-link"} href="#/upload"><Upload size={18} />上传照片</a></nav><div className="sidebar-note"><span className="status-dot" />原图存于学校网盘<p>把每一次出发，<br />留在共同的记忆里。</p></div></aside>
    <main className={album ? "album-page" : undefined}><header><span>WESTLAKE RUNNING CLUB</span><span className="pill">学校网盘 · 在线读取</span></header>
      {configError && <p role="alert" className="error">{configError}</p>}
      {editor && <AlbumEditor key={editor.album?.id || "new"} sources={sources} album={editor.album} onClose={() => setEditor(null)} onSaved={savedAlbum} />}
      {removal && <PhotoRemovalDialog source={sources.find(s => s.id === album.sourceId)} photos={removal.photos} deleted={removal.deleted} onClose={() => setRemoval(null)} onBusy={value => { mutation.current = value; setRemoving(value); }} onSaved={removedPhotos} />}
      {view === "upload" ? <Uploader albums={albums} selectedAlbumId={uploadAlbumId} onCreate={() => setEditor({})} onRename={a => setEditor({ album: a })} onOpen={(a, s, data, path) => {
        clearView(); history.replaceState(null, "", "#/"); setView("gallery"); setAlbum(a); setSession(s); setListing(data); setTrail(path);
      }} /> : !album ? <>
        <div className="intro"><div><span className="eyebrow">OUR SHARED MEMORIES</span><h1>一起跑过的时光<span>。</span></h1><p>按活动与日期寻找照片，打开相册，重温每一次出发。</p></div><div className="album-total"><strong>{albums.length.toString().padStart(2, "0")}</strong><span>共享相册</span></div></div>
        <div className="library-actions"><button disabled={!sources.length || loadingAlbums} onClick={() => setEditor({})}>＋ 新建相册</button><button className="subtle" disabled={loadingAlbums} onClick={() => refreshAlbums().catch(() => {})}>{loadingAlbums ? "读取中…" : "刷新相册"}</button><span>最新创建的相册在最前面</span></div>
        <div className="filters"><label className="search"><Search size={18} /><input aria-label="搜索相册" placeholder="搜索活动、相册…" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="活动筛选" value={activity} onChange={e => setActivity(e.target.value)}><option value="">全部活动</option>{[...new Set(albums.map(a => a.activity))].map(a => <option key={a}>{a}</option>)}</select><input aria-label="月份筛选" type="month" value={month} onChange={e => setMonth(e.target.value)} /><button className="subtle" onClick={() => { setQuery(""); setActivity(""); setMonth(""); }}>重置</button></div>
        <div className="album-grid">{filtered.map((a, i) => <article key={a.id} className="album-card"><div className="album-art"><span className="art-ring" /><Camera size={54} strokeWidth={1} /><span className="art-number">{String(i + 1).padStart(2, "0")}</span><span className="art-label">RUN / REMEMBER / REPEAT</span></div><div className="album-content"><span className="activity">{a.photoCount ?? "—"} 张照片</span><h2>{a.title}</h2><p>{a.description}</p><div className="meta"><CalendarDays size={15} />{a.date || "拍摄日期待标记"}</div><div className="card-bottom"><small>{isExpired(a) ? "分享已到期" : a.expiresAt ? `有效至 ${new Date(a.expiresAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "以网盘分享设置为准"}</small><div className="card-buttons"><button className="subtle" disabled={isExpired(a) || !a.canUpload} aria-label={`重命名相册 ${a.title}`} onClick={() => setEditor({ album: a })}>改名</button><button disabled={isExpired(a)} onClick={() => { clearView(); setReadyCount(0); setAlbum(a); }}>浏览相册 <ArrowUpRight size={17} /></button></div></div></div></article>)}</div>
        {!configError && !loadingAlbums && filtered.length === 0 && <div className="empty">没有符合条件的相册。</div>}
      </> : <>
        {personView ? <><button className="back" onClick={returnToAlbum}><ArrowLeft size={17} />返回相册</button><div className="album-heading"><div><span className="eyebrow">{album.title}</span><h1 ref={personHeading} tabIndex={-1}>{personName}的照片</h1><p>{visiblePhotos.length} 张照片</p></div></div></> : <>
        <button className="back" disabled={locked} onClick={() => { closeAlbum(); refreshAlbums().catch(() => {}); }}><ArrowLeft size={17} />全部相册</button><div className="album-heading"><div><span className="eyebrow">{album.activity}</span><h1>{album.title}{recycled && " · 回收站"}</h1><p>{album.date || "拍摄日期待标记"}</p></div><a className="external" href={album.url} target="_blank" rel="noopener noreferrer">在网盘中打开 <ArrowUpRight size={17} /></a></div>
        </>}
        {!session ? <form className="unlock" onSubmit={unlock}><FolderOpen size={28} /><h2>{needsPassword ? "更新相册连接" : "连接学校网盘"}</h2><p>无需填写密码，自动打开共享照片。</p>{needsPassword && <label>分享密码<input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} autoFocus placeholder="输入更新后的分享密码" /></label>}<button disabled={busy}>{busy ? "正在连接学校网盘…" : "打开照片"}</button></form> : <>
          <div className="gallery-toolbar" hidden={personView}><div className="breadcrumbs">{trail.map((folder, i) => <button key={folder.docid} disabled={locked || i === trail.length - 1} onClick={() => navigate(folder, trail.slice(0, i + 1))}>{folder.name}{i < trail.length - 1 ? " /" : ""}</button>)}</div><span>{visiblePhotos.length} 张照片</span><button className="subtle" disabled={locked} onClick={() => { setSelecting(!selecting); setSelectedPhotos([]); }}>{selecting ? "取消多选" : "多选"}</button><button className="subtle" disabled={locked} onClick={() => { clearView(); setRecycled(!recycled); setSelectedPhotos([]); setSelecting(false); setNotice(""); }}>{recycled ? "返回照片" : `回收站（${recycledPhotos.length}）`}</button><button className="subtle" disabled={locked} onClick={refreshGallery}>刷新照片</button><button className="subtle" disabled={locked} onClick={() => { clearView(); setReadyCount(0); setSelectedPhotos([]); setSelecting(false); setSession(null); setListing({ dirs: [], files: [] }); }}><X size={16} />断开连接</button></div>
          {!personView && notice && <p className="upload-result" role="status">{notice}</p>}
          {recycled && <p className="upload-help">回收站保留网盘原图，可恢复到原相册。要彻底删除并释放空间，请由网盘所有者登录学校网盘处理。</p>}
          {personView && <div className="gallery-toolbar"><button className="subtle" onClick={() => { setSelecting(!selecting); setSelectedPhotos([]); }}>{selecting ? "取消多选" : "多选"}</button></div>}
          {selecting && <div className="photo-assignment"><span>已选 {selectedPhotos.length} 张</span><button className="subtle" disabled={locked} onClick={() => setSelectedPhotos(visiblePhotos.slice(0, 100).map(p => p.docid))}>全选当前显示（最多100张）</button><button className="subtle" disabled={locked || !selectedPhotos.length} onClick={() => setSelectedPhotos([])}>清空选择</button><BatchDownload session={session} files={visiblePhotos.filter(p => selectedPhotos.includes(p.docid))} disabled={locked} /><span className="upload-help">每批最多选择 100 张照片。</span>{!personView && album.canUpload && <>{!recycled && <><select aria-label="照片分类目标相册" value={moveTarget} disabled={locked} onChange={e => setMoveTarget(e.target.value)}><option value="">选择目标相册</option>{albums.filter(a => a.sourceId === album.sourceId && a.id !== album.id).map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select><button disabled={locked || !moveTarget || !selectedPhotos.length || !album.canUpload} onClick={movePhotos}>{moving ? "保存分类中…" : "移入相册"}</button></>}<button className={recycled ? "" : "danger"} disabled={locked || !selectedPhotos.length || !album.canUpload} onClick={() => requestRemoval(visiblePhotos.filter(p => selectedPhotos.includes(p.docid)))}>{recycled ? "恢复所选" : "删除所选"}（{selectedPhotos.length}）</button></>}</div>}
          <div ref={finderContainer} tabIndex={-1} hidden={personView}>{!recycled && <PersonFinder key={`${album.id}|${trail.at(-1)?.docid}`} session={session} album={album} photos={photos} onFilter={showPersonPhotos} resetSelection={resetSelection} />}</div>
          {busy ? <p>正在读取文件夹…</p> : <><div className="folders" hidden={personView}>{listing.dirs.map(d => <button key={d.docid} disabled={locked} onClick={() => navigate(d, [...trail, d])}><FolderOpen size={20} />{d.name}</button>)}</div><div className="photo-grid">{photos.map(file => <Thumb key={file.docid} file={file} session={session} selectable={selecting} selectionDisabled={locked} selected={selectedPhotos.includes(file.docid)} onSelect={() => setSelectedPhotos(items => items.includes(file.docid) ? items.filter(i => i !== file.docid) : items.length < 100 ? [...items, file.docid] : items)} onRemove={!personView && album.canUpload ? () => requestRemoval([file]) : undefined} recycled={recycled} hidden={!recycled && matchedPhotos !== null && !matchedPhotos.includes(file.docid)} onReady={(id, url) => { urls.current.set(id, url); setReadyCount(n => n + 1); }} />)}</div>{visiblePhotos.length === 0 && <div className="empty">{personView ? "没有匹配到照片，请返回相册重新选择。" : recycled ? "回收站为空。" : "这个相册还没有照片，去上传页选择此相册即可添加。"}</div>}</>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </>}
      <footer>拾光 · 每一步，都值得被记住。<span>照片读取遵循网盘分享权限与有效期</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById("root")).render(<SharedArchive />);
