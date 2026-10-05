
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type SetStateAction, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, ArrowDownToLine, ArrowUpRight, Copy, FileText, FileUp, Focus, Image as ImageIcon, LayoutGrid, List, Link2, Minus, Plus, RotateCcw, Search, Sparkles, Tags, Unlink2, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { Atlas as AtlasData, Idea, Connection, CanvasState, BodyFormat } from "@/lib/idea-store";
import { imageCounts, coverImage, isPreviewableImage, isImage } from "@/lib/idea-store";
import { inspirationUrl } from "@/lib/inspiration-links";
import { attachmentUrl } from "@/lib/idea-store";
import titleGuidance from "@/lib/inspiration-title-guidance.json" with { type: "json" };
import { applyViewPositions, compactIdeas, defaultCardSize, filterIdeas, fitCanvasView, viewTagCounts, visibleConnections, type ViewPositions } from "@/lib/atlas-view";
import { canonicalInspirationTag, inspirationTagHint } from "@/lib/inspiration-tags";
import ImageGallery from "./image-gallery";
import type { DraftImage, BodyEditorHandle } from "./body-editor";
import { markdownText, plainToMarkdown } from "../../shared/markdown.mjs";
import { createSaveSession, acknowledgeVersion, saveInspiration, type SaveSession } from "../../shared/save-inspiration.mjs";
const BodyEditor=lazy(()=>import("./body-editor"));
import { BodyReader } from "./body-reader";
import TagManager from "./tag-manager";
import AllIdeas from "./all-ideas";

type Form = { title:string; body:string; bodyFormat:BodyFormat; sourceLabel:string; sourceUrl:string; sourceAt:string; tags:string; indexNote:string };
const emptyForm:Form={title:"",body:"",bodyFormat:"markdown",sourceLabel:"",sourceUrl:"",sourceAt:"",tags:"",indexNote:""};


async function jsonRequest<T>(url:string,init?:RequestInit):Promise<T> {
  const response=await fetch(url,{cache:"no-store",...init,headers:{...init?.headers,"X-LingBranch-Request":"1"}});
  const value=await response.json().catch(()=>({error:"服务暂时无法响应。"})) as {error?:string;code?:string};
  if(!response.ok)throw Object.assign(new Error(value.error||"操作失败，请稍后重试。"),{code:value.code});
  return value as T;
}
const asJson=(method:string,value:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
const niceDate=(value:string)=>{try{return new Date(value).toLocaleDateString("zh-CN",{year:"numeric",month:"short",day:"numeric"});}catch{return value;}};
async function readableText(file:File):Promise<string> {
  if(file.type.startsWith("text/")||/\.(txt|md|csv|json|log|js|ts|py|html|css|xml|yaml|yml)$/i.test(file.name)) {
    return new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer()).slice(0,90000);
  }
  return "";
}
async function fileHash(file:File):Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

export default function Atlas(){
  const [allOpen,setAllOpen]=useState(false),[conflict,setConflict]=useState(false),[latest,setLatest]=useState<Idea|null>(null);
  const saveSession=useRef<SaveSession>(createSaveSession()),savingRef=useRef(false),bodyEditorRef=useRef<BodyEditorHandle>(null);
  const [editorReady,setEditorReady]=useState(false);
  const newPosition=useRef({x:120,y:120}),canvasVersion=useRef("1970-01-01T00:00:00.000Z");
  const canvasWrites=useRef(Promise.resolve()),reloadSequence=useRef(0),canvasDirty=useRef(false);
  const [data,setData]=useState<AtlasData|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [query,setQuery]=useState(""),[archiveView,setArchiveView]=useState(false),[transform,setTransform]=useState<CanvasState>({panX:0,panY:0,zoom:1});
  const [selectedTag,setSelectedTag]=useState(""),[tagManagerOpen,setTagManagerOpen]=useState(false),[editingVersion,setEditingVersion]=useState("");
  const [compactView,setCompactView]=useState(false),[viewPositions,setViewPositions]=useState<ViewPositions>({});
  const [canvasSize,setCanvasSize]=useState({width:1000,height:700}),[cardSize,setCardSize]=useState(defaultCardSize);
  const temporaryView=archiveView||Boolean(selectedTag||query.trim());
  const [editorOpen,setEditorOpen]=useState(false),[editingId,setEditingId]=useState<string|null>(null),[form,setForm]=useState<Form>(emptyForm),[files,setFiles]=useState<File[]>([]),[saving,setSaving]=useState(false);
  const [drafts,setDrafts]=useState<DraftImage[]>([]),[stage,setStage]=useState(""),[editorKey,setEditorKey]=useState(0);
  const [selectedId,setSelectedId]=useState<string|null>(null),[detailOpen,setDetailOpen]=useState(false),[linkMode,setLinkMode]=useState(false),[linkFrom,setLinkFrom]=useState<string|null>(null);
  const [siteOrigin,setSiteOrigin]=useState(""),[galleryId,setGalleryId]=useState<string|null>(null);
  const [shareFeedback,setShareFeedback]=useState<{url:string;text:string}|null>(null);
  const shareInputRef=useRef<HTMLInputElement>(null),galleryTrigger=useRef<HTMLElement|null>(null);
  const canvasRef=useRef<HTMLDivElement>(null),panRef=useRef<{x:number;y:number;panX:number;panY:number}|null>(null),hydrated=useRef(false);
  const dragRef=useRef<{id:string;x:number;y:number;clientX:number;clientY:number;moved:boolean}|null>(null);
  const keyMoves=useRef(new Map<string,Promise<Idea>>());
  const transformRef=useRef(transform);transformRef.current=transform;
  const dataRef=useRef(data);dataRef.current=data;
  const originalTransform=useRef<CanvasState|null>(null);
  // 筛选适配和清除筛选只改变显示；持久视野的写入意图仅来自用户操作。
  const setUserTransform=(value:SetStateAction<CanvasState>)=>{canvasDirty.current=!temporaryView;setTransform(value);};

  const changeFilter=(tag:string,text:string,archived=archiveView,compact=Boolean(tag))=>{
    const nextTemporary=archived||Boolean(tag||text.trim());
    if(nextTemporary&&!originalTransform.current)originalTransform.current={...transformRef.current};
    if(!nextTemporary){setTransform(originalTransform.current??data?.canvas??transformRef.current);originalTransform.current=null;}
    setSelectedTag(tag);setQuery(text);setArchiveView(archived);setCompactView(compact);setViewPositions({});setLinkFrom(null);dragRef.current=null;
  };

  const reload=useCallback(async()=>{
    const sequence=++reloadSequence.current;
    try {const next=await jsonRequest<AtlasData>("/api/atlas");if(sequence!==reloadSequence.current)return;canvasVersion.current=next.canvas.updatedAt!;setData(next);if(!hydrated.current){setTransform(next.canvas);hydrated.current=true;}setError("");
      const deepLink=new URLSearchParams(window.location.search).get("idea");if(deepLink&&next.ideas.some(idea=>idea.id===deepLink)){setSelectedId(deepLink);setDetailOpen(true);}
    }catch(reason){setError(reason instanceof Error?reason.message:"无法读取灵感库。");}finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{setSiteOrigin(window.location.origin);},[]);
  // 刷新资料只更新读缓存；仅用户视野变化可触发写入，避免旧视野覆盖其他入口的新保存。
  useEffect(()=>{if(temporaryView){canvasDirty.current=false;return;}const current=dataRef.current;if(!current||!canvasDirty.current)return;if(current.canvas.panX===transform.panX&&current.canvas.panY===transform.panY&&current.canvas.zoom===transform.zoom){canvasDirty.current=false;return;}
    const timer=setTimeout(()=>{canvasDirty.current=false;canvasWrites.current=canvasWrites.current.catch(()=>{}).then(async()=>{
      const saved=await jsonRequest<CanvasState>("/api/canvas",asJson("PATCH",{panX:transform.panX,panY:transform.panY,zoom:transform.zoom,expectedUpdatedAt:canvasVersion.current,idempotencyKey:crypto.randomUUID()}));
      canvasVersion.current=saved.updatedAt!;setData(current=>current?{...current,canvas:saved}:current);
    }).catch(reason=>setError(reason instanceof Error?reason.message:"视野保存失败，请刷新后重试。"));},700);return()=>clearTimeout(timer);},[transform,temporaryView]);
  useEffect(()=>{
    const surface=canvasRef.current;if(!surface)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();const current=transformRef.current;if(event.ctrlKey||event.metaKey){
      const rect=surface.getBoundingClientRect(),cx=event.clientX-rect.left,cy=event.clientY-rect.top,zoom=Math.max(temporaryView ? .05 : .25,Math.min(2.5,current.zoom*Math.exp(-event.deltaY*.006)));
      setUserTransform({panX:cx-(cx-current.panX)*zoom/current.zoom,panY:cy-(cy-current.panY)*zoom/current.zoom,zoom});
    }else setUserTransform({...current,panX:current.panX-event.deltaX,panY:current.panY-event.deltaY});};
    surface.addEventListener("wheel",wheel,{passive:false});return()=>surface.removeEventListener("wheel",wheel);
  },[temporaryView]);

  const activeIdeas=useMemo(()=>filterIdeas(data?.ideas??[],archiveView,query,selectedTag),[data,archiveView,query,selectedTag]);
  const tagCounts=useMemo(()=>viewTagCounts(data?.ideas??[],archiveView,query),[data,archiveView,query]);
  const viewIdeas=useMemo(()=>{
    const base=temporaryView&&compactView?compactIdeas(activeIdeas,canvasSize,cardSize):activeIdeas;
    return temporaryView?applyViewPositions(base,viewPositions,cardSize):base;
  },[activeIdeas,temporaryView,compactView,canvasSize,cardSize,viewPositions]);
  const viewIdeasRef=useRef(viewIdeas);
  useEffect(()=>{viewIdeasRef.current=viewIdeas;},[viewIdeas]);
  const shownIdsKey=activeIdeas.map(idea=>idea.id).join(",");
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const observer=new ResizeObserver(()=>{
      setCanvasSize(current=>current.width===canvas.clientWidth&&current.height===canvas.clientHeight?current:{width:canvas.clientWidth,height:canvas.clientHeight});
      const cards=Array.from(canvas.querySelectorAll<HTMLElement>(".atlas-card"));
      if(cards.length){const measured={width:Math.max(...cards.map(card=>card.offsetWidth)),height:Math.max(...cards.map(card=>card.offsetHeight))};setCardSize(current=>current.width===measured.width&&current.height===measured.height?current:measured);}
    });
    observer.observe(canvas);canvas.querySelectorAll(".atlas-card").forEach(card=>observer.observe(card));
    return()=>observer.disconnect();
  },[shownIdsKey]);
  useEffect(()=>{
    if(!temporaryView)return;
    const frame=requestAnimationFrame(()=>{const fit=fitCanvasView(viewIdeasRef.current,canvasSize,cardSize);if(fit)setTransform(fit);});
    return()=>cancelAnimationFrame(frame);
  },[temporaryView,archiveView,selectedTag,query,compactView,canvasSize,cardSize,shownIdsKey]);
  const selected=data?.ideas.find(idea=>idea.id===selectedId)||null;
  const shareUrl=selected&&siteOrigin?inspirationUrl(siteOrigin,selected.id):"";
  const images=selected?.attachments.filter(file=>/^image\/(png|jpeg|gif|webp)$/.test(file.mimeType))??[];
  const shownConnections=visibleConnections(data?.connections??[],viewIdeas);
  const updateLocal=(idea:Idea)=>setData(previous=>previous?{...previous,ideas:previous.ideas.map(item=>item.id===idea.id?idea:item)}:previous);
  const openDetail=(id:string)=>{setGalleryId(null);setSelectedId(id);setDetailOpen(true);const url=new URL(location.href);url.searchParams.set("idea",id);history.replaceState(null,"",url);};
    const openGallery=(attachmentId:string)=>{galleryTrigger.current=document.activeElement as HTMLElement|null;setGalleryId(attachmentId);};
  const closeDetail=()=>{setGalleryId(null);setDetailOpen(false);const url=new URL(location.href);url.searchParams.delete("idea");history.replaceState(null,"",url);};
  const copyShareLink=async()=>{
    setError("");setNotice("");setShareFeedback(null);
    try{await navigator.clipboard.writeText(shareUrl);setShareFeedback({url:shareUrl,text:"灵感链接已复制，可交给已连接此资料库的 AI 客户端。"});setNotice("灵感链接已复制，可交给已连接此资料库的 AI 客户端。");}
    catch{shareInputRef.current?.focus();shareInputRef.current?.select();setShareFeedback({url:shareUrl,text:"未能自动复制，请复制已选中的分享链接。"});setError("未能自动复制，请复制已选中的分享链接。");}
  };
  const startNew=()=>{
    if(savingRef.current)return;
    newPosition.current={x:(120-transform.panX)/transform.zoom,y:(120-transform.panY)/transform.zoom};
    saveSession.current=createSaveSession(null,"",newPosition.current);
    setConflict(false);setLatest(null);setError("");setNotice("");setEditingId(null);setEditingVersion("");
    setForm(emptyForm);setFiles([]);setDrafts([]);setStage("");setEditorReady(false);setEditorKey(x=>x+1);setEditorOpen(true);
  };
  const startEdit=(idea:Idea)=>{
    if(savingRef.current)return;
    saveSession.current=createSaveSession(idea.id,idea.updatedAt);
    setConflict(false);setLatest(null);setError("");setNotice("");setEditingId(idea.id);setEditingVersion(idea.updatedAt);
    setForm({title:idea.title,body:idea.body,bodyFormat:idea.bodyFormat,sourceLabel:idea.sourceLabel,sourceUrl:idea.sourceUrl,sourceAt:idea.sourceAt,tags:idea.tags.join(", "),indexNote:""});
    setFiles([]);setDrafts([]);setStage("");setEditorReady(false);setEditorKey(x=>x+1);setDetailOpen(false);setEditorOpen(true);
  };
  const switchFormat=(format:BodyFormat)=>{
    if(savingRef.current||form.bodyFormat===format)return;
    let body=form.body;
    if(form.bodyFormat==="markdown"){
      body=bodyEditorRef.current?.getMarkdown()??body;
      const pending=bodyEditorRef.current?.getDraftImages()??drafts;
      setFiles(current=>[...current,...pending.map(image=>image.file)]);setDrafts([]);
      body=markdownText(body);
    }else body=plainToMarkdown(body);
    setForm(current=>({...current,body,bodyFormat:format}));setError("");setEditorReady(false);setEditorKey(x=>x+1);
  };
  const save=async()=>{
    if(savingRef.current||conflict)return;
    if(!form.title.trim())return setError("请先给灵感写一个标题。");
    const body=form.bodyFormat==="markdown" ? bodyEditorRef.current?.getMarkdown()??form.body : form.body;
    const pending=form.bodyFormat==="markdown" ? bodyEditorRef.current?.getDraftImages()??drafts : [];
    const snapshot={...form,body,tags:form.tags.split(/[,，]/).map(canonicalInspirationTag).filter(Boolean),files:[...files],drafts:[...pending]};
    savingRef.current=true;bodyEditorRef.current?.setReadonly(true);setSaving(true);setError("");setNotice("");
    // 与冻结的编辑器同步最新文本，失败后仍显示本次完整草稿。
    setForm(current=>({...current,body}));
    try{
      const result=await saveInspiration(saveSession.current,snapshot,{
        key:()=>crypto.randomUUID(),hash:fileHash,index:readableText,
        create:request=>jsonRequest<Idea>("/api/atlas",asJson("POST",request)),
        upload:async request=>{
          const upload=new FormData();upload.append("file",request.file);upload.append("sha256",request.sha256);
          upload.append("indexedText",request.indexedText);upload.append("idempotencyKey",request.idempotencyKey);
          return jsonRequest(`/api/ideas/${request.id}/attachments`,{method:"POST",body:upload});
        },
        update:({id,patch,...request})=>jsonRequest<Idea>(`/api/ideas/${id}`,asJson("PATCH",{...request,...patch})),
        read:id=>jsonRequest<Idea>(`/api/ideas/${id}`),
      },setStage);
      setEditingId(result.item.id);setEditingVersion(result.item.updatedAt);
      setData(current=>current?{...current,ideas:[...current.ideas.filter(idea=>idea.id!==result.item.id),result.item]}:current);
      setEditorOpen(false);setFiles([]);setDrafts([]);
      setNotice(result.unindexed ? `正文与原件已保存并读回；${result.unindexed} 个附件未能自动提取文字，原件仍完整保留。` : "正文与原件已保存并读回。");
      await reload();if(result.wasNew)centerOn(result.item);openDetail(result.item.id);
    }catch(reason){
      const failure=reason as Error&{code?:string;phase?:string;uploadedCount?:number};
      const phaseNames:Record<string,string>={preparing:"准备保存",creating:"建立记录",uploading:"保存原件",writing:"写入正文",verifying:"读回核对"};
      if(saveSession.current.id){setEditingId(saveSession.current.id);setEditingVersion(saveSession.current.version);}
      const created=saveSession.current.wasNew&&saveSession.current.id?" 灵感记录已建立；本次保存仍待完整确认。":"";
      const saved=failure.uploadedCount ? ` 已确认 ${failure.uploadedCount} 个原件；它们和阶段请求已保留。` : "";
      setError(`${phaseNames[failure.phase??""]??"保存"}未完成：${failure.message||"请重试。"}${created}${saved} 草稿已保留。`);
      if(failure.code==="conflict"){setConflict(true);setLatest(null);}
    }finally{savingRef.current=false;setSaving(false);bodyEditorRef.current?.setReadonly(false);setStage("");}
  };
  const archive=async(idea:Idea)=>{try{const updated=await jsonRequest<Idea>(`/api/ideas/${idea.id}`,asJson("PATCH",{archived:!idea.archived,expectedUpdatedAt:idea.updatedAt,idempotencyKey:crypto.randomUUID()}));updateLocal(updated);setDetailOpen(false);setNotice(idea.archived?"已恢复到画布。":"已归档，可随时恢复。");}catch(reason){setError(reason instanceof Error?reason.message:"归档失败。");}};
  const centerOn=(idea:Idea)=>{const rect=canvasRef.current?.getBoundingClientRect();if(!rect)return;const shown=viewIdeas.find(item=>item.id===idea.id);if(!shown)changeFilter("","",idea.archived,false);const point=shown??idea;setUserTransform(current=>({...current,panX:rect.width/2-(point.x+cardSize.width/2)*current.zoom,panY:rect.height/2-(point.y+cardSize.height/2)*current.zoom}));};
  const handleCard=(id:string)=>{
    if(!linkMode){openDetail(id);return;}
    if(!linkFrom){setLinkFrom(id);setNotice("再选一条灵感，建立连线。");return;}
    if(linkFrom===id){setLinkFrom(null);setNotice("已取消选择。");return;}
    void jsonRequest<Connection>("/api/connections",asJson("POST",{fromId:linkFrom,toId:id})).then(connection=>{setData(previous=>previous?{...previous,connections:[...previous.connections.filter(item=>item.id!==connection.id),connection]}:previous);setNotice("两条灵感已连接。");}).catch(reason=>setError(reason instanceof Error?reason.message:"连线失败。")).finally(()=>setLinkFrom(null));
  };
  const removeLink=async(link:Connection)=>{try{await jsonRequest("/api/connections",asJson("DELETE",{id:link.id}));setData(previous=>previous?{...previous,connections:previous.connections.filter(item=>item.id!==link.id)}:previous);}catch(reason){setError(reason instanceof Error?reason.message:"移除连线失败。");}};
  const onCardDown=(event:ReactPointerEvent<HTMLButtonElement>,idea:Idea)=>{if(linkMode||event.button!==0||keyMoves.current.has(idea.id))return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={id:idea.id,x:idea.x,y:idea.y,clientX:event.clientX,clientY:event.clientY,moved:false};};
  const onCardMove=(event:ReactPointerEvent<HTMLButtonElement>)=>{const drag=dragRef.current;if(!drag||drag.id!==event.currentTarget.dataset.id)return;const dx=(event.clientX-drag.clientX)/transformRef.current.zoom,dy=(event.clientY-drag.clientY)/transformRef.current.zoom;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;if(!drag.moved)return;if(temporaryView){setViewPositions(current=>({...current,[drag.id]:{x:drag.x+dx,y:drag.y+dy}}));return;}setData(previous=>previous?{...previous,ideas:previous.ideas.map(idea=>idea.id===drag.id?{...idea,x:drag.x+dx,y:drag.y+dy}:idea)}:previous);};
  // 冲突先回读恢复位置，再呈现失败，防止 reload 清除错误提示。
  const onCardUp=(event:ReactPointerEvent<HTMLButtonElement>,idea:Idea)=>{event.stopPropagation();if(linkMode){handleCard(idea.id);return;}const drag=dragRef.current;dragRef.current=null;if(!drag?.moved){openDetail(idea.id);return;}const x=drag.x+(event.clientX-drag.clientX)/transformRef.current.zoom,y=drag.y+(event.clientY-drag.clientY)/transformRef.current.zoom;if(temporaryView){setViewPositions(current=>({...current,[idea.id]:{x,y}}));return;}void jsonRequest<Idea>(`/api/ideas/${idea.id}`,asJson("PATCH",{x,y,expectedUpdatedAt:idea.updatedAt,idempotencyKey:crypto.randomUUID()})).then(updateLocal).catch(async reason=>{await reload();setError(reason instanceof Error?reason.message:"位置保存失败。");});};
  const onCardKeyDown=(event:ReactKeyboardEvent<HTMLButtonElement>,idea:Idea)=>{
    const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const direction=directions[event.key];if(!direction||event.altKey||event.ctrlKey||event.metaKey||linkMode)return;
    event.preventDefault();if(dragRef.current)return;const step=event.shiftKey?400:20;
    if(temporaryView){setViewPositions(current=>({...current,[idea.id]:{x:idea.x+direction[0]*step,y:idea.y+direction[1]*step}}));return;}
    const previous=keyMoves.current.get(idea.id)??Promise.resolve(idea);
    const move=previous.catch(()=>jsonRequest<Idea>(`/api/ideas/${idea.id}`)).then(current=>jsonRequest<Idea>(`/api/ideas/${idea.id}`,asJson("PATCH",{x:current.x+direction[0]*step,y:current.y+direction[1]*step,expectedUpdatedAt:current.updatedAt,idempotencyKey:crypto.randomUUID()}))).then(updated=>{updateLocal(updated);return updated;});
    keyMoves.current.set(idea.id,move);
    void move.catch(reason=>setError(reason instanceof Error?reason.message:"位置保存失败。")).finally(()=>{if(keyMoves.current.get(idea.id)===move)keyMoves.current.delete(idea.id);});
  };
  const onCanvasDown=(event:ReactPointerEvent<HTMLDivElement>)=>{if(event.button!==0||event.target!==event.currentTarget)return;event.currentTarget.setPointerCapture(event.pointerId);panRef.current={x:event.clientX,y:event.clientY,panX:transform.panX,panY:transform.panY};};
  const onCanvasMove=(event:ReactPointerEvent<HTMLDivElement>)=>{const pan=panRef.current;if(!pan)return;setUserTransform(current=>({...current,panX:pan.panX+event.clientX-pan.x,panY:pan.panY+event.clientY-pan.y}));};
  const exportData=async()=>{try{const response=await fetch("/api/export");if(!response.ok){const value=await response.json() as {error?:string};throw new Error(value.error||"导出失败。");}const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");link.href=url;link.download=`lingbranch-${new Date().toISOString().slice(0,10)}.lingbranch.json.gz`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);}catch(reason){setError(reason instanceof Error?reason.message:"导出失败。");}};
  const linked=selected?data?.connections.filter(link=>link.fromId===selected.id||link.toId===selected.id)??[]:[];

  return <div className="atlas-shell">
    <header className="atlas-topbar"><div className="atlas-brand"><span className="atlas-brandmark"><Sparkles size={19}/></span><span>灵枝</span><span className="atlas-private">个人资料库</span></div><label className="atlas-search"><Search size={18}/><Input value={query} onChange={event=>changeFilter(selectedTag,event.target.value,archiveView,compactView)} placeholder="搜索灵感、标签、文件与来源" aria-label="搜索灵感"/></label><Button variant="outline" size="icon" aria-label="刷新资料库" title="读取网页与 AI 的最新保存" onClick={()=>void reload()}><RotateCcw size={18}/></Button><Button variant="outline" size="icon" aria-label="全量列表" title="全量列表（含归档）" onClick={()=>setAllOpen(true)}><List size={18}/></Button><Button variant="outline" size="icon" aria-label="管理标签" title="管理标签" onClick={()=>setTagManagerOpen(true)}><Tags size={18}/></Button><Button onClick={startNew} className="atlas-create" aria-label="新建灵感"><Plus size={17}/><span>新建灵感</span></Button></header>
    <div className="atlas-body"><aside className="atlas-rail" aria-label="灵感导航"><div className="atlas-rail-title">空间</div><button className={!archiveView?"atlas-nav-active":"atlas-nav-muted"} onClick={()=>changeFilter("","",false,false)}><LayoutGrid size={18}/> 无限画布</button><button className={archiveView?"atlas-nav-active":"atlas-nav-muted"} onClick={()=>changeFilter("","",true,false)}><Archive size={18}/> 已归档</button><button className="atlas-nav-muted" onClick={()=>setTagManagerOpen(true)}><Tags size={18}/> 管理标签</button><div className="atlas-rail-tags" aria-label="按标签筛选"><div className="atlas-rail-title">标签 · {archiveView?"归档":"画布"}</div>{tagCounts.map(tag=><button key={tag.name} aria-label={`筛选标签：${tag.name}`} aria-pressed={selectedTag===tag.name} className={selectedTag===tag.name?"is-selected":""} onClick={()=>changeFilter(selectedTag===tag.name?"":tag.name,query,archiveView,selectedTag!==tag.name)}><span>{tag.name}</span><span>{tag.count}</span></button>)}</div>{(query||selectedTag)&&<div className="atlas-results"><div className="atlas-rail-title">搜索结果 · {activeIdeas.length}</div>{activeIdeas.slice(0,30).map(idea=><button key={idea.id} onClick={()=>{centerOn(idea);openDetail(idea.id);}}>{idea.title}</button>)}</div>}<div className="atlas-rail-foot"><Button variant="ghost" size="sm" onClick={()=>void exportData()}><ArrowDownToLine size={16}/> 导出全部资料</Button><p>原件与画布资料一起导出</p></div></aside>
      <main ref={canvasRef} className="atlas-canvas" aria-label="无限画布" onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={()=>{panRef.current=null;}}>
        <div className="atlas-canvas-heading"><span>{query.trim()?"搜索结果":selectedTag?"标签筛选":archiveView?"已归档":"画布"}</span><span>{activeIdeas.length} 条灵感</span>{selectedTag&&<button className="atlas-selected-tag" onClick={()=>changeFilter("",query,archiveView,false)} aria-label="清除标签筛选">{selectedTag}<X size={13}/></button>}{temporaryView&&activeIdeas.length>0&&<><Button variant="outline" size="sm" aria-pressed={compactView} onClick={()=>{setCompactView(!compactView);setViewPositions({});setLinkFrom(null);}}>{compactView?"切回原位置":"临时聚合"}</Button><span className="atlas-view-note">拖动仅调整当前视图</span></>}</div>
        {(query||selectedTag)&&activeIdeas.length>0&&<details className="atlas-mobile-results" aria-label="搜索结果"><summary>查看结果列表</summary>{activeIdeas.slice(0,30).map(idea=><button key={idea.id} onClick={()=>{centerOn(idea);openDetail(idea.id);}}>{idea.title}</button>)}</details>}
        {loading?<div className="atlas-loading"><Skeleton className="h-40 w-72"/><Skeleton className="h-36 w-72"/></div>:!data?<Empty className="atlas-empty"><EmptyHeader><EmptyMedia variant="icon"><RotateCcw/></EmptyMedia><EmptyTitle>无法读取灵感库</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={()=>void reload()}>重试</Button></EmptyContent></Empty>:activeIdeas.length===0?<Empty className="atlas-empty"><EmptyHeader><EmptyMedia variant="icon"><Sparkles/></EmptyMedia><EmptyTitle>{(query||selectedTag)?"没有找到匹配的灵感":archiveView?"归档里还是空的":"从一个想法开始"}</EmptyTitle><EmptyDescription>{(query||selectedTag)?"试试其他词，或清除筛选。标签只统计当前画布或归档。":archiveView?"归档的灵感会留在这里，随时可以恢复。":"写下片段，或放入图片与文件。之后可以在画布上整理，也能从聊天里找回。"}</EmptyDescription></EmptyHeader>{(query||selectedTag)&&<EmptyContent><Button variant="outline" onClick={()=>changeFilter("","",archiveView,false)}>清除全部筛选</Button></EmptyContent>}{!query&&!selectedTag&&!archiveView&&<EmptyContent><div className="atlas-empty-actions"><Button onClick={startNew}><Plus size={17}/> 写一条灵感</Button><Button variant="outline" onClick={startNew}><FileUp size={17}/> 添加文件</Button></div></EmptyContent>}</Empty>:<div className="atlas-world" style={{transform:`translate(${transform.panX}px,${transform.panY}px) scale(${transform.zoom})`}}><svg className="atlas-lines" aria-hidden="true">{shownConnections.map(link=>{const a=viewIdeas.find(item=>item.id===link.fromId)!,b=viewIdeas.find(item=>item.id===link.toId)!;return <line key={link.id} data-from={link.fromId} data-to={link.toId} x1={a.x+cardSize.width/2} y1={a.y+cardSize.height/2} x2={b.x+cardSize.width/2} y2={b.y+cardSize.height/2}/>;})}</svg>{viewIdeas.map(idea=>{
  const counts=imageCounts(idea),cover=coverImage(idea);
  return <button key={idea.id} data-id={idea.id} className={`atlas-card ${linkFrom===idea.id?"is-link-source":""}`} style={{left:idea.x,top:idea.y}} onPointerDown={event=>onCardDown(event,idea)} onPointerMove={onCardMove} onPointerUp={event=>onCardUp(event,idea)} onPointerCancel={()=>{dragRef.current=null;if(!temporaryView)void reload();}} onKeyDown={event=>onCardKeyDown(event,idea)} title={temporaryView?"打开查看；拖动或方向键仅调整当前视图，清除筛选恢复原位":"打开查看；拖动整理，或用方向键移动（Shift 加速）"} onClick={event=>{if(event.detail===0)handleCard(idea.id);}}>
    <div className="atlas-card-body">{cover&&<img className="atlas-card-image" src={attachmentUrl(cover.id)} alt="" draggable={false}/>}<h2>{idea.title}</h2><p>{idea.summary||idea.sourceLabel||(counts.total?idea.attachments.map(file=>file.name).join("、"):"打开查看内容")}</p>{idea.tags.length>0&&<div className="atlas-card-tags">{idea.tags.slice(0,3).map(tag=><span key={tag}>{tag}</span>)}</div>}</div>
    <div className="atlas-card-meta">{idea.archived&&<span className="atlas-card-state">已归档</span>}{counts.images>0&&<span><ImageIcon size={13}/>{counts.images} 图</span>}{counts.files>0&&<span><FileText size={13}/>{counts.files} 文件</span>}<time>{niceDate(idea.updatedAt)}</time></div>
  </button>;})}</div>}
        <div className="atlas-canvas-tools"><Button variant={linkMode?"default":"ghost"} size="icon-sm" aria-label="连接两条灵感" title="连接两条灵感" onClick={()=>{setLinkMode(!linkMode);setLinkFrom(null);}}><Link2 size={17}/></Button><span className="atlas-tools-divider"/><Button variant="ghost" size="icon-sm" aria-label="缩小画布" onClick={()=>setUserTransform(current=>({...current,zoom:Math.max(temporaryView ? .05 : .25,current.zoom/1.2)}))}><Minus size={17}/></Button><span>{Math.round(transform.zoom*100)}%</span><Button variant="ghost" size="icon-sm" aria-label="放大画布" onClick={()=>setUserTransform(current=>({...current,zoom:Math.min(2.5,current.zoom*1.2)}))}><ZoomIn size={17}/></Button><Button variant="ghost" size="icon-sm" aria-label="重置视野" onClick={()=>{const fit=temporaryView?fitCanvasView(viewIdeas,canvasSize,cardSize):null;setUserTransform(fit??{panX:0,panY:0,zoom:1});}}><Focus size={17}/></Button></div>
      </main></div>
    {(error||notice)&&<output role="status" className={`atlas-toast ${error?"is-error":""}`} onClick={()=>{setError("");setNotice("");}}>{error||notice}</output>}
    {allOpen&&<AllIdeas onClose={()=>setAllOpen(false)} onOpen={item=>{setData(current=>current?{...current,ideas:[...current.ideas.filter(idea=>idea.id!==item.id),item]}:current);setAllOpen(false);openDetail(item.id);}}/>}
    {tagManagerOpen&&<TagManager open={tagManagerOpen} onOpenChange={setTagManagerOpen} onFilter={tag=>changeFilter(tag,"",archiveView,true)} onChanged={async(fromTag,toTag)=>{if(selectedTag===fromTag)changeFilter(toTag||"",query,archiveView,Boolean(toTag));await reload();}}/>}
    <Dialog open={editorOpen} onOpenChange={open=>{if(!saving)setEditorOpen(open);}}><DialogContent className="atlas-dialog atlas-editor-dialog" showCloseButton={!saving}><DialogHeader><DialogTitle>{editingId?"编辑灵感":"新建灵感"}</DialogTitle><DialogDescription>文字和图片可交错书写；文件原件保存在附件区。每个原件最多 20 MiB。</DialogDescription></DialogHeader><fieldset className="atlas-form" disabled={saving}>{error&&<p role="alert" className="atlas-tag-error">{error}</p>}
      {conflict&&editingId&&<div className="atlas-conflict"><strong>草稿已保留</strong><p>读取最新版本，核对差异后决定是否继续保存当前草稿。</p><Button variant="outline" onClick={()=>void jsonRequest<Idea>(`/api/ideas/${editingId}`).then(setLatest).catch(reason=>setError(reason.message))}>读取最新内容</Button>{latest&&<><pre>{JSON.stringify({标题:latest.title,内容:latest.body,标签:latest.tags,来源:latest.sourceLabel,来源链接:latest.sourceUrl,来源时间:latest.sourceAt},null,2)}</pre><Button onClick={()=>{setEditingVersion(latest.updatedAt);acknowledgeVersion(saveSession.current,latest.updatedAt);setConflict(false);setError("");}}>已核对，继续编辑当前草稿</Button></>}</div>}
      <label>标题<Input value={form.title} maxLength={200} onChange={event=>setForm({...form,title:event.target.value})} placeholder={titleGuidance.placeholder} aria-label="灵感标题" aria-describedby="inspiration-title-hint"/><span id="inspiration-title-hint" className="atlas-field-hint">{titleGuidance.hint}</span></label><div className="atlas-body-field"><div className="atlas-body-head"><span id="atlas-body-label">正文</span><div role="group" aria-labelledby="atlas-body-label" className="atlas-format-switch">
        <button type="button" aria-pressed={form.bodyFormat==="plain"} onClick={()=>switchFormat("plain")}>纯文本</button>
        <button type="button" aria-pressed={form.bodyFormat==="markdown"} onClick={()=>switchFormat("markdown")}>图文正文</button></div></div>
      {form.bodyFormat==="markdown"
        ? <Suspense fallback={<p role="status">正在加载图文编辑器…</p>}><BodyEditor key={editorKey} ref={bodyEditorRef} value={form.body} attachments={data?.ideas.find(idea=>idea.id===editingId)?.attachments??[]} readOnly={saving} onReady={setEditorReady} onChange={markdown=>{if(!savingRef.current)setForm(current=>({...current,body:markdown}));}} onDraftImage={images=>{if(!savingRef.current)setDrafts(images);}} onError={setError}/></Suspense>
        : <Textarea value={form.body} maxLength={50000} onChange={event=>setForm({...form,body:event.target.value})} placeholder="记下想法、图片里的内容或为什么保存它…" rows={5} aria-label="正文"/>}
      <p className="atlas-field-hint">切为图文时按字面保留纯文本；切回纯文本保留可读文字和图片说明，原件继续保留。</p>{stage&&<p role="status" aria-live="polite" className="atlas-stage">{stage}</p>}
      {form.bodyFormat==="markdown"&&drafts.length>0&&<p className="atlas-selected-files">正文草稿含 {drafts.length} 张待保存图片，保存成功后写入正式引用。</p>}</div><label>文件附件（PDF、文档等）<Input type="file" multiple onChange={event=>setFiles(Array.from(event.target.files||[]))}/></label>{files.length>0&&<p className="atlas-selected-files">待上传：{files.map(file=>file.name).join("、")}</p>}<label>附件中的关键文字（可选）<Textarea value={form.indexNote} onChange={event=>setForm({...form,indexNote:event.target.value})} placeholder="可粘贴截图文字或文件摘要，方便以后搜索" rows={2}/></label><div className="atlas-form-grid"><label>来源<Input value={form.sourceLabel} onChange={event=>setForm({...form,sourceLabel:event.target.value})} placeholder="如：微信文件传输助手"/></label><label>来源时间<Input value={form.sourceAt} onChange={event=>setForm({...form,sourceAt:event.target.value})} placeholder="如：2026-09-30"/></label></div><label>来源链接<Input value={form.sourceUrl} onChange={event=>setForm({...form,sourceUrl:event.target.value})} placeholder="https://"/></label><label>标签<Input value={form.tags} onChange={event=>setForm({...form,tags:event.target.value})} placeholder="用逗号分隔，优先复用已有标签" list="inspiration-existing-tags" aria-label="灵感标签" aria-describedby="inspiration-tag-hint"/><datalist id="inspiration-existing-tags">{tagCounts.map(tag=><option key={tag.name} value={tag.name}/>)}</datalist><span id="inspiration-tag-hint" className="atlas-field-hint">{inspirationTagHint}</span></label></fieldset><DialogFooter><Button variant="outline" disabled={saving} onClick={()=>setEditorOpen(false)}>取消</Button><Button disabled={saving||conflict||!form.title.trim()||(form.bodyFormat==="markdown"&&!editorReady)} onClick={()=>void save()}>{saving?"正在保存…":"保存灵感"}</Button></DialogFooter></DialogContent></Dialog>
    <Sheet open={detailOpen} onOpenChange={open=>{if(!open)closeDetail();else setDetailOpen(true);}}><SheetContent className="atlas-sheet"><SheetHeader><SheetTitle>{selected?.title||"灵感详情"}</SheetTitle><SheetDescription>{selected?(selected.archived?"已归档，可随时恢复。":"正文与原件"):""}</SheetDescription></SheetHeader>{selected&&<div className="atlas-detail"><BodyReader body={selected.body} format={selected.bodyFormat} attachments={selected.attachments} onImage={openGallery}/><h3>文件附件 · {imageCounts(selected).files}</h3>{imageCounts(selected).files===0?<p className="atlas-detail-muted">这条灵感没有非图片文件。</p>:selected.attachments.filter(file=>!isImage(file)).map(file=><div key={file.id} className="atlas-attachment"><div className="atlas-file-preview"><FileText size={23}/><div><strong>{file.name}</strong><span>{(file.bytes/1024/1024).toFixed(2)} MB</span></div></div><a href={`${attachmentUrl(file.id)}?download=1`} download={file.name} aria-label={`下载 ${file.name}`}><ArrowDownToLine size={18}/></a></div>)}
      {imageCounts(selected).images>0&&<><h3>图片原件 · {imageCounts(selected).images}</h3><p className="atlas-detail-muted">已在正文中展示的图片按阅读顺序出现；未插入正文或暂不能预览的原件仍可在这里查看与下载。</p>{selected.attachments.filter(isImage).map(file=><div key={file.id} className="atlas-attachment">{isPreviewableImage(file)?<button type="button" className="atlas-attachment-preview" aria-label={`打开图片：${file.name}`} onClick={event=>{galleryTrigger.current=event.currentTarget;setGalleryId(file.id);}}><img src={attachmentUrl(file.id)} alt=""/><div><strong>{file.name}</strong><span>查看大图 · {(file.bytes/1024/1024).toFixed(2)} MB</span></div></button>:<div className="atlas-file-preview"><ImageIcon size={23}/><div><strong>{file.name}</strong><span>暂不支持安全预览，可下载原件 · {(file.bytes/1024/1024).toFixed(2)} MB</span></div></div>}<a href={`${attachmentUrl(file.id)}?download=1`} download={file.name} aria-label={`下载 ${file.name}`}><ArrowDownToLine size={18}/></a></div>)}</>}
      {linked.length>0&&<><h3>关联灵感</h3>{linked.map(link=>{const other=data?.ideas.find(item=>item.id===(link.fromId===selected.id?link.toId:link.fromId));return <div key={link.id} className="atlas-related"><button onClick={()=>other&&openDetail(other.id)}>{other?.title||"已移除的灵感"}</button><Button variant="ghost" size="icon-sm" aria-label="移除连线" onClick={()=>void removeLink(link)}><Unlink2 size={16}/></Button></div>;})}</>}<div className="atlas-detail-info"><h3>来源与记录信息</h3>{selected.sourceLabel&&<div className="atlas-detail-row"><span>来源</span><strong>{selected.sourceLabel}</strong></div>}{selected.sourceAt&&<div className="atlas-detail-row"><span>来源时间</span><strong>{selected.sourceAt}</strong></div>}{selected.sourceUrl&&<a className="atlas-source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={16}/> 打开来源链接</a>}{selected.tags.length>0&&<div className="atlas-detail-tags">{selected.tags.map(tag=><span key={tag}>{tag}</span>)}</div>}<div className="atlas-detail-row"><span>保存时间</span><strong>{niceDate(selected.createdAt)}</strong></div><div className="atlas-detail-row"><span>更新时间</span><strong>{niceDate(selected.updatedAt)}</strong></div><div className="atlas-share"><label htmlFor="inspiration-share-link">这条灵感的链接</label><div className="atlas-share-controls"><Input id="inspiration-share-link" ref={shareInputRef} value={shareUrl} readOnly aria-label="灵感链接" onFocus={event=>event.target.select()}/><Button variant="outline" disabled={!shareUrl} onClick={()=>void copyShareLink()}><Copy size={16}/>复制灵感链接</Button></div><p role="status" aria-live="polite">{shareFeedback?.url===shareUrl?shareFeedback.text:"链接用于定位这条记录，不授予访问权限。本机 AI 工具使用记录 ID。"}</p></div></div><div className="atlas-detail-actions"><Button onClick={()=>startEdit(selected)}>编辑与添加附件</Button><Button variant="outline" onClick={()=>{centerOn(selected);closeDetail();}}>定位到画布</Button><Button variant="ghost" onClick={()=>void archive(selected)}>{selected.archived?"恢复":"归档"}</Button></div></div>}</SheetContent></Sheet>
    {detailOpen&&selected&&galleryId&&<ImageGallery key={`${selected.id}:${galleryId}`} title={selected.title} images={images} initialId={galleryId} onClose={()=>setGalleryId(null)} returnFocus={galleryTrigger.current}/>}
  </div>;
}
