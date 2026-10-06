import {ArrowUpRight,FileText,Image as ImageIcon,X} from 'lucide-react';
import {attachmentUrl,coverImage,imageCounts,type Idea} from '@/lib/idea-store';
import {previewPosition} from '../../shared/relationship-layout.mjs';

export default function RelationshipPreview({idea,point,transform,viewport,onOpen,onClose}:{
  idea:Idea;point:{x:number;y:number};transform:{panX:number;panY:number;zoom:number};viewport:{width:number;height:number};onOpen:()=>void;onClose:()=>void;
}) {
  const position=previewPosition(point,transform,viewport),cover=coverImage(idea),counts=imageCounts(idea);
  return <aside className="atlas-preview" aria-label="灵感卡片预览" style={{left:position.left,top:position.top,width:position.width}}>
    <button className="atlas-preview-close" onClick={onClose} aria-label="收起卡片"><X size={16}/></button>
    <button className="atlas-card atlas-preview-card" style={{width:position.width,height:position.height}} autoFocus onClick={onOpen} aria-label={`打开详情：${idea.title}`}>
      <div className="atlas-card-body">
        {cover&&<img className="atlas-card-image" src={attachmentUrl(cover.id)} alt="" draggable={false}/>}
        <h2>{idea.title}</h2>
        <p>{idea.summary||idea.sourceLabel||(counts.total?idea.attachments.map(file=>file.name).join('、'):'打开查看内容')}</p>
        {idea.tags.length>0&&<div className="atlas-card-tags">{idea.tags.slice(0,3).map(tag=><span key={tag}>{tag}</span>)}</div>}
      </div>
      <div className="atlas-preview-foot">
        <div className="atlas-card-meta">
          {idea.archived&&<span className="atlas-card-state">已归档</span>}
          {counts.images>0&&<span><ImageIcon size={13}/>{counts.images} 图</span>}
          {counts.files>0&&<span><FileText size={13}/>{counts.files} 文件</span>}
          <time>{new Date(idea.updatedAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</time>
        </div>
        <span className="atlas-preview-open">打开完整详情 <ArrowUpRight size={15}/></span>
      </div>
    </button>
  </aside>;
}
