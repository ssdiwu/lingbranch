import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {RELATION_TYPES,relationLabel,type Connection,type RelationType} from '../../shared/connection-model.mjs';
export type ConnectionSave={connectionId?:string;expectedUpdatedAt?:string;idempotencyKey:string;relationType:RelationType;reason:string};
type Props={fromTitle:string;toTitle:string;connection:Connection|null;currentConnection:Connection|null;onSave:(input:ConnectionSave)=>Promise<Connection>;onRead:()=>Promise<Connection|null>;onClose:()=>void;onEditing:(editing:boolean)=>void};
export default function ConnectionPanel({fromTitle,toTitle,connection,currentConnection,onSave,onRead,onClose,onEditing}:Props){
 const [base,setBase]=useState(connection),[kind,setKind]=useState<RelationType>(connection?.relationType??'related'),[reason,setReason]=useState(connection?.reason??'');
 const [editing,setEditing]=useState(!connection),[busy,setBusy]=useState(false),[error,setError]=useState(''),[latest,setLatest]=useState<Connection|null>(null),[notice,setNotice]=useState('');
 const pending=useRef<ConnectionSave|null>(null),heading=useRef<HTMLHeadingElement>(null);
 const [unavailable,setUnavailable]=useState(false);
 const removed=unavailable||Boolean(base&&(!currentConnection||currentConnection.id!==base.id));
 useEffect(()=>{heading.current?.focus();},[]);
 useEffect(()=>{onEditing(editing||busy||Boolean(pending.current));return()=>onEditing(false);},[editing,busy,error,onEditing]);
 // 当前读回用于只读展示；编辑基线和结果待确认的请求不随刷新改写。
 useEffect(()=>{if(editing||busy||pending.current||!currentConnection||base?.id!==currentConnection.id)return;setBase(currentConnection);setKind(currentConnection.relationType);setReason(currentConnection.reason);},[currentConnection,editing,busy,base?.id]);
 const adopt=(value:Connection)=>{setBase(value);setKind(value.relationType);setReason(value.reason);setLatest(null);setUnavailable(false);pending.current=null;setEditing(false);setError('');setNotice('当前关系说明已读回。');};
 const save=async(version=base)=>{
  if(busy||removed&&!pending.current||!version&&!reason.trim())return;
  if(!pending.current)pending.current={...(version?{connectionId:version.id,expectedUpdatedAt:version.updatedAt}:{}),idempotencyKey:crypto.randomUUID(),relationType:kind,reason:reason.trim()};
  setBusy(true);setError('');setNotice('');
  try{adopt(await onSave(pending.current));}
  catch(value){const e=value as Error&{code?:string};if(['conflict','invalid_input','not_found'].includes(e.code??''))pending.current=null;if(e.code==='not_found')setUnavailable(true);setError(e.message||'保存结果尚待确认，请重试原操作。');}
  finally{setBusy(false);}
 };
 const readLatest=async()=>{setBusy(true);try{const value=await onRead();if(!value){setUnavailable(true);setError('关联已被移除，请关闭后读取当前画布。');return;}if(pending.current&&value.relationType===pending.current.relationType&&value.reason===pending.current.reason)adopt(value);else setLatest(value);}catch(value){setError(value instanceof Error?value.message:'无法读回关联。');}finally{setBusy(false);}};
 const close=()=>{if(busy)return;if(pending.current){setError('上次保存仍待确认，请重试原请求或读取最新说明后再关闭。');return;}onClose();};
 return <aside className="atlas-connection-panel" aria-label="关系说明" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
  <header><h3 tabIndex={-1} ref={heading}>关系说明</h3><button onClick={close} disabled={busy} aria-label="关闭关系说明"><X size={17}/></button></header>
  <p className="atlas-connection-endpoints">{fromTitle}<span>与</span>{toTitle}</p>
  {removed&&!busy&&!pending.current&&<p role="status" className="atlas-connection-removed">原关联已被移除或替换。请关闭面板，从当前画布重新选择；此处不会重建原关联。</p>}
  {!editing?<><p className="atlas-connection-type">{relationLabel(base?.relationType)}</p><p className="atlas-connection-reason">{base?.reason||'说明待补充'}</p><Button variant="outline" disabled={removed} onClick={()=>{setEditing(true);setNotice('');}}>编辑关系说明</Button></>:<form onSubmit={e=>{e.preventDefault();void save();}}>
   <label>关系类型<select value={kind} disabled={busy||Boolean(pending.current)} onChange={e=>setKind(e.target.value as RelationType)}>{RELATION_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
   <label>连接理由<Textarea value={reason} maxLength={500} disabled={busy||Boolean(pending.current)} onChange={e=>setReason(e.target.value)} placeholder="说明两条灵感在用途或内容上的具体联系；候选关系请注明待验证。" rows={4}/></label>
   <p className="atlas-connection-note">类型与理由说明内容联系，不代表方案已经实施。仅共享标签时可保留虚线提示。</p>
   <div className="atlas-connection-actions"><Button type="submit" disabled={busy||removed&&!pending.current||!base&&!reason.trim()}>{busy?'保存并读回中…':pending.current?'重试原保存':base?'保存说明':'保存连接'}</Button>{base&&<Button type="button" variant="ghost" disabled={busy||Boolean(pending.current)} onClick={()=>adopt(base)}>取消编辑</Button>}</div>
  </form>}
  {error&&<p role="alert" className="atlas-connection-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {(error||latest)&&editing&&<Button variant="outline" disabled={busy} onClick={()=>void readLatest()}>读取最新说明</Button>}
  {latest&&!removed&&<section className="atlas-connection-latest"><h4>当前保存的说明</h4><p>{relationLabel(latest.relationType)}：{latest.reason||'说明待补充'}</p><div className="atlas-connection-actions"><Button variant="outline" disabled={busy} onClick={()=>adopt(latest)}>采用最新说明</Button><Button disabled={busy} onClick={()=>{pending.current=null;void save(latest);}}>在最新版本上保存我的说明</Button></div></section>}
 </aside>;
}
