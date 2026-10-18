import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Plus,RotateCcw,Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Empty,EmptyContent,EmptyDescription,EmptyHeader,EmptyMedia,EmptyTitle} from '@/components/ui/empty';
import {cardBrowseIdeas} from '@/lib/atlas-view';
import type {Idea} from '@/lib/idea-store';
import InspirationCard from './inspiration-card';

const batchSize=50;

export type CardPresentation={density:'standard'|'compact';anchor?:{id:string;offset:number}};

// 先读旧布局再切密度；阅读锚点不借用或写入画布坐标。
export function captureCardPresentation(density:CardPresentation['density']):CardPresentation {
  const panel=document.getElementById('atlas-cards-panel');
  if(!panel)return {density};
  const bounds=panel.getBoundingClientRect();
  const card=Array.from(panel.querySelectorAll<HTMLElement>('[data-idea-card]')).find(item=>{
    const rect=item.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom;
  });
  return {density,anchor:card?{id:card.dataset.ideaCard!,offset:card.getBoundingClientRect().top-bounds.top}:undefined};
}

export default function CardBrowser({active,ideas,viewKey,presentation,loading,hasData,error,filtered,archived,onOpen,onReload,onClear,onNew}:{
  active:boolean;ideas:Idea[];viewKey:string;loading:boolean;hasData:boolean;error:string;filtered:boolean;archived:boolean;
  presentation:CardPresentation;
  onOpen:(id:string)=>void;onReload:()=>void;onClear:()=>void;onNew:()=>void;
}) {
  const sorted=useMemo(()=>cardBrowseIdeas(ideas),[ideas]);
  const [limit,setLimit]=useState(batchSize);
  const panel=useRef<HTMLElement|null>(null),end=useRef<HTMLDivElement|null>(null),scrollTop=useRef(0),previousKey=useRef(viewKey),previousDensity=useRef(presentation.density);
  useLayoutEffect(()=>{
    const rangeChanged=previousKey.current!==viewKey,densityChanged=previousDensity.current!==presentation.density;
    previousKey.current=viewKey;previousDensity.current=presentation.density;
    if(rangeChanged){scrollTop.current=0;setLimit(batchSize);}
    if(active&&panel.current){
      const surface=panel.current;
      surface.scrollTop=scrollTop.current;
      if(densityChanged&&!rangeChanged&&presentation.anchor){
        const anchor=Array.from(surface.querySelectorAll<HTMLElement>('[data-idea-card]')).find(card=>card.dataset.ideaCard===presentation.anchor!.id);
        // 长卡片顶部已滚出时，收缩后仍至少保留一段可见内容。
        if(anchor){
          const offset=Math.max(presentation.anchor.offset,24-anchor.offsetHeight);
          surface.scrollTop+=anchor.getBoundingClientRect().top-surface.getBoundingClientRect().top-offset;
        }
      }
      scrollTop.current=surface.scrollTop;
    }
  },[active,viewKey,presentation]);
  const shown=sorted.slice(0,limit);
  useEffect(()=>{
    if(!active||loading||!hasData||limit>=sorted.length||!panel.current||!end.current)return;
    let disposed=false,expanded=false;
    const observer=new IntersectionObserver(entries=>{
      if(disposed||expanded||!entries.some(entry=>entry.isIntersecting))return;
      expanded=true;
      setLimit(current=>Math.min(current+batchSize,sorted.length));
    },{root:panel.current,rootMargin:'0px 0px 320px 0px'});
    observer.observe(end.current);
    return ()=>{disposed=true;observer.disconnect();};
  },[active,loading,hasData,limit,sorted.length,viewKey,presentation.density]);
  return <main ref={panel} id="atlas-cards-panel" role="tabpanel" aria-labelledby="atlas-cards-tab" tabIndex={0}
    hidden={!active} className="atlas-card-browser" data-density={presentation.density} aria-busy={loading}
    onScroll={event=>{if(active)scrollTop.current=event.currentTarget.scrollTop;}}>
    {loading?<div className="atlas-browse-loading" role="status" aria-label="正在读取灵感卡片"><span>正在读取灵感…</span><div className="atlas-browse-grid">{[0,1,2].map(index=><div key={index} className="atlas-browse-placeholder" aria-hidden="true"/>)}</div></div>
      :!hasData?<Empty><EmptyHeader><EmptyMedia variant="icon"><RotateCcw/></EmptyMedia><EmptyTitle>无法读取灵感库</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={onReload}>重试</Button></EmptyContent></Empty>
      :!sorted.length?<Empty><EmptyHeader><EmptyMedia variant="icon"><Sparkles/></EmptyMedia><EmptyTitle>{filtered?'没有找到匹配的灵感':archived?'归档里还是空的':'从一个想法开始'}</EmptyTitle><EmptyDescription>{filtered?'试试其他词，或清除筛选。':archived?'归档的灵感会留在这里，随时可以恢复。':'写下片段，或放入图片与文件。'}</EmptyDescription></EmptyHeader><EmptyContent>{filtered?<Button variant="outline" onClick={onClear}>清除全部筛选</Button>:!archived&&<Button onClick={onNew}><Plus size={17}/>新建灵感</Button>}</EmptyContent></Empty>
      :<><div className="atlas-browse-grid" role="list" aria-label="灵感卡片">{shown.map(idea=><div key={idea.id} role="listitem"><InspirationCard idea={idea} className="atlas-browse-card" onOpen={()=>onOpen(idea.id)}/></div>)}</div>
        <div ref={end} className="atlas-browse-end"><p role="status" className={shown.length<sorted.length?'sr-only':undefined}>{shown.length===sorted.length?`已显示全部 ${sorted.length} 条灵感。`:`已显示 ${shown.length} / ${sorted.length} 条灵感，向下滚动将自动继续展示。`}</p></div></>}
  </main>;
}
