import React, { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { downloadPhotos } from "./batch-download.js";
import { normalizeImageBlob } from "./image-input.js";

export default function BatchDownload({ session, files, disabled }) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null), [sharing, setSharing] = useState(false);
  const operation = useRef(null), downloadUrl = useRef(null);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const canChooseFolder = !mobile && typeof window.showDirectoryPicker === "function";
  useEffect(() => () => { operation.current?.abort(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  async function download() {
    const abort = new AbortController(); operation.current = abort;
    setBusy(true); setStatus(canChooseFolder ? "请选择保存文件夹…" : "准备逐张下载原图…"); setError("");
    try {
      // The picker must run directly from the user's click, before network work.
      const directory = canChooseFolder ? await window.showDirectoryPicker({ mode: "readwrite", id: "running-photo-downloads" }) : null;
      const result = await downloadPhotos(session, files, { directory, signal: abort.signal,
        onProgress: p => { if (!abort.signal.aborted) setStatus("正在下载 " + (p.completed + p.failed + 1) + "/" + p.total + " 张 · " + p.name); },
        saveBlob: async (blob, name) => {
          if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
          if (mobile) {
            const image = await normalizeImageBlob(blob);
            const file = new File([image], name, { type: image.type });
            const shareable = Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
            const preview = shareable ? null : URL.createObjectURL(file); downloadUrl.current = preview;
            await new Promise((resolve, reject) => {
              const stop = () => { setPendingPhoto(null); reject(new DOMException("下载已取消", "AbortError")); };
              if (abort.signal.aborted) { stop(); return; }
              abort.signal.addEventListener("abort", stop, { once: true });
              setPendingPhoto({ file, shareable, preview, done: () => { if (operation.current !== abort || abort.signal.aborted) return; abort.signal.removeEventListener("abort", stop); setPendingPhoto(null); resolve(); } });
            });
            return;
          }
          const url = URL.createObjectURL(blob); downloadUrl.current = url;
          const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
          document.body.appendChild(anchor); anchor.click(); anchor.remove();
          // Give the browser time to accept this file before releasing its URL.
          await new Promise(resolve => setTimeout(resolve, 500));
        },
      });
      if (abort.signal.aborted) return;
      setStatus(directory ? "已将 " + result.completed + " 张原图保存到「" + directory.name + "」。" : mobile ? "已逐张处理 " + result.completed + " 张图片，请在手机相册中确认保存结果。" : "已逐张发起 " + result.completed + " 个文件下载，请查看浏览器下载列表；如有提示，请允许下载多个文件。");
      if (result.failed.length) setError(result.failed.length + " 张失败：" + result.failed.map(f => f.name + "（" + f.error + "）").join("；"));
    } catch (e) {
      if (operation.current !== abort) return;
      if (abort.signal.aborted || e.name === "AbortError") setStatus("下载已取消，已完成的文件保留。" );
      else { setStatus(""); setError(e.message); }
    } finally { if (operation.current === abort) { operation.current = null; setBusy(false); } }
  }
  async function saveMobilePhoto() {
    const photo = pendingPhoto; setSharing(true); setError("");
    try { await navigator.share({ files: [photo.file] }); photo.done(); }
    catch (e) { if (e.name !== "AbortError") setError("系统保存菜单未打开，可重试，或改用系统浏览器打开网站。"); }
    finally { setSharing(false); }
  }
  return <div className="batch-download">
    <button disabled={disabled || busy || !files.length} onClick={download}><Download size={16} />下载所选（{files.length} 张）</button>
    {busy && <button className="subtle" onClick={() => operation.current?.abort()}><X size={16} />取消下载</button>}
    {status && <span role="status">{status}</span>}{error && <span className="error" role="alert">{error}</span>}
    <span>{mobile ? "图片逐张处理：在系统菜单中选择「存储图像」或「保存图片」；可用选项由手机系统决定。" : canChooseFolder ? "点击下载后选择保存文件夹，原图逐张保存；同名文件自动改名。" : "原图逐张下载；保存位置由浏览器决定。可在浏览器设置中开启下载前询问保存位置。"}</span>
    {pendingPhoto && <div className="mobile-photo-save"><strong>{pendingPhoto.file.name}</strong>{pendingPhoto.shareable ? <button disabled={sharing} onClick={saveMobilePhoto}>保存这张到相册</button> : <><p>长按下方图片，选择保存图片；保存后继续下一张。</p><img src={pendingPhoto.preview} alt={pendingPhoto.file.name} /><button onClick={pendingPhoto.done}>继续下一张</button></>}</div>}
  </div>;
}
