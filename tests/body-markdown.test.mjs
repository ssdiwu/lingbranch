import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Library } from '../server/library.mjs';
import { sha256, fingerprint } from '../server/validation.mjs';
import { restoreBundle, validateBundle, exportBundle } from '../server/bundle.mjs';
import * as md from '../server/markdown.mjs';

const key = () => randomUUID();
const png = (seed) => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), createHash('sha512').update(seed).digest()]);
const pdf = () => Buffer.from('%PDF-1.4\n% 自编测试 PDF\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n','utf8');

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(),'lingbranch-body-'));
  const library = new Library(join(directory,'library'));
  let closed=false;
  const close=()=>{if(!closed){closed=true;library.close();}};
  t.after(async() => { close(); await rm(directory,{recursive:true,force:true}); });
  return {directory,library,close};
}
async function attach(library, id, name, mimeType, bytes) {
  return library.addAttachment({id,name,mimeType,bytes:bytes.length,sha256:sha256(bytes),indexedText:'',idempotencyKey:key()},bytes);
}

test('图文正文：两图交错 + PDF 共用 Library 模块读写同一正文与格式',async t => {
  const {library} = await scratch(t);
  const idea = library.createIdea({title:'图文灵感',body:'',sourceLabel:'',sourceUrl:'',sourceAt:'',tags:['图文'],x:120,y:120,idempotencyKey:key()}).item;
  const first = await attach(library,idea.id,'shot-a.png','image/png',png('a'));
  const second = await attach(library,idea.id,'shot-b.png','image/png',png('b'));
  const doc = await attach(library,idea.id,'方案.pdf','application/pdf',pdf());
  const body = [
    '先看第一张截图的结论。',
    `![第一张](attachment:${first.attachment.id})`,
    '两张图之间的说明文字。',
    `![第二张](attachment:${second.attachment.id})`,
    '结尾补充。',
  ].join('\n\n');
  const saved = library.updateIdea({id:idea.id,expectedUpdatedAt:library.readIdea(idea.id).updatedAt,patch:{body,bodyFormat:'markdown'},idempotencyKey:key()}).item;

  assert.equal(saved.bodyFormat,'markdown');
  assert.equal(saved.body,body,'正文逐字保留');
  assert.deepEqual(saved.bodyImages.map(image => image.attachmentId),[first.attachment.id,second.attachment.id],'图片按正文顺序读回');
  assert.match(saved.summary,/第一张截图的结论/);
  assert.doesNotMatch(saved.summary,/attachment:/,'摘要不暴露引用标识');
  assert.equal(saved.attachments.length,3);
  const reread = library.readIdea(idea.id);
  assert.equal(reread.attachments.find(file => file.id === doc.attachment.id).sha256, sha256(pdf()),'PDF 原件校验一致');
  // 可读文字参与检索；引用标识本身不是用户内容
  assert.equal(library.listIdeas({query:'两张图之间的说明文字'}).items.length,1);
  assert.equal(library.listIdeas({query:'attachment:'}).items.length,0);
});

test('旧库默认纯文本：符号不被重新解释，正文逐字保留',async t => {
  const {library} = await scratch(t);
  const raw = '# 不是标题\n* 不是列表\n![也不是图片](attachment:00000000-0000-4000-8000-000000000000)';
  const idea = library.createIdea({title:'旧灵感',body:raw,idempotencyKey:key()}).item;
  assert.equal(idea.bodyFormat,'plain');
  assert.equal(idea.body,raw);
  assert.deepEqual(idea.bodyImages,[],'纯文本不产生正文图片');
  assert.equal(idea.summary,raw);
  // 不带 bodyFormat 的旧请求不改变请求摘要
  assert.equal(library.createIdea({title:'另一条',idempotencyKey:key()}).item.bodyFormat,'plain');
});

test('Markdown 代码示例不当作图片引用；失效、跨记录、外部与临时引用被拒绝',async t => {
  const {library} = await scratch(t);
  const idea = library.createIdea({title:'引用校验',body:'',idempotencyKey:key()}).item;
  const other = library.createIdea({title:'另一条',x:520,y:120,idempotencyKey:key()}).item;
  const mine = await attach(library,idea.id,'a.png','image/png',png('a'));
  const theirs = await attach(library,other.id,'b.png','image/png',png('b'));
  const version = () => library.readIdea(idea.id).updatedAt;
  const save = body => library.updateIdea({id:idea.id,expectedUpdatedAt:version(),patch:{body,bodyFormat:'markdown'},idempotencyKey:key()});

  // 代码围栏内的图片语法只作为代码文本
  const code = ['说明文字。','```md','`![图](attachment:'+mine.attachment.id+')`','```'].join('\n\n');
  const saved = save(code);
  assert.equal(saved.item.body,code);
  assert.deepEqual(saved.item.bodyImages,[],'代码块中的图片语法不产生引用');

  const reject = (body,fragment) => assert.throws(()=>save(body),error=>{
    assert.equal(error.code,'invalid_input');assert.match(error.message,fragment);return true;
  });
  reject(`![x](attachment:${randomUUID()})`,/不存在/);
  reject(`![x](attachment:${theirs.attachment.id})`,/不属于/);
  reject('![x](https://example.com/a.png)',/外部或临时/);
  reject('![x](blob:http://127.0.0.1/abc)',/外部或临时/);
  reject('![x](data:image/png;base64,AAAA)',/外部或临时/);
  reject('![x](/Users/someone/photo.png)',/本机目录/);
  reject('![x](attachment:../../etc/passwd)',/格式无效/);

  // 非图片附件不能作为正文图片
  const doc = await attach(library,idea.id,'方案.pdf','application/pdf',pdf());
  reject(`![x](attachment:${doc.attachment.id})`,/不是可预览的图片/);
});

test('Markdown 不执行 HTML，也不自动加载外部图片',() => {
  const html = '说明<br><script>alert(1)</script>\n\n<img src="https://example.com/track.png">';
  assert.equal(md.containsRawHtml(html),true,'识别出原始 HTML');
  const summary = md.readableSummary(html,'markdown');
  assert.doesNotMatch(summary,/<\/?\w+|example\.com/, '渲染标记与外链不进入可读摘要');
  assert.doesNotMatch(md.readableSummary('正文\n\n<a href="https://example.com/x">链接</a>','markdown'),/<a |https:\/\//);
  assert.equal(md.imageReferences(html).length,0,'原始 HTML 不被当作图片引用');
  assert.equal(md.imageReferences('![x](https://example.com/a.png)').length,1,'真实图片节点仍被识别');
});

test('分阶段保存：原件先落库，正文引用后提交；重复请求不重复创建',async t => {
  const {library} = await scratch(t);
  const idea = library.createIdea({title:'分阶段',body:'',idempotencyKey:key()}).item;
  const image = await attach(library,idea.id,'x.png','image/png',png('x'));
  // 原件已保存后才允许写入引用
  const key1 = key(), request = {id:idea.id,expectedUpdatedAt:library.readIdea(idea.id).updatedAt,
    patch:{body:`图\n\n![x](attachment:${image.attachment.id})`,bodyFormat:'markdown'},idempotencyKey:key1};
  const first = library.updateIdea(request);
  assert.equal(first.outcome,'updated');
  // 沿原请求重试：原参数重放读回同一条记录，不产生第二条记录或重复原件。
  const replay = library.updateIdea(request);
  assert.equal(replay.replayed,true);
  assert.equal(replay.item.body,first.item.body,'原请求重放读回同一条记录');
  assert.equal(library.readIdea(idea.id).attachments.length,1,'重试不产生重复原件');
});

test('旧请求重放：同标识同参数仍成功，格式字段不改变请求摘要',async t => {
  const {directory,library,close} = await scratch(t);
  const stable = key();
  const created = library.createIdea({title:'幂等',body:'旧正文',idempotencyKey:stable});
  close();
  const reopened = new Library(join(directory,'library'));
  t.after(() => reopened.close());
  const replayed = reopened.createIdea({title:'幂等',body:'旧正文',idempotencyKey:stable});
  assert.equal(replayed.replayed,true);
  assert.equal(replayed.outcome,'already_saved');
  assert.equal(replayed.item.id,created.item.id);
  assert.throws(() => reopened.createIdea({title:'不同内容',body:'旧正文',idempotencyKey:stable}), error => {
    assert.equal(error.code,'conflict'); return true;
  });
});

test('升级不改动旧库正文、附件与布局',async t => {
  const directory = await mkdtemp(join(tmpdir(),'lingbranch-legacy-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const path = join(directory,'library');
  // 构造 v1 旧库：没有 body_format 列
  const {DatabaseSync} = await import('node:sqlite');
  const {mkdirSync} = await import('node:fs');
  mkdirSync(path,{recursive:true});
  const db = new DatabaseSync(join(path,'library.sqlite'));
  db.exec(`CREATE TABLE ideas (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, body TEXT NOT NULL, source_label TEXT NOT NULL, source_url TEXT NOT NULL,
    source_at TEXT NOT NULL, tags_json TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
    archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL,
      bytes INTEGER NOT NULL, indexed_text TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE connections (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL);
    CREATE TABLE canvas (id INTEGER PRIMARY KEY CHECK(id=1), pan_x REAL NOT NULL, pan_y REAL NOT NULL, zoom REAL NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE receipts (key TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);
    INSERT INTO canvas VALUES(1,42,7,1.25,'2026-09-01T00:00:00.000Z');
    PRAGMA user_version=1;`);
  const old = randomUUID();
  db.prepare('INSERT INTO ideas(id,title,body,source_label,source_url,source_at,tags_json,x,y,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?)')
    .run(old,'旧记录','* 保留原样 # 不解释','旧来源','','2026-08-01','["旧标签"]',321,654,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z');
  db.close();

  const library = new Library(path);
  t.after(() => library.close());
  const idea = library.readIdea(old);
  assert.equal(idea.body,'* 保留原样 # 不解释');
  assert.equal(idea.bodyFormat,'plain');
  assert.deepEqual(idea.tags,['旧标签']);
  assert.equal(idea.x,321);assert.equal(idea.y,654);
  assert.equal(library.canvas().zoom,1.25);
});

test('资料包：旧包按原格式校验后补字段，新包含格式与引用并可隔离恢复',async t => {
  const {directory,library} = await scratch(t);
  const idea = library.createIdea({title:'导出源',body:'',idempotencyKey:key()}).item;
  const image = await attach(library,idea.id,'y.png','image/png',png('y'));
  library.updateIdea({id:idea.id,expectedUpdatedAt:library.readIdea(idea.id).updatedAt,
    patch:{body:`![y](attachment:${image.attachment.id})`,bodyFormat:'markdown'},idempotencyKey:key()});

  const bundle = await exportBundle(library);
  const restored = join(directory,'restored');
  const result = await restoreBundle(bundle,restored);
  assert.equal(result.outcome,'restored');
  const {Library:Reopened} = await import('../server/library.mjs');
  const after = new Reopened(restored);
  t.after(() => after.close());
  assert.equal(after.readIdea(idea.id).bodyFormat,'markdown');
  assert.equal(after.readIdea(idea.id).bodyImages[0].attachmentId,image.attachment.id);
  assert.equal(after.readIdea(idea.id).attachments.length,1);

  // 旧包：去掉 body_format 后仍按原格式校验通过，恢复为 plain
  const raw = JSON.parse((await import('node:zlib')).gunzipSync(bundle).toString('utf8'));
  assert.equal(raw.version,2,'新资料包明确使用版本2');
  raw.version=1;
  for (const row of raw.payload.snapshot.ideas) delete row.body_format;
  raw.sha256 = fingerprint(raw.payload);
  const legacy = gzipSync(Buffer.from(JSON.stringify(raw)));
  const legacyTarget = join(directory,'legacy');
  await restoreBundle(legacy,legacyTarget);
  const legacyLibrary = new Reopened(legacyTarget);
  t.after(() => legacyLibrary.close());
  assert.equal(legacyLibrary.readIdea(idea.id).bodyFormat,'plain');
  assert.equal(legacyLibrary.readIdea(idea.id).body,`![y](attachment:${image.attachment.id})`,'旧包正文不被重新解释');
  assert.throws(() => validateBundle(Buffer.from('not a bundle')), error => { assert.equal(error.code,'invalid_bundle'); return true; });
  await rm(restored,{recursive:true,force:true});
});

test('移除正文展示引用不删除原件',async t => {
  const {library} = await scratch(t);
  const idea = library.createIdea({title:'引用与原件',body:'',idempotencyKey:key()}).item;
  const image = await attach(library,idea.id,'z.png','image/png',png('z'));
  library.updateIdea({id:idea.id,expectedUpdatedAt:library.readIdea(idea.id).updatedAt,
    patch:{body:`![z](attachment:${image.attachment.id})`,bodyFormat:'markdown'},idempotencyKey:key()});
  const after = library.updateIdea({id:idea.id,expectedUpdatedAt:library.readIdea(idea.id).updatedAt,
    patch:{body:'不再展示这张图。',bodyFormat:'markdown'},idempotencyKey:key()}).item;
  assert.deepEqual(after.bodyImages,[]);
  assert.equal(after.attachments.length,1,'原件仍在且仍可访问');
  const {bytes} = await library.readAttachment(image.attachment.id);
  assert.equal(sha256(bytes),sha256(png('z')));
});
