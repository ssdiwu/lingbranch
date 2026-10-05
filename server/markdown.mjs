import { visit } from 'unist-util-visit';
import { z } from 'zod';
import * as v from './validation.mjs';
import { parseMarkdown, imageNodes, markdownText, referencePattern } from '../shared/markdown.mjs';

// 正文里的图片使用稳定资源标识，而不是临时预览地址、字节编码或部署域名。
export { referencePattern };
export const PREVIEWABLE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
export const bodyFormats = ['plain', 'markdown'];

// 旧库默认纯文本；旧正文里的 * # []() 只按字面保留，不因升级重新解释。
export function normalizeFormat(value) {
  if (value === undefined || value === null || value === '') return 'plain';
  return v.parse(z.enum(bodyFormats), value);
}

export function isMarkdown(format) { return format === 'markdown'; }

// 真实 Markdown AST：代码块与行内代码是独立节点，图片语法只出现在 image/imageReference 节点。
export function parseBody(body) {
  return parseMarkdown(body);
}

// 按正文出现顺序收集图片引用，附带同一段落内的说明文字与 alt。
export function imageReferences(body) {
  return imageNodes(body).map(({url,alt}) => ({url,alt}));
}

// 校验正文中的展示引用：必须存在、属于当前灵感、允许安全图片预览。
// 外部、临时、blob/data、本机绝对路径和普通来源链接都不是正文图片来源。
export function resolveBodyImages(body, attachments) {
  const owned = new Map(attachments.map(file => [file.id.toLowerCase(), file]));
  const images = [];
  for (const image of imageReferences(body)) {
    const url = image.url.trim();
    const match = referencePattern.exec(url);
    if (!match) {
      if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) v.fail('invalid_input', '正文图片必须是本资料库已保存的附件引用，不接受外部或临时地址。');
      if (url.startsWith('/') || url.startsWith('file:') || /^[A-Za-z]:[\\/]/.test(url)) v.fail('invalid_input', '正文图片不能使用本机目录或部署地址作为来源。');
      v.fail('invalid_input', '正文图片引用格式无效，请使用编辑器插入的附件引用。');
    }
    const id = match[1].toLowerCase();
    const file = owned.get(id);
    if (!file) v.fail('invalid_input', '正文引用了不存在或不属于这条灵感的图片，请先上传该图片。');
    if (!PREVIEWABLE_IMAGE.test(file.mimeType)) v.fail('invalid_input', `附件 ${file.name} 不是可预览的图片格式，不能作为正文图片。`);
    images.push({ attachmentId: id, name: file.name, alt: image.alt, mimeType: file.mimeType });
  }
  return images;
}

// 网页与 AI 共用的可读摘要与检索口径：去渲染标记，保留文字、标题、说明、链接文字与图片 alt。
export function readableSummary(body, format, limit = 200) {
  // 纯文本旧正文逐字保留，只截断不折叠；Markdown 才去掉渲染标记后按可读文字摘要。
  if (!isMarkdown(format)) {
    const raw = String(body ?? '');
    return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
  }
  const collapsed = markdownText(body).replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

// Markdown 正文不做 HTML/脚本执行，也不自动加载外部图片：这里只产出结构，渲染端另行落实。
export function containsRawHtml(body) {
  let found = false;
  visit(parseBody(body), node => { if (node.type === 'html') found = true; });
  return found;
}
