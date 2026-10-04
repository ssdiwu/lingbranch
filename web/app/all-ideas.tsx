import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Idea } from '@/lib/idea-store';

// 列表可先于画布读到 AI 新记录；把完整读回对象交给详情，不能只传旧缓存里没有的 ID。
type Page = { items:Idea[];total:number;nextCursor:string|null;hasMore:boolean };
export default function AllIdeas({onClose,onOpen}:{onClose:()=>void;onOpen:(item:Idea)=>void}) {
  const [items,setItems] = useState<Idea[]>([]),[cursor,setCursor] = useState<string|null>(null),[more,setMore] = useState(false);
  const [total,setTotal] = useState(0),[busy,setBusy] = useState(true),[error,setError] = useState('');
  const load = async(next:string|null,signal?:AbortSignal) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/list?includeArchived=true&limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,{signal,cache:'no-store'});
      const value = await response.json() as Page & {error?:string};
      if (!response.ok) throw new Error(value.error || '列表读取失败。');
      setItems(current => next ? [...current,...value.items] : value.items); setCursor(value.nextCursor);setMore(value.hasMore);setTotal(value.total);
    } catch(reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '列表读取失败。'); }
    finally { if (!signal?.aborted) setBusy(false); }
  };
  useEffect(() => { const controller = new AbortController(); void load(null,controller.signal); return () => controller.abort(); },[]);
  return <Dialog open onOpenChange={open => {if (!open) onClose();}}><DialogContent className="atlas-dialog"><DialogHeader><DialogTitle>全量列表</DialogTitle><DialogDescription>包含未打标签和已归档的灵感。已读取 {items.length} / {total} 条。</DialogDescription></DialogHeader>
    <div className="atlas-all-list">{items.map(item => <button key={item.id} onClick={() => onOpen(item)}><strong>{item.title}</strong><span>{item.archived ? '已归档' : '画布'} · {item.tags.join('、') || '未打标签'}</span></button>)}</div>
    {error && <p role="alert">{error}</p>}<p role="status">{busy ? '正在读取…' : !items.length ? '资料库还是空的。' : !more ? '已读取全部记录。' : '还有更多记录。'}</p>
    {(more || error) && <Button disabled={busy} onClick={() => void load(cursor)}>{error ? '重试' : '继续读取'}</Button>}
  </DialogContent></Dialog>;
}
