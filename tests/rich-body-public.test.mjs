import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApplication } from '../server/http.mjs';
import { projectRoot } from '../server/config.mjs';
import { fingerprint, sha256 } from '../server/validation.mjs';
import { validateBundle, restoreBundle } from '../server/bundle.mjs';
import { createSaveSession, acknowledgeVersion, saveInspiration } from '../shared/save-inspiration.mjs';
import { plainToMarkdown, markdownText, imageNodes, replaceImageSources, safeLinkUrl } from '../shared/markdown.mjs';
import { matchesIdea } from '../web/lib/atlas-view.ts';

const execFile=promisify(execFileCallback), key=()=>randomUUID();
const png=seed=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),createHash('sha512').update(seed).digest()]);
const file=(name,mime,bytes)=>new File([bytes],name,{type:mime});
const snapshot=(extra={})=>({title:'自编图文',body:'正文',bodyFormat:'markdown',sourceLabel:'自编',sourceUrl:'',sourceAt:'',tags:['图文'],indexNote:'',files:[],drafts:[],...extra});

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'lingbranch-rich-public-'));
  const config={mode:'local',host:'127.0.0.1',port:0,origin:'http://127.0.0.1:0',dataDir:join(directory,'library'),token:''};
  let app,clients=[];
  const start=async()=>{
    app=await createApplication(config);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    config.port=app.server.address().port;config.origin=`http://127.0.0.1:${config.port}`;
  };
  await start();
  t.after(async()=>{for(const client of clients)await client.close();await app.close();await rm(directory,{recursive:true,force:true});});
  const request=async(path,{method='GET',body}={})=>{
    const response=await fetch(config.origin+path,{method,headers:{'X-LingBranch-Request':'1',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.error),{code:value.code,status:response.status});
    return value;
  };
  const io={
    key,hash:async file=>sha256(Buffer.from(await file.arrayBuffer())),index:async()=>'',
    create:body=>request('/api/atlas',{method:'POST',body}),
    upload:async({id,file,...fields})=>{
      const form=new FormData();form.append('file',file);for(const [name,value]of Object.entries(fields))form.append(name,value);
      const response=await fetch(`${config.origin}/api/ideas/${id}/attachments`,{method:'POST',headers:{'X-LingBranch-Request':'1'},body:form});
      const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error),{code:value.code,status:response.status});return value;
    },
    update:({id,patch,...fields})=>request(`/api/ideas/${id}`,{method:'PATCH',body:{...fields,...patch}}),
    read:id=>request(`/api/ideas/${id}`),
  };
  const cli=async(...args)=>JSON.parse((await execFile(process.execPath,[join(projectRoot,'cli/lingbranch.mjs'),'--data-dir',config.dataDir,...args],{cwd:tmpdir(),maxBuffer:2*1024*1024})).stdout);
  const mcp=async()=>{
    const client=new Client({name:'lingbranch-rich-body-test',version:'1.0.0'});
    const transport=new StdioClientTransport({command:process.execPath,args:[join(projectRoot,'server/mcp.mjs')],cwd:tmpdir(),env:{...process.env,LINGBRANCH_DATA_DIR:config.dataDir},stderr:'pipe'});
    transport.stderr?.on('data',()=>{});await client.connect(transport);clients.push(client);
    return async(name,args)=>{const result=await client.callTool({name,arguments:args});return {...JSON.parse(result.content[0].text),isError:result.isError??false};};
  };
  return {directory,config,request,io,cli,mcp,get app(){return app;},async restart(){await app.close();await start();}};
}

test('HTTP 图文保存 → CLI/MCP 共同更新 → 原件校验 → 重启 → 导出和 CLI 隔离恢复',async t=>{
  const f=await fixture(t);
  const old=await f.io.create({title:'旧位置',body:'保持',x:88,y:144,idempotencyKey:key()});
  const first=file('第一张.png','image/png',png('first')),second=file('第二张.png','image/png',png('second'));
  const pdf=file('自编方案.pdf','application/pdf',Buffer.from('%PDF-1.4\n自编文件\n%%EOF\n'));
  const draft=snapshot({body:'前**重点**后。\n\n![第一张](blob:first)\n\n两图之间说明。\n\n![第二张][shot]\n\n[shot]: blob:second\n\n结尾。',files:[pdf],drafts:[{url:'blob:first',file:first},{url:'blob:second',file:second}]});
  const {item}=await saveInspiration(createSaveSession(),draft,f.io);
  assert.equal(item.bodyFormat,'markdown');assert.equal(item.attachments.length,3);assert.equal(item.bodyImages.length,2);
  assert.match(item.summary,/前重点后/);assert.doesNotMatch(item.body,/blob:/);assert.doesNotMatch(item.summary,/attachment:/);
  assert.equal(matchesIdea(item,'前重点后'),true,'网页筛选与 HTTP 使用同一可读文字');
  assert.equal(matchesIdea(item,'attachment:'),false,'网页不检索真实图片的内部引用');
  assert.equal((await f.request('/api/list?query=前重点后')).items[0].id,item.id);
  const linked=await f.request('/api/connections',{method:'POST',body:{fromId:old.id,toId:item.id}});
  const canvas=(await f.request('/api/atlas')).canvas;
  await f.request('/api/canvas',{method:'PATCH',body:{panX:17,panY:-23,zoom:.75,expectedUpdatedAt:canvas.updatedAt,idempotencyKey:key()}});
  const cliRead=await f.cli('read',item.id);assert.equal(cliRead.body,item.body);
  const cliChanged=await f.cli('call','update_inspiration','--json',JSON.stringify({id:item.id,expectedUpdatedAt:item.updatedAt,idempotencyKey:key(),patch:{body:item.body.replace('两图之间说明','CLI 更新说明')}}));
  assert.equal(cliChanged.item.bodyFormat,'markdown');
  const ai=await f.mcp(),aiRead=await ai('read_inspiration',{id:item.id});assert.equal(aiRead.body,cliChanged.item.body);
  const aiChanged=await ai('update_inspiration',{id:item.id,expectedUpdatedAt:aiRead.updatedAt,idempotencyKey:key(),patch:{body:aiRead.body.replace('结尾。','MCP 结尾。')}});
  assert.equal(aiChanged.isError,false);assert.equal((await f.io.read(item.id)).body,aiChanged.item.body);
  for(const original of aiChanged.item.attachments){
    const reply=await ai('read_inspiration_attachment',{attachmentId:original.id});
    assert.equal(sha256(Buffer.from(reply.dataBase64,'base64')),original.sha256);
    const download=await fetch(`${f.config.origin}/api/attachments/${original.id}?download=1`);
    assert.equal(sha256(Buffer.from(await download.arrayBuffer())),original.sha256);
  }
  await f.restart();const after=await f.io.read(item.id);assert.equal(after.body,aiChanged.item.body);assert.equal(after.attachments.length,3);
  const atlas=await f.request('/api/atlas');assert.equal(atlas.connections[0].id,linked.id);assert.equal(atlas.canvas.panX,17);
  assert.equal(atlas.ideas.find(idea=>idea.id===old.id).x,old.x);assert.equal(atlas.ideas.find(idea=>idea.id===old.id).y,old.y);
  const exported=Buffer.from(await (await fetch(f.config.origin+'/api/export')).arrayBuffer());
  assert.equal(JSON.parse(gunzipSync(exported)).version,2);
  const bundlePath=join(f.directory,'bundle.lingbranch.json.gz'),target=join(f.directory,'restored');await writeFile(bundlePath,exported);
  const restored=JSON.parse((await execFile(process.execPath,[join(projectRoot,'server/backup.mjs'),'restore',bundlePath,target],{cwd:tmpdir()})).stdout);
  assert.equal(restored.ideas,2);
  const restoredRead=JSON.parse((await execFile(process.execPath,[join(projectRoot,'cli/lingbranch.mjs'),'--data-dir',target,'read',item.id],{cwd:tmpdir()})).stdout);
  assert.deepEqual(restoredRead.bodyImages,after.bodyImages);assert.equal(restoredRead.body,after.body);
  assert.deepEqual(restoredRead.attachments.map(file=>file.sha256),after.attachments.map(file=>file.sha256));
});

test('HTTP 已成功但新建/上传/最终写入回执丢失，读回失败后重试保留原请求且无重复',async t=>{
  const f=await fixture(t),session=createSaveSession();
  const draft=snapshot({body:'说明\n\n![图](blob:one)',drafts:[{url:'blob:one',file:file('原件.png','image/png',png('one'))}]});
  const seen={create:[],upload:[],update:[]};let loseCreate=true,loseUpload=true,loseUpdate=true,loseRead=true;
  const io={...f.io,
    create:async request=>{seen.create.push({...request});const result=await f.io.create(request);if(loseCreate){loseCreate=false;throw new Error('模拟创建回执丢失');}return result;},
    upload:async request=>{seen.upload.push({...request,file:request.file.name});const result=await f.io.upload(request);if(loseUpload){loseUpload=false;throw new Error('模拟上传回执丢失');}return result;},
    update:async request=>{seen.update.push(structuredClone(request));const result=await f.io.update(request);if(loseUpdate){loseUpdate=false;throw new Error('模拟正文回执丢失');}return result;},
    read:async id=>{if(loseRead){loseRead=false;throw new Error('模拟读回失败');}return f.io.read(id);},
  };
  await assert.rejects(saveInspiration(session,{...draft},io),error=>error.phase==='creating');
  await assert.rejects(saveInspiration(session,{...draft},io),error=>error.phase==='uploading');
  assert.equal((await f.io.read(session.id)).body,'');assert.equal((await f.io.read(session.id)).attachments.length,1);
  await assert.rejects(saveInspiration(session,{...draft},io),error=>error.phase==='writing');
  const stored=await f.io.read(session.id);assert.equal(stored.bodyImages.length,1);
  await assert.rejects(saveInspiration(session,{...draft},io),error=>error.phase==='verifying');
  const result=await saveInspiration(session,{...draft},io);
  assert.equal(result.item.updatedAt,stored.updatedAt);assert.equal(result.item.attachments.length,1);
  assert.deepEqual(seen.create[0],seen.create[1]);assert.deepEqual(seen.upload[0],seen.upload[1]);assert.deepEqual(seen.update[0],seen.update[1]);
  assert.equal(seen.update.length,2,'读回失败重试不重新提交已经收到的最终写入');
  assert.equal((await f.request('/api/atlas')).ideas.length,1);
});

test('现有图文在 HTTP 上传或最终正文故障时保持，恢复后沿阶段请求保存；移除草稿不上传',async t=>{
  const f=await fixture(t),old=await f.io.create({title:'原正文',body:'原来的完整正文',bodyFormat:'markdown',idempotencyKey:key()});
  const session=createSaveSession(old.id,old.updatedAt),image=file('需保存.png','image/png',png('safe'));
  const draft=snapshot({title:old.title,body:'新的正文\n\n![图](blob:needed)',drafts:[{url:'blob:needed',file:image},{url:'blob:removed',file:file('已移除.png','image/png',png('removed'))}]});
  f.app.library.db.exec("CREATE TRIGGER body_upload_failure BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'simulated upload failure'); END;");
  await assert.rejects(saveInspiration(session,{...draft},f.io),error=>error.phase==='uploading');
  assert.equal((await f.io.read(old.id)).body,old.body);assert.equal((await f.io.read(old.id)).updatedAt,old.updatedAt);
  f.app.library.db.exec('DROP TRIGGER body_upload_failure');
  f.app.library.db.exec("CREATE TRIGGER body_commit_failure BEFORE UPDATE ON ideas BEGIN SELECT RAISE(ABORT,'simulated body failure'); END;");
  await assert.rejects(saveInspiration(session,{...draft},f.io),error=>error.phase==='writing'&&error.uploadedCount===1);
  const beforeRetry=await f.io.read(old.id);assert.equal(beforeRetry.body,old.body);assert.equal(beforeRetry.attachments.length,1);
  f.app.library.db.exec('DROP TRIGGER body_commit_failure');
  const result=await saveInspiration(session,{...draft},f.io);assert.equal(result.item.attachments.length,1);assert.match(result.item.body,/新的正文/);
});

test('HTTP 原件保存后另一端更新仍返回冲突；明确核对版本前不能覆盖，失效和跨记录引用拒绝',async t=>{
  const f=await fixture(t),old=await f.io.create({title:'并发正文',body:'原文',bodyFormat:'markdown',idempotencyKey:key()});
  const other=await f.io.create({title:'其他记录',idempotencyKey:key()});
  const session=createSaveSession(old.id,old.updatedAt),draft=snapshot({body:'我的草稿\n\n![图](blob:conflict)',drafts:[{url:'blob:conflict',file:file('冲突图.png','image/png',png('conflict'))}]});
  let changed=false;
  const io={...f.io,upload:async request=>{
    const result=await f.io.upload(request);
    if(!changed){changed=true;await f.io.update({id:old.id,expectedUpdatedAt:old.updatedAt,idempotencyKey:key(),patch:{body:'另一端先保存'}});}
    return result;
  }};
  await assert.rejects(saveInspiration(session,{...draft},io),error=>error.code==='conflict');
  await assert.rejects(saveInspiration(session,{...draft},io),error=>error.code==='conflict');
  const current=await f.io.read(old.id);assert.equal(current.body,'另一端先保存');assert.equal(current.attachments.length,1);
  acknowledgeVersion(session,current.updatedAt);const result=await saveInspiration(session,{...draft},io);assert.equal(result.item.attachments.length,1);
  for(const body of [`![x](attachment:${current.attachments[0].id})`,'![x](https://example.com/forbidden.png)',`![x](attachment:${randomUUID()})`]){
    await assert.rejects(f.io.update({id:other.id,expectedUpdatedAt:other.updatedAt,idempotencyKey:key(),patch:{body,bodyFormat:'markdown'}}),error=>error.code==='invalid_input');
  }
});

test('纯文本行内图片字面经 HTTP 保存、字面转换、v2 导出恢复与 v1 原结构恢复均保持',async t=>{
  const f=await fixture(t),raw='# 原符号\n* 保持\n![外图](https://example.com/not-loaded.png)\n<script>原文</script>\n\n结尾';
  const plain=await f.io.create({title:'字面正文',body:raw,idempotencyKey:key()});assert.equal(plain.bodyFormat,'plain');
  const converted=plainToMarkdown(raw);assert.equal(markdownText(converted),raw);assert.equal(imageNodes(converted).length,0);
  const pack=Buffer.from(await (await fetch(f.config.origin+'/api/export')).arrayBuffer());validateBundle(pack);
  const target=join(f.directory,'plain-restored');await restoreBundle(pack,target);
  const restored=JSON.parse((await execFile(process.execPath,[join(projectRoot,'cli/lingbranch.mjs'),'--data-dir',target,'read',plain.id],{cwd:tmpdir()})).stdout);
  assert.equal(restored.body,raw);assert.equal(restored.bodyFormat,'plain');
  const legacy=JSON.parse(gunzipSync(pack));legacy.version=1;legacy.payload.snapshot.ideas.forEach(row=>delete row.body_format);legacy.sha256=fingerprint(legacy.payload);
  const oldTarget=join(f.directory,'v1-restored');await restoreBundle(gzipSync(JSON.stringify(legacy)),oldTarget);
  const oldRead=JSON.parse((await execFile(process.execPath,[join(projectRoot,'cli/lingbranch.mjs'),'--data-dir',oldTarget,'read',plain.id],{cwd:tmpdir()})).stdout);assert.equal(oldRead.body,raw);
  const changed=await f.io.update({id:plain.id,expectedUpdatedAt:plain.updatedAt,idempotencyKey:key(),patch:{body:converted,bodyFormat:'markdown'}});
  assert.deepEqual(changed.bodyImages,[]);assert.equal(markdownText(changed.body),raw);
  const malformed=JSON.parse(gunzipSync(pack));delete malformed.payload.snapshot.ideas[0].body_format;malformed.sha256=fingerprint(malformed.payload);
  assert.throws(()=>validateBundle(gzipSync(JSON.stringify(malformed))),'v2 不允许缺失格式字段');
});

test('图片节点替换保留代码及普通链接；引用式图片定义、文字连贯与危险链接边界',()=>{
  const body='前**重点**后 un*der*line\n\n![图][a]\n\n[a]: blob:source\n\n`![代码](blob:source)`\n\n[普通链接](blob:source)';
  const changed=replaceImageSources(body,new Map([['blob:source','attachment:00000000-0000-4000-8000-000000000001']]));
  assert.match(changed,/\[a\]: attachment:/);assert.match(changed,/`!\[代码\]\(blob:source\)`/);assert.match(changed,/\[普通链接\]\(blob:source\)/);
  assert.match(markdownText(changed),/前重点后 underline/);
  for(const unsafe of ['javascript:alert(1)','data:text/html,script','file:///tmp/x','javascript\n:alert(1)','https://'])assert.equal(safeLinkUrl(unsafe),null);
  assert.equal(safeLinkUrl('https://example.com/path'),'https://example.com/path');assert.equal(safeLinkUrl('mailto:person@example.com'),'mailto:person@example.com');
});
