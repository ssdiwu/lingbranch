import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { paragraphSchema, hardbreakSchema, remarkLineBreak } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { exactTextHandler, imageNodes, referencePattern } from '../../shared/markdown.mjs';
import { imageInsertionTransaction } from '@/lib/editor-image-insertion.mjs';
import { attachmentUrl, isPreviewableImage, type Attachment } from '@/lib/idea-store';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/frame-dark.css';

export type DraftImage = {url:string;file:File};
export type BodyEditorHandle = {getMarkdown:()=>string;getDraftImages:()=>DraftImage[];setReadonly:(value:boolean)=>void};

export default forwardRef<BodyEditorHandle,{
  value:string;attachments:Attachment[];readOnly:boolean;
  onChange:(markdown:string)=>void;onDraftImage:(images:DraftImage[])=>void;
  onReady:(ready:boolean)=>void;onError:(message:string)=>void;
}>(function BodyEditor({value,attachments,readOnly,onChange,onDraftImage,onReady,onError},ref) {
  const host = useRef<HTMLDivElement>(null),editor = useRef<CrepeBuilder|null>(null);
  const draft = useRef(new Map<string,File>()),current = useRef(value),locked = useRef(readOnly);
  const readBody=useRef<()=>string>(()=>value);
  const imageInput=useRef<HTMLInputElement>(null),insertFiles=useRef<((files:File[])=>Promise<void>)|null>(null);
  const callbacks = useRef({onChange,onDraftImage,onReady,onError});
  callbacks.current = {onChange,onDraftImage,onReady,onError};
  const owned = useRef(attachments); owned.current = attachments;
  useImperativeHandle(ref,() => ({
    getMarkdown:() => readBody.current(),
    getDraftImages:() => {
      const body=readBody.current();
      const used=new Set(imageNodes(body).map(image=>image.url));
      return [...draft.current].filter(([url])=>used.has(url)).map(([url,file])=>({url,file}));
    },
    setReadonly:next => {locked.current=next;editor.current?.setReadonly(next);},
  }),[]);
  useLayoutEffect(() => {locked.current=readOnly;editor.current?.setReadonly(readOnly);},[readOnly]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true,ready=false,initialCanonical='';
    const images=new Map<string,File>();draft.current=images;
    const root = document.createElement('div'); container.append(root);
    callbacks.current.onReady(false);
    const publish = (markdown:string) => {
      const used = new Set(imageNodes(markdown).map(image => image.url));
      callbacks.current.onDraftImage([...images].filter(([url])=>used.has(url)).map(([url,file])=>({url,file})));
    };
    const register = async (file:File) => {
      if (!active || locked.current) throw new Error('保存期间不能插入图片。');
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || !file.size || file.size>20*1024*1024) {
        callbacks.current.onError('正文图片须为 PNG、JPEG、GIF 或 WebP，大小为 1 字节至 20 MiB。');
        throw new Error('图片格式或大小不支持。');
      }
      const url=URL.createObjectURL(file);images.set(url,file);
      return url;
    };
    const proxyDomURL = (url:string) => {
      const match=referencePattern.exec(url);
      if (match) {
        const file=owned.current.find(file=>file.id.toLowerCase()===match[1].toLowerCase()&&isPreviewableImage(file));
        return file ? attachmentUrl(file.id) : '';
      }
      return images.has(url) ? url : '';
    };
    const instance = new CrepeBuilder({root,defaultValue:value})
      .addFeature(imageBlock,{
        onUpload:register,inlineOnUpload:register,blockOnUpload:register,proxyDomURL,
        inlineUploadButton:'选择图片',inlineConfirmButton:'插入',inlineUploadPlaceholderText:'请上传本机图片',
        blockUploadButton:'选择图片',blockConfirmButton:'插入',blockUploadPlaceholderText:'请上传本机图片',
        blockCaptionPlaceholderText:'图片说明',onImageLoadError:()=>{},
      })
      .addFeature(blockEdit,{
        textGroup:{label:'文字',text:{label:'段落'},h1:{label:'一级标题'},h2:{label:'二级标题'},h3:{label:'三级标题'},
          h4:null,h5:null,h6:null,quote:{label:'引用'},divider:{label:'分隔线'}},
        listGroup:{label:'列表',bulletList:{label:'无序列表'},orderedList:{label:'有序列表'},taskList:null},
        advancedGroup:{label:'插入',image:{label:'图片'},codeBlock:{label:'代码块'},table:null,math:null},
      })
      .addFeature(listItem)
      .addFeature(linkTooltip,{inputPlaceholder:'输入 https:// 或 mailto: 链接'})
      .addFeature(placeholder,{text:'写下想法，可用 / 插入标题、列表或图片。'})
      .addFeature(toolbar,{boldLabel:'粗体',italicLabel:'斜体',codeLabel:'行内代码',linkLabel:'链接',
        buildToolbar:builder=>{
          const group=builder.getGroup('formatting').group;
          group.label='排版';group.items=group.items.filter(item=>item.key!=='strikethrough');
          builder.getGroup('function').group.label='插入';
        },
      })
      .addFeature(cursor);
    // Builder 默认 GFM 会把旧文字裸 URL 后的硬换行反斜杠当作链接内容。
    // 只保留已确认的 CommonMark 能力，与共用解析器保持同一语法。
    instance.editor.remove(gfm);
    instance.editor.remove(remarkLineBreak);
    instance.editor.config(ctx=>{
      ctx.update(remarkStringifyOptionsCtx,options=>({...options,handlers:{...options.handlers,text:exactTextHandler}}));
      ctx.update(hardbreakSchema.key,previous=>schemaContext=>({...previous(schemaContext),
        toMarkdown:{match:node=>node.type.name==='hardbreak',runner:state=>{state.addNode('text',undefined,'\n');}},
      }));
      ctx.update(editorViewOptionsCtx,options=>({...options,attributes:state=>({
        ...(typeof options.attributes==='function'?options.attributes(state):options.attributes),
        role:'textbox','aria-label':'图文正文','aria-multiline':'true',
      })}));
    });
    // 初始 value 是已读回的唯一正式正文；派生的规范序列只用于判断是否编辑过。
    // 未变化（包括撤销回初态）沿用 value，避免无操作保存改写原 Markdown。
    const read=()=>{
      if(!ready)return value;
      const canonical=instance.getMarkdown();
      return canonical===initialCanonical?value:canonical;
    };
    readBody.current=read;
    // 官方 image-block 默认把 alt 用作缩放比。通过公开 schema 配置保留标准图片说明。
    instance.editor.config(ctx=>ctx.update(imageBlockSchema.key,previous=>schemaContext=>{
      const spec=previous(schemaContext);
      return {...spec,attrs:{...spec.attrs,alt:{default:'',validate:'string'},hasTitle:{default:false,validate:'boolean'}},
        parseMarkdown:{match:({type})=>type==='image-block',runner:(state,node,type)=>{
          state.addNode(type,{src:node.url,alt:node.alt??'',caption:node.title??node.alt??'',hasTitle:node.title!=null,ratio:1});
        }},
        toMarkdown:{match:node=>node.type.name==='image-block',runner:(state,node)=>{
          state.openNode('paragraph');
          state.addNode('image',undefined,undefined,{url:node.attrs.src,
            alt:node.attrs.hasTitle?node.attrs.alt:node.attrs.caption,title:node.attrs.hasTitle?node.attrs.caption:null});
          state.closeNode();
        }},
      };
    }));
    insertFiles.current=async files=>{
      if(!active||locked.current)return;
      callbacks.current.onReady(false);
      try{
        for(const file of files){
          const url=await register(file);if(!active||locked.current)return;
          instance.editor.action(ctx=>{
            const view=ctx.get(editorViewCtx);
            const picture=imageBlockSchema.type(ctx).createChecked({src:url,caption:file.name,alt:file.name,hasTitle:false,ratio:1});
            view.dispatch(imageInsertionTransaction(view.state,picture,paragraphSchema.type(ctx)));
          });
          if(!imageNodes(instance.getMarkdown()).some(image=>image.url===url))throw new Error('图片未能插入正文，草稿原文已保留；请重试。');
        }
        instance.editor.action(ctx=>ctx.get(editorViewCtx).focus());
        current.current=read();callbacks.current.onChange(current.current);publish(current.current);
      }catch(reason){if(active)callbacks.current.onError(reason instanceof Error?reason.message:'插入图片失败，请重试。');}
      finally{if(active)callbacks.current.onReady(true);}
    };
    instance.on(api=>api.markdownUpdated((_ctx,markdown)=>{
      if (!active||!ready) return;
      current.current=read();
      if (!locked.current) callbacks.current.onChange(current.current);
      publish(current.current);
    }));
    instance.setReadonly(locked.current);
    editor.current=instance;
    const creation=instance.create().then(()=>{
      if (!active) return;
      instance.setReadonly(locked.current);
      initialCanonical=instance.getMarkdown();ready=true;current.current=read();
      callbacks.current.onChange(current.current);publish(current.current);callbacks.current.onReady(true);
    }).catch(error=>{if(active)callbacks.current.onError(`正文编辑器启动失败：${(error as Error).message}`);});
    return()=>{
      active=false;ready=false;if(editor.current===instance)editor.current=null;
      readBody.current=()=>current.current;
      insertFiles.current=null;
      callbacks.current.onReady(false);
      void creation.finally(()=>instance.destroy().catch(()=>{})).finally(()=>{
        root.remove();for(const url of images.keys())URL.revokeObjectURL(url);images.clear();
      });
    };
  },[]);

  return <div className="atlas-editor-host" aria-label="图文正文编辑器">
    <div className="atlas-editor-tools"><button type="button" disabled={readOnly||!insertFiles.current} onClick={()=>imageInput.current?.click()}>插入图片</button>
      <input ref={imageInput} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" className="atlas-image-input" aria-label="选择正文图片" disabled={readOnly} onChange={event=>{
        const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';void insertFiles.current?.(files);
      }}/>
    </div>
    <p className="atlas-editor-hint">用 / 插入图片与排版；移除图片位置保留已保存原件。保存期间暂停编辑。</p>
    <div ref={host}/>
  </div>;
});
