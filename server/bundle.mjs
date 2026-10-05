import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, mkdir, mkdtemp, rename, rm, rmdir, lstat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { Library, validateFile } from './library.mjs';
import * as v from './validation.mjs';
import * as md from './markdown.mjs';

export const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
// 旧资料包没有 body_format：先按原格式校验通过，再补为 plain，不重新解释旧正文。
const legacyIdeaRow = z.object({seq:z.number().int().positive(),id:v.id,...{
  title:v.noteFields.title,body:v.noteFields.body,source_label:v.noteFields.sourceLabel,source_url:v.noteFields.sourceUrl,source_at:v.noteFields.sourceAt,
  tags_json:z.string().max(1000),x:v.coordinate,y:v.coordinate,archived:z.union([z.literal(0),z.literal(1)]),created_at:v.date,updated_at:v.date,
}}).strict();
const ideaRow = legacyIdeaRow.extend({body_format:v.bodyFormat}).strict();
const IDEA_COLUMNS = ['seq','id','title','body','body_format','source_label','source_url','source_at','tags_json','x','y','archived','created_at','updated_at'];
const attachmentRow = z.object({id:v.id,idea_id:v.id,name:v.attachmentInput.shape.name,mime_type:v.attachmentInput.shape.mimeType,bytes:v.attachmentInput.shape.bytes,indexed_text:v.attachmentInput.shape.indexedText,sha256:v.digest,created_at:v.date}).strict();
const snapshotSchema = (rows) => z.object({
  ideas:z.array(rows),attachments:z.array(attachmentRow),
  connections:z.array(z.object({id:v.id,from_id:v.id,to_id:v.id}).strict()),
  canvas:z.object({id:z.literal(1),pan_x:v.coordinate,pan_y:v.coordinate,zoom:z.number().min(.05).max(2.5),updated_at:v.date}).strict(),
  receipts:z.array(z.object({key:v.key,hash:v.digest,result:z.string()}).strict()),
}).strict();

export async function exportBundle(library) {
  const snapshot = library.snapshot(), blobs = {};
  let estimated = Buffer.byteLength(JSON.stringify(snapshot));
  for (const metadata of snapshot.attachments) {
    if (Object.hasOwn(blobs,metadata.sha256)) continue;
    estimated += Math.ceil(metadata.bytes / 3) * 4 + 100;
    if (estimated > MAX_BUNDLE_BYTES - 1024) v.fail('too_large','资料包超过首版 128 MiB 限制，导出未完成。',413);
    const {bytes} = await library.readAttachment(metadata.id);
    blobs[metadata.sha256] = bytes.toString('base64');
  }
  const payload = {snapshot,blobs};
  const bytes = Buffer.from(JSON.stringify({format:'lingbranch',version:2,sha256:v.fingerprint(payload),payload}));
  if (bytes.length > MAX_BUNDLE_BYTES) v.fail('too_large','资料包超过首版 128 MiB 限制。',413);
  return gzipSync(bytes);
}

export function validateBundle(bytes) {
  let object;
  try {
    if (bytes.length > MAX_BUNDLE_BYTES) throw new Error();
    object = JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_BUNDLE_BYTES}).toString('utf8'));
  } catch { v.fail('invalid_bundle','资料包损坏、格式无效或超过大小限制。'); }
  const schemaFor = version => z.object({format:z.literal('lingbranch'),version:z.literal(version),sha256:v.digest,
    payload:z.object({snapshot:snapshotSchema(version === 1 ? legacyIdeaRow : ideaRow),blobs:z.record(v.digest,z.string())}).strict()}).strict();
  const bundle = v.parse(z.union([schemaFor(1),schemaFor(2)]),object);
  if (v.fingerprint(bundle.payload) !== bundle.sha256) v.fail('integrity_error','资料包整体校验失败。');
  const {snapshot,blobs} = bundle.payload;
  const unique = (rows,key) => new Set(rows.map(row => row[key])).size === rows.length;
  for (const [rows,keys] of [[snapshot.ideas,['id','seq']],[snapshot.attachments,['id']],[snapshot.connections,['id']],[snapshot.receipts,['key']]]) {
    if (keys.some(key => !unique(rows,key))) v.fail('invalid_bundle','资料包包含重复标识。');
  }
  const ids = new Set(snapshot.ideas.map(row => row.id)), pairs = new Set(), used = new Set();
  for (const row of snapshot.ideas) {
    let tags; try { tags = JSON.parse(row.tags_json); } catch { v.fail('invalid_bundle','标签格式无效。'); }
    const parsed = v.parse(v.tags,tags);
    if (JSON.stringify(parsed) !== JSON.stringify(tags)) v.fail('invalid_bundle','标签含重复项或未规范化空白。');
    if (row.updated_at < row.created_at) v.fail('invalid_bundle','记录版本时间无效。');
    if (row.body_format === 'markdown') md.resolveBodyImages(row.body, snapshot.attachments.filter(file => file.idea_id === row.id)
      .map(file => ({id:file.id,ideaId:file.idea_id,name:file.name,mimeType:file.mime_type,bytes:file.bytes,indexedText:file.indexed_text,sha256:file.sha256,createdAt:file.created_at})));
  }
  for (const row of snapshot.connections) {
    const pair = `${row.from_id}:${row.to_id}`;
    if (!ids.has(row.from_id) || !ids.has(row.to_id) || row.from_id >= row.to_id || pairs.has(pair)) v.fail('invalid_bundle','连线关系无效。');
    pairs.add(pair);
  }
  const decoded = new Map();
  for (const row of snapshot.attachments) {
    if (!ids.has(row.idea_id) || !Object.hasOwn(blobs,row.sha256)) v.fail('invalid_bundle','附件归属或原件缺失。');
    const bytes = decoded.get(row.sha256) || Buffer.from(blobs[row.sha256],'base64');
    if (bytes.toString('base64') !== blobs[row.sha256]) v.fail('invalid_bundle','附件编码无效。');
    validateFile({bytes:row.bytes,sha256:row.sha256,mimeType:row.mime_type},bytes);
    decoded.set(row.sha256,bytes); used.add(row.sha256);
  }
  if (Object.keys(blobs).some(hash => !used.has(hash))) v.fail('invalid_bundle','资料包含未引用原件。');
  for (const row of snapshot.receipts) {
    let result;
    try { result = JSON.parse(row.result); } catch { v.fail('invalid_bundle','重试凭据无效。'); }
    if (!result || typeof result !== 'object' || !['created','updated','unchanged','renamed','removed'].includes(result.outcome) || result.replayed !== false) v.fail('invalid_bundle','重试凭据结果无效。');
    if (result.item && !ids.has(result.item.id)) v.fail('invalid_bundle','重试凭据引用不存在的灵感。');
    if (result.attachment && !snapshot.attachments.some(file => file.id === result.attachment.id)) v.fail('invalid_bundle','重试凭据引用不存在的附件。');
    if (result.item) {
      const format=md.normalizeFormat(result.item.bodyFormat);
      const owned=snapshot.attachments.filter(file=>file.idea_id===result.item.id);
      if (format==='markdown') md.resolveBodyImages(result.item.body,owned.map(file=>({id:file.id,name:file.name,mimeType:file.mime_type})));
      if (result.item.attachments?.some(file=>!owned.some(original=>original.id===file.id&&original.sha256===file.sha256))) {
        v.fail('invalid_bundle','重试凭据包含不属于该灵感的附件。');
      }
    }
  }
  return {snapshot,decoded};
}

export async function restoreBundle(bytes,destination) {
  const {snapshot,decoded} = validateBundle(bytes);
  const target = resolve(destination), parent = dirname(target);
  try { await lstat(target); v.fail('target_exists','恢复目标已存在，请选择一个新的目录；不会覆盖已有资料。',409); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(parent,{recursive:true,mode:0o700});
  const staging = await mkdtemp(join(parent,`.${basename(target)}-restore-`));
  let library, reserved = false;
  try {
    library = new Library(staging);
    for (const [hash,bytes] of decoded) await library.storeBytes(bytes,hash);
    library.transaction(() => {
      for (const [table,rows] of Object.entries(snapshot)) {
        if (table === 'canvas') { library.db.prepare('UPDATE canvas SET pan_x=?,pan_y=?,zoom=?,updated_at=? WHERE id=1').run(rows.pan_x,rows.pan_y,rows.zoom,rows.updated_at); continue; }
        if (!rows.length) continue;
        // 旧包补齐新列后再落库；列集合固定，避免同一批数据里列不一致。
        const columns = table === 'ideas' ? IDEA_COLUMNS : Object.keys(rows[0]);
        const statement = library.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (const row of rows) statement.run(...columns.map(key => (key === 'body_format' ? (row.body_format ?? 'plain') : row[key])));
      }
    });
    if (library.db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') v.fail('integrity_error','恢复后的数据库检查失败。');
    library.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); library.close(); library = null;
    // 占用目标目录后只替换自己创建的空目录；已有目录（包括空目录）一律拒绝。
    await mkdir(target,{mode:0o700}); reserved = true;
    await rename(staging,target); reserved = false;
    return {outcome:'restored',ideas:snapshot.ideas.length,attachments:snapshot.attachments.length,connections:snapshot.connections.length};
  } finally {
    library?.close();
    if (reserved) await rmdir(target);
    await rm(staging,{recursive:true,force:true});
  }
}

export async function readBundleFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) v.fail('invalid_bundle','请选择限制范围内的普通资料包文件。');
  return readFile(path);
}
