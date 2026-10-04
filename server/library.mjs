import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import * as v from './validation.mjs';

const epoch = '1970-01-01T00:00:00.000Z';
const nextDate = previous => new Date(Math.max(Date.now(), Date.parse(previous || epoch) + 1)).toISOString();
const cardWidth = 324, cardHeight = 420;

// Ported from the pinned prototype: a new card never moves an existing card.
function freePosition(preferred, occupied) {
  const dx = preferred.x > 1_000_000 - 3 * cardWidth ? -1 : 1;
  const dy = preferred.y > 0 ? -1 : 1;
  for (let n = 0; n <= occupied.length * 9 + 4; n++) {
    const point = {x:preferred.x + dx * (n % 4) * cardWidth, y:preferred.y + dy * Math.floor(n / 4) * cardHeight};
    if (Math.abs(point.x) > 1_000_000 || Math.abs(point.y) > 1_000_000) continue;
    if (!occupied.some(other => Math.abs(point.x - other.x) < cardWidth && Math.abs(point.y - other.y) < cardHeight)) return point;
  }
  v.fail('conflict', '附近没有空位，请选择另一个位置。', 409);
}

export class Library {
  constructor(directory) {
    this.directory = resolve(directory);
    this.filesDirectory = join(this.directory, 'attachments');
    mkdirSync(this.filesDirectory, {recursive:true, mode:0o700});
    this.db = new DatabaseSync(join(this.directory, 'library.sqlite'), {timeout:5000});
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('资料库版本较新，请使用匹配的 LingBranch 版本。'); }
    if (version === 0) this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ideas (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL, body TEXT NOT NULL, source_label TEXT NOT NULL,
          source_url TEXT NOT NULL, source_at TEXT NOT NULL, tags_json TEXT NOT NULL,
          x REAL NOT NULL, y REAL NOT NULL, archived INTEGER NOT NULL CHECK(archived IN (0,1)),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY, idea_id TEXT NOT NULL REFERENCES ideas(id), name TEXT NOT NULL,
          mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, indexed_text TEXT NOT NULL,
          sha256 TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS attachments_idea ON attachments(idea_id);
        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES ideas(id),
          to_id TEXT NOT NULL REFERENCES ideas(id), UNIQUE(from_id,to_id), CHECK(from_id < to_id)
        );
        CREATE TABLE IF NOT EXISTS canvas (
          id INTEGER PRIMARY KEY CHECK(id=1), pan_x REAL NOT NULL, pan_y REAL NOT NULL,
          zoom REAL NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO canvas VALUES(1,0,0,1,'${epoch}');
        CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
    });
  }
  close() { this.db.close(); }
  transaction(action, write = true) {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  receipt(kind, input) {
    const hash = v.fingerprint({kind, input});
    const row = this.db.prepare('SELECT hash,result FROM receipts WHERE key=?').get(input.idempotencyKey);
    if (!row) return {hash};
    if (row.hash !== hash) v.fail('conflict', '该重试标识已用于不同操作或内容，请读取已保存结果。', 409);
    const result = JSON.parse(row.result);
    return {hash, result:{...result, replayed:true, outcome:result.outcome === 'created' ? (kind === 'attachment' ? 'already_attached' : 'already_saved') : result.outcome}};
  }
  mutate(kind, input, action) {
    return this.transaction(() => {
      const receipt = this.receipt(kind, input);
      if (receipt.result) return receipt.result;
      const result = {...action(), replayed:false};
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(input.idempotencyKey, receipt.hash, JSON.stringify(result));
      return result;
    });
  }
  attachmentFrom(row) {
    return {id:row.id, ideaId:row.idea_id, name:row.name, mimeType:row.mime_type, bytes:row.bytes,
      indexedText:row.indexed_text, sha256:row.sha256, createdAt:row.created_at};
  }
  ideaFrom(row) {
    return {id:row.id, title:row.title, body:row.body, sourceLabel:row.source_label, sourceUrl:row.source_url,
      sourceAt:row.source_at, tags:JSON.parse(row.tags_json), x:row.x, y:row.y, archived:!!row.archived,
      createdAt:row.created_at, updatedAt:row.updated_at,
      attachments:this.db.prepare('SELECT * FROM attachments WHERE idea_id=? ORDER BY created_at,id').all(row.id).map(file => this.attachmentFrom(file))};
  }
  readIdea(value) {
    const id = v.parse(v.id, value);
    const row = this.db.prepare('SELECT * FROM ideas WHERE id=?').get(id);
    if (!row) v.fail('not_found', '没有找到这条灵感。', 404);
    return this.ideaFrom(row);
  }
  canvas() {
    const row = this.db.prepare('SELECT * FROM canvas WHERE id=1').get();
    return {panX:row.pan_x, panY:row.pan_y, zoom:row.zoom, updatedAt:row.updated_at};
  }
  connections() {
    return this.db.prepare('SELECT id,from_id AS fromId,to_id AS toId FROM connections ORDER BY id').all();
  }
  atlas() {
    return this.transaction(() => ({ideas:this.db.prepare('SELECT * FROM ideas ORDER BY seq').all().map(row => this.ideaFrom(row)),
      connections:this.connections(), canvas:this.canvas()}), false);
  }
  createIdea(value) {
    const input = v.parse(v.create, value);
    return this.mutate('create', input, () => {
      const position = freePosition(input, this.db.prepare('SELECT x,y FROM ideas').all());
      const id = randomUUID(), now = nextDate();
      this.db.prepare(`INSERT INTO ideas(id,title,body,source_label,source_url,source_at,tags_json,x,y,archived,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,0,?,?)`).run(id,input.title,input.body,input.sourceLabel,input.sourceUrl,input.sourceAt,JSON.stringify(input.tags),position.x,position.y,now,now);
      return {outcome:'created', item:this.readIdea(id)};
    });
  }
  updateIdea(value) {
    const input = v.parse(v.update, value);
    return this.mutate('update', input, () => {
      const current = this.readIdea(input.id);
      // 必须先查版本再判无变化，避免过期草稿被误报为保存成功；原请求重试由凭据识别。
      if (input.expectedUpdatedAt !== current.updatedAt) v.fail('conflict', '灵感已被修改。草稿已保留，请重新读取并核对后保存。', 409);
      const changed = Object.entries(input.patch).some(([key, value]) => v.fingerprint(value) !== v.fingerprint(current[key]));
      if (!changed) return {outcome:'unchanged', item:current};
      const next = {...current, ...input.patch};
      this.db.prepare(`UPDATE ideas SET title=?,body=?,source_label=?,source_url=?,source_at=?,tags_json=?,x=?,y=?,archived=?,updated_at=? WHERE id=?`)
        .run(next.title,next.body,next.sourceLabel,next.sourceUrl,next.sourceAt,JSON.stringify(next.tags),next.x,next.y,Number(next.archived),nextDate(current.updatedAt),input.id);
      return {outcome:'updated', item:this.readIdea(input.id)};
    });
  }
  listIdeas(value = {}) {
    const input = v.parse(v.list, value);
    return this.transaction(() => {
      const scope = v.fingerprint({includeArchived:input.includeArchived, query:input.query, tag:input.tag});
      let after = 0, high = this.db.prepare('SELECT coalesce(max(seq),0) AS high FROM ideas').get().high;
      if (input.cursor) {
        let decoded;
        try { decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()); }
        catch { v.fail('invalid_input', '分页游标无效。'); }
        const cursor = v.parse(z.object({after:z.number().int().min(0), high:z.number().int().min(0), scope:v.digest}).strict(), decoded);
        if (cursor.scope !== scope || cursor.after > cursor.high) v.fail('invalid_input', '分页范围已变化，请从第一页重新读取。');
        ({after,high} = cursor);
      }
      const terms = input.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const rows = this.db.prepare('SELECT * FROM ideas WHERE seq<=? ORDER BY seq').all(high).filter(row => {
        if (!input.includeArchived && row.archived) return false;
        const tags = JSON.parse(row.tags_json);
        if (input.tag && !tags.includes(input.tag)) return false;
        if (!terms.length) return true;
        const files = this.db.prepare('SELECT name,indexed_text FROM attachments WHERE idea_id=?').all(row.id);
        const text = [row.title,row.body,row.source_label,row.source_url,...tags,...files.flatMap(f => [f.name,f.indexed_text])].join(' ').toLocaleLowerCase();
        return terms.every(term => text.includes(term));
      });
      const remaining = rows.filter(row => row.seq > after), selected = remaining.slice(0,input.limit);
      const hasMore = remaining.length > input.limit;
      return {items:selected.map(row => this.ideaFrom(row)), total:rows.length, count:selected.length,
        includeArchived:input.includeArchived, hasMore,
        nextCursor:hasMore ? Buffer.from(JSON.stringify({after:selected.at(-1).seq,high,scope})).toString('base64url') : null};
    }, false);
  }
  listTags(includeArchived = true) {
    v.parse(z.boolean(), includeArchived);
    const counts = new Map();
    for (const row of this.db.prepare('SELECT tags_json,archived FROM ideas').all()) {
      if (!includeArchived && row.archived) continue;
      for (const name of JSON.parse(row.tags_json)) {
        const result = counts.get(name) || {name, count:0, activeCount:0, archivedCount:0};
        result.count++; result[row.archived ? 'archivedCount' : 'activeCount']++; counts.set(name,result);
      }
    }
    return [...counts.values()].sort((a,b) => b.count-a.count || a.name.localeCompare(b.name,'zh-CN'));
  }
  changeTag(value, remove = false) {
    const input = v.parse(remove ? v.removeTag : v.rename, value);
    return this.mutate(remove ? 'remove_tag' : 'rename_tag',input,() => {
      const from = remove ? input.tag : input.fromTag;
      const affectedItems = [];
      for (const row of this.db.prepare('SELECT * FROM ideas ORDER BY seq').all()) {
        const tags = JSON.parse(row.tags_json);
        if (!tags.includes(from) || (!remove && from === input.toTag)) continue;
        const next = [...new Set(remove ? tags.filter(t => t !== from) : tags.map(t => t === from ? input.toTag : t))];
        const updatedAt = nextDate(row.updated_at);
        this.db.prepare('UPDATE ideas SET tags_json=?,updated_at=? WHERE id=?').run(JSON.stringify(next),updatedAt,row.id);
        affectedItems.push({id:row.id,tags:next,updatedAt});
      }
      return {outcome:affectedItems.length ? (remove ? 'removed' : 'renamed') : 'unchanged', affectedCount:affectedItems.length,affectedItems};
    });
  }
  connect(value) {
    const input = v.parse(z.object({fromId:v.id,toId:v.id}).strict(),value);
    if (input.fromId === input.toId) v.fail('invalid_input','请选择两条不同的灵感。');
    return this.transaction(() => {
      if (this.readIdea(input.fromId).archived || this.readIdea(input.toId).archived) v.fail('invalid_input','只能连接未归档灵感。');
      const [from,to] = [input.fromId,input.toId].sort();
      const existing = this.db.prepare('SELECT id,from_id AS fromId,to_id AS toId FROM connections WHERE from_id=? AND to_id=?').get(from,to);
      if (existing) return {outcome:'already_connected', connection:existing};
      const connection = {id:randomUUID(),fromId:from,toId:to};
      this.db.prepare('INSERT INTO connections VALUES(?,?,?)').run(connection.id,from,to);
      return {outcome:'created',connection};
    });
  }
  listConnections(id) {
    this.readIdea(id);
    return this.connections().filter(link => link.fromId === id || link.toId === id);
  }
  removeConnection(value) {
    const id = v.parse(v.id,value);
    const result = this.db.prepare('DELETE FROM connections WHERE id=?').run(id);
    return {outcome:result.changes ? 'removed' : 'unchanged',connectionId:id};
  }
  saveCanvas(value) {
    const input = v.parse(v.canvas,value);
    return this.mutate('canvas',input,() => {
      const current = this.canvas();
      if (current.updatedAt !== input.expectedUpdatedAt) v.fail('conflict','画布视野已变化，请刷新后重试。',409);
      if (current.panX === input.panX && current.panY === input.panY && current.zoom === input.zoom) return {outcome:'unchanged',canvas:current};
      this.db.prepare('UPDATE canvas SET pan_x=?,pan_y=?,zoom=?,updated_at=? WHERE id=1').run(input.panX,input.panY,input.zoom,nextDate(current.updatedAt));
      return {outcome:'updated',canvas:this.canvas()};
    });
  }
  async storeBytes(bytes, hash) {
    const destination = join(this.filesDirectory,hash);
    try {
      const stat = await lstat(destination);
      if (!stat.isFile() || v.sha256(await readFile(destination)) !== hash) v.fail('integrity_error','已保存的附件原件损坏，请先检查资料库。',503);
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = join(this.filesDirectory,`.upload-${randomUUID()}`);
    try {
      const file = await open(temporary,'wx',0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await rename(temporary,destination);
      const directory = await open(this.filesDirectory,'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async addAttachment(value, bytes) {
    const input = v.parse(v.attachmentInput,value);
    validateFile(input,bytes);
    this.readIdea(input.id);
    const prior = this.receipt('attachment',input);
    if (prior.result) { await this.readAttachment(prior.result.attachment.id); return prior.result; }
    // 先落完整原件，再在事务中落元数据；进程中断时只可能留下无引用文件，可安全重试。
    await this.storeBytes(bytes,input.sha256);
    return this.mutate('attachment',input,() => {
      this.readIdea(input.id);
      const attachment = {id:randomUUID(),ideaId:input.id,name:input.name,mimeType:input.mimeType,bytes:input.bytes,
        indexedText:input.indexedText,sha256:input.sha256,createdAt:nextDate()};
      this.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').run(attachment.id,attachment.ideaId,attachment.name,attachment.mimeType,attachment.bytes,attachment.indexedText,attachment.sha256,attachment.createdAt);
      return {outcome:'created',attachment};
    });
  }
  async readAttachment(value) {
    const id = v.parse(v.id,value);
    const row = this.db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
    if (!row) v.fail('not_found','没有找到附件。',404);
    const metadata = this.attachmentFrom(row);
    let bytes;
    try { bytes = await readFile(join(this.filesDirectory,metadata.sha256)); }
    catch { v.fail('integrity_error','附件原件缺失或无法读取，请检查存储。',503); }
    if (bytes.length !== metadata.bytes || v.sha256(bytes) !== metadata.sha256) v.fail('integrity_error','附件原件校验失败，未返回损坏内容。',503);
    return {metadata,bytes};
  }
  snapshot() {
    return this.transaction(() => ({
      ideas:this.db.prepare('SELECT * FROM ideas ORDER BY seq').all(), attachments:this.db.prepare('SELECT * FROM attachments ORDER BY id').all(),
      connections:this.db.prepare('SELECT * FROM connections ORDER BY id').all(), canvas:this.db.prepare('SELECT * FROM canvas WHERE id=1').get(),
      receipts:this.db.prepare('SELECT * FROM receipts ORDER BY key').all(),
    }),false);
  }
}

export function validateFile(metadata,bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length !== metadata.bytes || v.sha256(bytes) !== metadata.sha256) v.fail('integrity_error','附件字节数或 SHA-256 校验不一致。');
  const signature = bytes.subarray(0,16);
  const type = metadata.mimeType;
  const signatures = {
    'image/png':() => signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/jpeg':() => signature[0] === 255 && signature[1] === 216 && signature[2] === 255,
    'image/gif':() => /^GIF8[79]a/.test(signature.toString('ascii')),
    'image/webp':() => signature.toString('ascii',0,4) === 'RIFF' && signature.toString('ascii',8,12) === 'WEBP',
    'application/pdf':() => signature.toString('ascii',0,5) === '%PDF-',
  };
  if (signatures[type] && !signatures[type]()) v.fail('invalid_input','文件内容与声明的类型不一致。');
  if (type.startsWith('text/') || type === 'application/json') {
    try { new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
    catch { v.fail('invalid_input','文本附件需要使用 UTF-8 编码。'); }
  }
}
