import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { visit } from 'unist-util-visit';

export const referencePattern = /^attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const identifier = value => String(value).toLowerCase().replace(/\s+/g, ' ');
export const parseMarkdown = body => fromMarkdown(String(body ?? ''));

export function definitionMap(tree) {
  const definitions = new Map();
  visit(tree, 'definition', node => {
    const key = identifier(node.identifier);
    if (!definitions.has(key)) definitions.set(key, node);
  });
  return definitions;
}

// 只处理真实图片节点与其定义；代码、普通链接和代码内的相同地址不参与替换。
export function imageNodes(body) {
  const tree = parseMarkdown(body), definitions = definitionMap(tree), images = [];
  visit(tree, node => {
    if (node.type === 'image') images.push({node, url:node.url, alt:node.alt ?? ''});
    if (node.type === 'imageReference') {
      const definition = definitions.get(identifier(node.identifier));
      if (definition) images.push({node, definition, url:definition.url, alt:node.alt ?? ''});
    }
  });
  return images;
}

export function replaceImageSources(body, replacements) {
  const edits = new Map();
  for (const image of imageNodes(body)) {
    const url = replacements.get(image.url);
    if (!url) continue;
    const node = image.definition ?? image.node;
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error('图片引用缺少文本位置。');
    const changed = {...node, url};
    const tree = {type:'root', children:node.type === 'definition' ? [changed] : [{type:'paragraph',children:[changed]}]};
    edits.set(start, {start,end,value:toMarkdown(tree).trimEnd()});
  }
  let result = body;
  for (const edit of [...edits.values()].sort((a,b) => b.start-a.start)) {
    result = result.slice(0,edit.start) + edit.value + result.slice(edit.end);
  }
  return result;
}

function imageText(alt,title) {
  return [alt,title].filter((value,index,values)=>value&&values.indexOf(value)===index).join(' ');
}
function textOf(node,definitions) {
  switch (node.type) {
    case 'text': case 'inlineCode': case 'code': return node.value ?? '';
    case 'image': return imageText(node.alt,node.title);
    case 'imageReference': return imageText(node.alt,definitions.get(identifier(node.identifier))?.title);
    case 'break': return '\n';
    case 'html': case 'definition': return '';
    default: {
      const block = ['root','blockquote','list','listItem'].includes(node.type);
      return (node.children ?? []).map(child=>textOf(child,definitions)).filter(value => !block || value !== '').join(block ? '\n\n' : '');
    }
  }
}
export const markdownText = body => {const tree=parseMarkdown(body);return textOf(tree,definitionMap(tree));};

// CommonMark 不承认段落末尾的孤硬换行。把真实空白字符编码为标准文本引用，
// 与编辑器共用此 handler；原有反斜杠和字面 '&#10;' 仍由 state.safe 正常转义。
export function exactTextHandler(node,_parent,state,info) {
  const pieces=node.value.split(/([ \t\r\n]+)/).filter(Boolean);
  const tracker=state.createTracker(info);
  let result='';
  for(let index=0;index<pieces.length;index++){
    const piece=pieces[index],white=/^[ \t\r\n]+$/.test(piece);
    const encode=white&&(/[\t\r\n]/.test(piece)||index===0||index===pieces.length-1);
    const next=pieces[index+1];
    const nextIsEncoded=next&&(/^[ \t\r\n]+$/.test(next))&&(/[\t\r\n]/.test(next)||index+1===pieces.length-1);
    const value=encode?[...piece].map(char=>`&#${char.codePointAt(0)};`).join(''):state.safe(piece,{
      ...tracker.current(),before:result?result.slice(-1):info.before,
      after:nextIsEncoded?'&':next?.[0]??info.after,encode:[],
    });
    tracker.move(value);result+=value;
  }
  return result;
}

// 一份文字节点保留全部字符；不生成无后继的尾部 break，不截掉用户空白。
export function plainToMarkdown(body) {
  if (!body) return '';
  return toMarkdown({type:'root',children:[{type:'paragraph',children:[{type:'text',value:body}]}]},
    {handlers:{text:exactTextHandler}}).replace(/\n$/,'');
}

export function safeLinkUrl(value) {
  const url = String(value ?? '').trim();
  if (!/^(https?:|mailto:)/i.test(url) || /[\u0000-\u0020\u007f]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'mailto:') return parsed.pathname ? url : null;
    return parsed.hostname ? url : null;
  } catch { return null; }
}
