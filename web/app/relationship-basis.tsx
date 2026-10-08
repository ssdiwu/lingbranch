import { X } from "lucide-react";
import { aggregationBasis, sharedTagPeers } from "../../shared/relationship-layout.mjs";

type Node={id:string;title:string;tags:string[]};
type Link={fromId:string;toId:string};
export default function RelationshipBasis({ideas,connections,selectedId,highlightTag,onHighlight,onClose}:{ideas:Node[];connections:Link[];selectedId:string|null;highlightTag:string;onHighlight:(tag:string)=>void;onClose:()=>void}){
 const basis=aggregationBasis(ideas,connections),selected=ideas.find(n=>n.id===selectedId);
 const hints=sharedTagPeers(selectedId,ideas,connections,highlightTag);
 const peers=selected?basis.connections.filter(l=>l.fromId===selected.id||l.toId===selected.id).map(l=>ideas.find(n=>n.id===(l.fromId===selected.id?l.toId:l.fromId))!):[];
 return <aside id="atlas-basis" className="atlas-basis" aria-label="聚合依据" onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();onClose();}}}>
  <div className="atlas-basis-heading"><strong>聚合依据</strong><button aria-label="关闭聚合依据" onClick={onClose}><X size={16}/></button></div>
  <p><strong>已有连线：{basis.connections.length} 条</strong>，整理时优先拉近。共享标签辅助靠近；没有分析正文语义。</p>
  <p className="atlas-basis-note">当前坐标也可能含手工调整。标签成员是当前资料，不是上次整理的历史记录。</p>
  {selected&&<section className="atlas-basis-selected"><h3>{selected.title}</h3><p>已有标签：{selected.tags.length?selected.tags.join("、"):"无标签"}</p><p>直接关联：{peers.length} 条</p>{peers.length>0&&<ul>{peers.map(n=><li key={n.id}>{n.title}</li>)}</ul>}<p>同标签提示：{hints.length} 个（虚线，未保存为关联）</p>{hints.length>0&&<ul>{hints.map(hint=><li key={hint.toId}>{ideas.find(n=>n.id===hint.toId)!.title}：{hint.tags.join("、")}</li>)}</ul>}</section>}
  <div className="atlas-basis-caption"><span>当前集合的标签成员</span>{highlightTag&&<button onClick={()=>onHighlight("")}>清除高亮</button>}</div>
  <p className="atlas-basis-note">点击标签核对全部成员，仅高亮，不移动位置或保存关联。多标签灵感可以出现在多组。</p>
  <div className="atlas-basis-tags">{basis.tags.map(t=><button key={t.tag} aria-label={`高亮标签成员：${t.tag}`} aria-pressed={highlightTag===t.tag} onClick={()=>onHighlight(highlightTag===t.tag?"":t.tag)}><span>{t.tag}</span><span>{t.count} / {basis.nodeCount}</span></button>)}</div>
  {basis.untaggedCount>0&&<p className="atlas-basis-note">无标签 {basis.untaggedCount} 条，不参与标签聚合。</p>}
 </aside>;
}
