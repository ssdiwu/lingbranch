
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { TagChange, TagSummary } from "@/lib/idea-store";
import { canonicalInspirationTag, inspirationTagHint } from "@/lib/inspiration-tags";

type Props={open:boolean;onOpenChange:(open:boolean)=>void;onFilter:(tag:string)=>void;onChanged:(fromTag:string,toTag?:string)=>Promise<void>};
type Action={tag:TagSummary;mode:"rename"|"remove"};

async function request<T>(init?:RequestInit):Promise<T> {
  const response=await fetch("/api/tags",{cache:"no-store",...init,headers:{...init?.headers,"X-LingBranch-Request":"1"}});
  const value=await response.json() as T&{error?:string};
  if(!response.ok)throw new Error(value.error||"标签暂时无法读取或保存。");
  return value;
}

export default function TagManager({open,onOpenChange,onFilter,onChanged}:Props) {
  const attempt=useRef<{signature:string;key:string}|null>(null);
  const [tags,setTags]=useState<TagSummary[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [query,setQuery]=useState(""),[action,setAction]=useState<Action|null>(null),[newName,setNewName]=useState("");
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  useEffect(()=>{
    if(!open)return;
    let current=true;
    void request<{tags:TagSummary[]}>().then(value=>{if(current)setTags(value.tags);}).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:"无法读取标签。");}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[open]);
  const begin=(tag:TagSummary,mode:Action["mode"])=>{setAction({tag,mode});setNewName(tag.name);setError("");setNotice("");};
  const apply=async()=>{
    if(!action)return;
    const target=action.mode==="rename"?canonicalInspirationTag(newName):undefined;
    if(target!==undefined&&!target)return setError("请填写新的标签名。");
    setSaving(true);setError("");
    try {
      const payload=target===undefined?{tag:action.tag.name}:{fromTag:action.tag.name,toTag:target};
      const signature=JSON.stringify(payload);if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};
      const result=await request<TagChange&{tags:TagSummary[]}>({method:action.mode==="rename"?"PATCH":"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,idempotencyKey:attempt.current.key})});
      setTags(result.tags);setAction(null);attempt.current=null;
      setNotice(result.affectedCount?`已${target===undefined?"移除":"更新"}标签，涉及 ${result.affectedCount} 条灵感。`:"标签已是这个状态，无需修改。");
      await onChanged(action.tag.name,target);
    }catch(reason){setError(reason instanceof Error?reason.message:"保存标签失败。");}finally{setSaving(false);}
  };
  const filtered=tags.filter(tag=>tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const targetName=canonicalInspirationTag(newName);
  const merging=action?.mode==="rename"&&targetName!==action.tag.name&&tags.some(tag=>tag.name===targetName);
  return <Dialog open={open} onOpenChange={value=>{if(!saving)onOpenChange(value);}}><DialogContent className="atlas-dialog atlas-tag-manager"><DialogHeader><DialogTitle>管理标签</DialogTitle><DialogDescription>数量包含画布和归档里的灵感。重命名与移除会作用于这个标签的所有灵感。</DialogDescription></DialogHeader>
    <Input value={query} onChange={event=>setQuery(event.target.value)} placeholder="查找标签" aria-label="查找标签"/>
    {(error||notice)&&<p role="status" className={error?"atlas-tag-error":"atlas-tag-notice"}>{error||notice}</p>}
    {action&&<div className="atlas-tag-action"><strong>{action.mode==="remove"?"移除标签":"重命名标签"} · {action.tag.name}</strong>
      {action.mode==="rename"&&<label>新标签名<Input maxLength={40} value={newName} disabled={saving} onChange={event=>setNewName(event.target.value)}/><span className="atlas-field-hint">{inspirationTagHint}</span></label>}
      <p>{action.mode==="remove"?`将从 ${action.tag.count} 条灵感中移除这个标签，保留灵感和附件。`:merging?`合并到已有标签“${targetName}”，每条灵感只保留一个同名标签。`:`将更新 ${action.tag.count} 条灵感中的标签名。`}</p>
      <div><Button variant="outline" disabled={saving} onClick={()=>setAction(null)}>取消</Button><Button variant={action.mode==="remove"?"destructive":"default"} disabled={saving||(action.mode==="rename"&&(!targetName||targetName===action.tag.name))} onClick={()=>void apply()}>{saving?"正在保存…":action.mode==="remove"?"确认移除标签":merging?"确认合并":"保存标签名"}</Button></div>
    </div>}
    <div className="atlas-tag-list" aria-label="标签列表">{loading?<p>正在读取标签…</p>:filtered.length===0?<p>{tags.length?"没有找到匹配的标签。":"还没有标签。在灵感的编辑窗口添加第一个标签。"}</p>:filtered.map(tag=><div className="atlas-tag-row" key={tag.name}><button disabled={saving} className="atlas-tag-filter" onClick={()=>{onFilter(tag.name);onOpenChange(false);}} title={`筛选标签：${tag.name}`}><strong>{tag.name}</strong><span>{tag.count} 条 · 画布 {tag.activeCount} · 归档 {tag.archivedCount}</span></button><div className="atlas-tag-row-actions"><Button variant="ghost" size="sm" disabled={saving} onClick={()=>begin(tag,"rename")}>重命名</Button><Button variant="ghost" size="sm" disabled={saving} onClick={()=>begin(tag,"remove")}>移除</Button></div></div>)}</div>
    <p className="atlas-tag-help">点击标签查看灵感；新标签可在灵感编辑窗口添加。名称区分大小写，同名标签合并时自动去重。</p>
  </DialogContent></Dialog>;
}
