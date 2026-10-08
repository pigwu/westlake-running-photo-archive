import React, { useEffect, useRef, useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import { setPhotosDeleted } from "./albums.js";
import { photoLabel } from "./upload.js";

export default function PhotoRemovalDialog({ source, photos, deleted, onClose, onBusy, onSaved }) {
  const dialog = useRef(null), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  async function save() {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusy(true); setError("");
    try {
      await setPhotosDeleted(source, photos.map(p => p.docid), deleted);
      await onSaved();
    } catch (e) { setError(e.message); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }
  return <dialog ref={dialog} className="album-editor photo-removal" aria-labelledby="photo-removal-title" onCancel={e => { e.preventDefault(); if (!pending.current) onClose(); }}>
    <div className="editor-heading"><h2 id="photo-removal-title">{deleted ? <Trash2 size={20} /> : <RotateCcw size={20} />}{deleted ? "删除照片" : "恢复照片"}</h2></div>
    <p>{deleted ? `将这 ${photos.length} 张照片移入网站回收站？` : `将这 ${photos.length} 张照片恢复到原相册？`}</p>
    <ul className="removal-preview">{photos.slice(0, 5).map(p => <li key={p.docid}>{photoLabel(p.name).originalName}</li>)}{photos.length > 5 && <li>另有 {photos.length - 5} 张照片</li>}</ul>
    <p className="upload-help">{deleted ? "所有跑友刷新后都将看不到这些照片，可在本相册的回收站恢复。网盘原图和人脸索引保留，不释放网盘空间。" : "恢复后，所有跑友刷新即可重新浏览和下载，已有的人脸索引可继续使用。"}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="editor-actions"><button className="subtle" autoFocus disabled={busy} onClick={onClose}>取消</button><button className={deleted ? "danger" : ""} disabled={busy} onClick={save}>{busy ? "保存中…" : deleted ? "确认删除" : "确认恢复"}</button></div>
  </dialog>;
}
