import React from "react";

export default function ReferencePeople({match,onChoose,disabled}){
  if(!match)return null;
  return <section className="reference-matches" aria-label="参照照片匹配的人物类别">
    <h3>{match.candidates.length?"匹配到的已有人物":"暂未匹配到已有人物"}</h3>
    <p className="upload-help">{match.candidates.length?"选择人物后查看该类别的全部照片，包括已归入的侧脸、低质量人脸和人工确认照片。此操作不会修改人物分类。":"请换一张清晰参照照片，或在下方人物列表中选择。尚未归类的照片需要先确认归属，不会自动混入查找结果。"}</p>
    <div className="reference-group-cards">{match.candidates.map(group=><button key={group.id} className="candidate-person" disabled={disabled} onClick={()=>onChoose(group)}>
      <img src={group.avatar} alt="人物代表人脸"/><span>{group.name}<small>{group.manual?"已确认人物":"自动分类人物"} · 全部 {group.photos.length} 张照片</small><small>查看该人物全部照片</small></span>
    </button>)}</div>
  </section>;
}
