import {MIN_CANVAS_ZOOM} from "../shared/relationship-layout.mjs";
import { z } from 'zod';
import { createHash } from 'node:crypto';

export class LibraryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const fail = (code, message, status) => { throw new LibraryError(code, message, status); };
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail('invalid_input', result.error.issues.map(x => `${x.path.join('.') || '参数'}: ${x.message}`).join('; '));
  return result.data;
}
export const id = z.string().uuid();
export const key = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
export const date = z.string().datetime();
export const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const tag = z.string().trim().min(1).max(40);
export const tags = z.array(tag).max(12).transform(items => [...new Set(items)]);
const sourceUrl = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, '来源链接必须是 HTTP 或 HTTPS 地址');
export const noteFields = {
  title:z.string().trim().min(1).max(200), body:z.string().max(50000),
  sourceLabel:z.string().trim().max(200), sourceUrl, sourceAt:z.string().trim().max(100), tags,
};
// bodyFormat 保持可选且无默认：旧请求不新增字段，标准化输入与已保存 receipt 的请求摘要保持不变。
export const bodyFormat = z.enum(['plain', 'markdown']);
export const patch = z.object({...noteFields, bodyFormat, x:coordinate, y:coordinate, archived:z.boolean()}).partial().strict().refine(value => Object.keys(value).length > 0, '至少提供一个字段');
export const create = z.object({
  title:noteFields.title, body:noteFields.body.default(''), bodyFormat:bodyFormat.optional(), sourceLabel:noteFields.sourceLabel.default(''),
  sourceUrl:sourceUrl.default(''), sourceAt:noteFields.sourceAt.default(''), tags:tags.default([]),
  x:coordinate.default(120), y:coordinate.default(120), idempotencyKey:key,
}).strict();
export const update = z.object({id, expectedUpdatedAt:date, patch, idempotencyKey:key}).strict();
export const list = z.object({includeArchived:z.boolean().default(true), limit:z.number().int().min(1).max(50).default(50), cursor:z.string().max(2048).optional(), query:z.string().trim().max(200).default(''), tag:tag.optional()}).strict();
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const attachmentInput = z.object({
  id, name:z.string().trim().min(1).max(200).refine(x => !/[\x00-\x1f]/.test(x), '文件名含控制字符'),
  mimeType:z.string().max(120).regex(/^[\w.+-]+\/[\w.+-]+$/),
  bytes:z.number().int().min(1).max(MAX_ATTACHMENT_BYTES), sha256:digest,
  indexedText:z.string().max(100000).default(''), idempotencyKey:key,
}).strict();
export const canvas = z.object({panX:coordinate, panY:coordinate, zoom:z.number().min(MIN_CANVAS_ZOOM).max(2.5), expectedUpdatedAt:date, idempotencyKey:key}).strict();
export const rename = z.object({fromTag:tag, toTag:tag, idempotencyKey:key}).strict();
export const removeTag = z.object({tag, idempotencyKey:key}).strict();
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const fingerprint = value => sha256(JSON.stringify(canonical(value)));
