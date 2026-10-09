import React, { useState } from "react";
import { assertNoPhotoConflict } from "./people.js";
import { photoLabel } from "./upload.js";

export default function PeoplePanel({ model, faces, disabled, canEdit, onFilter, onSave }) {
  const [edit, setEdit] = useState(null), [error, setError] = useState("");
  function open(items, target = "new", name = "") {
    setEdit({ faces: items, selected: items.map(f => f.key), target, name }); setError("");
  }
  async function save() {
    setError("");
    try {
      const selected = edit.faces.filter(f => edit.selected.includes(f.key));
      if (!selected.length) throw new Error("请至少选择一张人脸");
      if (selected.some(f => !faces.some(current => current.key === f.key))) throw new Error("检测结果已更新，请关闭调整后重新选择人脸");
      let change;
      if (["ignore", "reset"].includes(edit.target)) change = { action: edit.target, faceKeys: selected.map(f => f.key) };
      else {
        const target = model.groups.find(g => g.id === edit.target);
        const members = [...new Map([...(target?.faces.filter(f => !target.manual || !f.suggested) || []), ...selected].map(f => [f.key, f])).values()];
        assertNoPhotoConflict(members);
        change = { action: "assign", faceKeys: members.map(f => f.key), personId: target?.manual ? target.id : crypto.randomUUID().replaceAll("-", ""), name: edit.name.trim() || target?.name || "已确认人物" };
      }
      if (await onSave(change)) setEdit(null);
    } catch (e) { setError(e.message); }
  }
  const unresolved = [...model.conflicts, ...model.unrecognized];
  return <div className="people-review">
    <p className="upload-help">先把同一个人的正脸、侧脸确认到同一人物；系统会用这些样本匹配其他照片。自动归入仅为建议，确认后才成为新样本。滑条不会拆散已确认的人脸。拆分时只勾选分错的人脸，再选择「新建独立人物」。</p>
    {edit && <section className="person-edit" aria-label="人工调整人物归属">
      <div className="finder-heading"><h3>人工调整 · 已选 {edit.selected.length} 张人脸</h3><button className="subtle" disabled={disabled} onClick={() => setEdit(null)}>关闭调整</button></div>
      <div className="review-faces">{edit.faces.map(face => <label key={face.key}><input type="checkbox" aria-label={`选择人脸 ${photoLabel(face.photoName).originalName}`} checked={edit.selected.includes(face.key)} disabled={disabled} onChange={e => setEdit(v => ({ ...v, selected: e.target.checked ? [...v.selected, face.key] : v.selected.filter(k => k !== face.key) }))} /><img src={face.avatar} alt="待调整人脸" /><span>{face.suggested && "自动归入 · "}{photoLabel(face.photoName).originalName}</span></label>)}</div>
      <div className="review-fields"><label>处理方式<select aria-label="人脸处理方式" value={edit.target} disabled={disabled} onChange={e => { const target = model.groups.find(g => g.id === e.target.value); setEdit(v => ({ ...v, target: e.target.value, name: target?.name || "" })); }}><option value="new">新建独立人物（用于拆分）</option>{model.groups.map(g => <option key={g.id} value={g.id}>归入 {g.name} · {g.faces.length} 张脸{g.manual ? " · 已确认" : ""}</option>)}<option value="ignore">忽略所选人脸</option><option value="reset">取消人工归属，重新自动分组</option></select></label>{!["ignore", "reset"].includes(edit.target) && <label>人物名称<input aria-label="人物名称" maxLength={60} disabled={disabled} value={edit.name} onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} placeholder="可填昵称，不填则使用默认名称" /></label>}</div>
      <p className="upload-help">保存会同步到当前相册，其他跑友刷新后可见。任何有上传权限的访问者均可修改；忽略和人工归属都可撤销。</p>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={disabled || !canEdit || !edit.selected.length} onClick={save}>保存并同步</button>
    </section>}
    <div className="person-cards">{model.groups.filter(g => g.manual || g.faces.length > 1).map(g => <article key={g.id} className="person-card"><img src={g.avatar} alt="人物代表人脸" /><div><strong>{g.name}</strong><p>{g.photos.length} 张照片 · {g.faces.length} 张脸 · {g.manual ? `${g.confirmedCount} 张已确认 · ${g.suggestedCount} 张自动归入` : "自动建议"}</p><div className="finder-actions"><button className="subtle" disabled={disabled} onClick={() => onFilter(g.photos, g.name)}>查看照片</button><button disabled={disabled || !canEdit} onClick={() => open(g.faces, g.id, g.name)}>确认 / 改名 / 合并</button></div></div></article>)}</div>
    <details className="face-review-section"><summary>待确认 · {model.pending.length} 张人脸</summary><p className="upload-help">单独成组、分数不足或归属不明确的人脸列在这里。候选分数是相似度，不是正确率；不会把低分候选直接当成同一个人。</p><div className="pending-faces">{model.pending.map(face => <article key={face.key}><img src={face.avatar} alt="待确认人脸" /><div><strong>{face.groupName} · {photoLabel(face.photoName).originalName}</strong>{face.reason && <p>{face.reason}</p>}{face.candidates.length ? face.candidates.map(c => <button className="candidate-person" key={c.id} disabled={disabled || !canEdit} onClick={() => open([face], c.id, c.name)}><img src={c.avatar} alt="候选人脸" /><span>{c.name}<small>最近样本 {c.support.toFixed(2)} / 最相似 {c.peak.toFixed(2)}</small></span></button>) : <p>暂无合适候选，可确认为独立人物。</p>}<div className="finder-actions"><button className="subtle" disabled={disabled} onClick={() => onFilter([face.photoId], face.groupName || "所选人脸")}>查看照片</button><button disabled={disabled || !canEdit} onClick={() => open([face])}>调整归属</button></div></div></article>)}</div></details>
    <details className="face-review-section"><summary>未自动识别 / 归属冲突 · {unresolved.length} 张人脸</summary><div className="pending-faces">{unresolved.map(face => <article key={face.key}><img src={face.avatar} alt="未自动归类人脸" /><div><strong>{photoLabel(face.photoName).originalName}</strong><p>{face.reason}</p><div className="finder-actions"><button className="subtle" disabled={disabled} onClick={() => onFilter([face.photoId], "所选人脸")}>查看照片</button><button disabled={disabled || !canEdit} onClick={() => open([face])}>手动归类</button></div></div></article>)}</div></details>
    <details className="face-review-section"><summary>已忽略 · {model.ignored.length} 张人脸</summary><div className="pending-faces">{model.ignored.map(face => <article key={face.key}><img src={face.avatar} alt="已忽略人脸" /><div><p>{photoLabel(face.photoName).originalName}</p><button disabled={disabled || !canEdit} onClick={() => open([face], "reset")}>恢复 / 调整</button></div></article>)}</div></details>
    {!faces.length && <p className="face-status">当前没有已保存的人脸，请检查下方逐张照片的检测状态。</p>}
  </div>;
}
