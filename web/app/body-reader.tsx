import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, definitionMap, referencePattern, safeLinkUrl } from '../../shared/markdown.mjs';
import { attachmentUrl, isPreviewableImage, type Attachment } from '@/lib/idea-store';

type Node = {type:string;depth?:number;ordered?:boolean;start?:number;lang?:string|null;value?:string;url?:string;alt?:string;title?:string|null;identifier?:string;children?:Node[]};
type Context = {onImage:(id:string)=>void;files:Map<string,Attachment>;definitions:Map<string,{url:string;title?:string|null}>};

function children(parent:Node, context:Context):ReactNode[] {
  return (parent.children ?? []).map((node,index)=><Fragment key={index}>{one(node,context)}</Fragment>);
}
function one(node:Node, context:Context):ReactNode {
  switch(node.type) {
    case 'text': return node.value;
    case 'paragraph': return <div className="atlas-body-paragraph">{children(node,context)}</div>;
    case 'heading': {
      const Tag=`h${Math.min(6,Math.max(1,node.depth ?? 1))}` as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6';
      return <Tag>{children(node,context)}</Tag>;
    }
    case 'list': return node.ordered ? <ol start={node.start ?? 1}>{children(node,context)}</ol> : <ul>{children(node,context)}</ul>;
    case 'listItem': return <li>{children(node,context)}</li>;
    case 'blockquote': return <blockquote>{children(node,context)}</blockquote>;
    case 'strong': return <strong>{children(node,context)}</strong>;
    case 'emphasis': return <em>{children(node,context)}</em>;
    case 'code': return <pre data-language={node.lang ?? undefined}><code>{node.value}</code></pre>;
    case 'inlineCode': return <code>{node.value}</code>;
    case 'thematicBreak': return <hr/>;
    case 'break': return <br/>;
    case 'link': case 'linkReference': {
      const destination=node.type==='link' ? node.url : context.definitions.get(node.identifier ?? '')?.url;
      const url=safeLinkUrl(destination);
      return url ? <a href={url} target="_blank" rel="noreferrer noopener">{children(node,context)}</a> : <span>{children(node,context)}</span>;
    }
    case 'image': case 'imageReference': {
      const destination=node.type==='image' ? node.url : context.definitions.get(node.identifier ?? '')?.url;
      const caption=(node.type==='image'?node.title:context.definitions.get(node.identifier ?? '')?.title)||node.alt;
      const match=referencePattern.exec(destination ?? '');
      const file=match ? context.files.get(match[1].toLowerCase()) : undefined;
      if (!file || !isPreviewableImage(file)) return <span className="atlas-body-unsafe" role="note">图片引用不可用，未加载。</span>;
      return <figure className="atlas-body-image">
        <button type="button" onClick={()=>context.onImage(file.id)} aria-label={`查看大图：${node.alt || file.name}`}>
          <img src={attachmentUrl(file.id)} alt={node.alt || ''} loading="lazy"/>
        </button>
        {caption&&<figcaption>{caption}</figcaption>}
      </figure>;
    }
    case 'html': case 'definition': return null;
    default: return children(node,context);
  }
}

export function BodyReader({body,format,attachments,onImage}:{
  body:string;format:'plain'|'markdown';attachments:Attachment[];onImage:(id:string)=>void;
}) {
  if (format!=='markdown') return <div className="atlas-detail-body">{body || '尚未填写内容说明。'}</div>;
  const tree=parseMarkdown(body);
  const context={onImage,files:new Map(attachments.map(file=>[file.id.toLowerCase(),file])),definitions:definitionMap(tree)};
  return <div className="atlas-rich-body">{body ? children(tree as Node,context) : '尚未填写内容说明。'}</div>;
}
