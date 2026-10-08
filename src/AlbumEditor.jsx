import React, { useRef, useState, useEffect } from "react";
import { Plus, Pencil, X } from "lucide-react";
import { saveAlbum } from "./albums.js";
import { todayShanghai } from "./upload.js";
import { isExpired } from "./westlake.js";

export default function AlbumEditor({ sources, album, onClose, onSaved }) {
  const [sourceId, setSourceId] = useState(album?.sourceId || sources[0]?.id || "");
  const [title, setTitle] = useState(album?.title || "");
  const [date, setDate] = useState(album?.date ?? todayShanghai());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState("");
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function save(e) {
    e.preventDefault(); setBusy(true); setError("");
    abort.current = new AbortController();
    let persisted = Boolean(savedId);
    try {
      const nextId = savedId || await saveAlbum(sources.find(s => s.id === sourceId), title, date, album, { signal: abort.current.signal });
      setSavedId(nextId);
      persisted = true;
      await onSaved(nextId);
    } catch (e) { if (!abort.current.signal.aborted) setError(persisted ? "相册已保存，列表刷新失败。请重试刷新。" : e.message); }
    finally { setBusy(false); }
  }
  return <div className="album-editor-backdrop"><section className="album-editor" role="dialog" aria-modal="true" aria-labelledby="album-editor-title">
    <div className="editor-heading"><h2 id="album-editor-title">{album ? <Pencil size={20} /> : <Plus size={20} />}{album ? "重命名相册" : "新建活动相册"}</h2><button className="subtle" aria-label="关闭相册编辑" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={save}>
      {sources.length > 1 && !album && <label>存储位置<select value={sourceId} disabled={busy || Boolean(savedId)} onChange={e => setSourceId(e.target.value)}>{sources.map(s => <option key={s.id} value={s.id} disabled={isExpired(s)}>{s.title}</option>)}</select></label>}
      <label>相册名称<input autoFocus required maxLength={80} value={title} disabled={busy || Boolean(savedId)} onChange={e => setTitle(e.target.value)} placeholder="例如：周四夜跑、十月团建" /></label>
      <label>活动日期<input type="date" value={date} disabled={busy || Boolean(savedId)} onChange={e => setDate(e.target.value)} /></label>
      <p className="upload-help">{album ? "改名后照片仍保留在这个相册。" : "每次活动建一个相册，创建后即可选择它上传照片。"}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="editor-actions"><button disabled={busy || !sourceId}>{busy ? "保存中…" : savedId ? "重试刷新相册" : album ? "保存名称" : "创建相册"}</button><button type="button" className="subtle" disabled={busy} onClick={onClose}>取消</button></div>
    </form>
  </section></div>;
}
