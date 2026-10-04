import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApplication } from '../server/http.mjs';
import { configuration, dataDirectory, projectRoot } from '../server/config.mjs';
import { Library } from '../server/library.mjs';
import { sha256, fingerprint } from '../server/validation.mjs';
import { restoreBundle, validateBundle } from '../server/bundle.mjs';

const execFile = promisify(execFileCallback);
const key = () => randomUUID();
async function fixture(t,mode='local') {
  const directory = await mkdtemp(join(tmpdir(),'lingbranch-test-'));
  const config = {mode,port:0,host:'127.0.0.1',origin:'http://127.0.0.1:0',dataDir:join(directory,'library'),token:randomUUID()};
  let app = await createApplication(config);
  const listen = async() => { await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));config.port=app.server.address().port;config.origin=`http://127.0.0.1:${config.port}`; };
  await listen();
  t.after(async() => { await app.close(); await rm(directory,{recursive:true,force:true}); });
  const request = async(path,{method='GET',body,headers={},auth=true}={}) => {
    const response = await fetch(config.origin+path,{method,headers:{...(auth&&mode==='server'?{Authorization:`Bearer ${config.token}`} : {}),
      ...(body === undefined ? {} : {'Content-Type':'application/json','X-LingBranch-Request':'1'}),...headers},body:body === undefined ? undefined : JSON.stringify(body)});
    const value = await response.json(); return {response,value};
  };
  return {directory,config,request,get app(){return app;},async restart(){await app.close();app=await createApplication(config);await listen();}};
}
async function mcp(t,directory) {
  const client = new Client({name:'lingbranch-verification',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[join(projectRoot,'server/mcp.mjs')],cwd:tmpdir(),
    env:{...process.env,LINGBRANCH_DATA_DIR:directory},stderr:'pipe'});
  transport.stderr?.on('data',() => {});
  await client.connect(transport);
  t.after(() => client.close());
  return {client,async call(name,args={}) { const result = await client.callTool({name,arguments:args});return {...JSON.parse(result.content[0].text),isError:result.isError || false}; }};
}
async function create(f,title='测试灵感',extra={}) {
  const result=await f.request('/api/atlas',{method:'POST',body:{title,idempotencyKey:key(),...extra}});
  assert.equal(result.response.status,201,JSON.stringify(result.value));return result.value;
}
async function upload(f,id,bytes,overrides={}) {
  const fields={name:'example.txt',mimeType:'text/plain',sha256:sha256(bytes),indexedText:'可检索附件内容',idempotencyKey:key(),...overrides};
  const form=new FormData();form.set('file',new Blob([bytes],{type:fields.mimeType}),fields.name);
  for(const field of ['sha256','indexedText','idempotencyKey'])form.set(field,fields[field]);
  const response=await fetch(`${f.config.origin}/api/ideas/${id}/attachments`,{method:'POST',headers:{'X-LingBranch-Request':'1',...(f.config.mode==='server'?{Authorization:`Bearer ${f.config.token}`}:{})},body:form});
  return {response,value:await response.json(),fields};
}

test('HTTP 空库 → 两条灵感 → 检索连线 → 独立 stdio MCP 更新 → 网页读回 → 重启持久化',async t => {
  const f=await fixture(t);
  assert.equal((await f.request('/api/atlas')).value.ideas.length,0);
  const first=await create(f,'阅读记录',{body:'关于公园的笔记',sourceLabel:'自行编写示例',sourceUrl:'https://example.com/article',sourceAt:'2026-10-04',tags:['阅读']});
  const second=await create(f,'散步想法',{x:120,y:120});
  assert.ok(Math.abs(first.x-second.x)>=324||Math.abs(first.y-second.y)>=420);
  const found=await f.request('/api/list?query=公园');assert.equal(found.value.items[0].id,first.id);
  const connection=await f.request('/api/connections',{method:'POST',body:{fromId:first.id,toId:second.id}});assert.equal(connection.response.status,200);
  const ai=await mcp(t,f.config.dataDir);
  const tools=await ai.client.listTools();assert.equal(tools.tools.length,13);assert.ok(tools.tools.every(tool=>tool.inputSchema.type==='object'));
  const read=await ai.call('read_inspiration',{id:first.id});assert.equal(read.body,first.body);
  const changed=await ai.call('update_inspiration',{id:first.id,expectedUpdatedAt:read.updatedAt,patch:{body:'由 MCP 补充的公园观察',tags:['阅读','观察']},idempotencyKey:key()});
  assert.equal(changed.outcome,'updated');assert.equal(changed.isError,false);
  assert.equal((await f.request(`/api/ideas/${first.id}`)).value.body,changed.item.body);
  const bytes=Buffer.from('这是一个完整的 UTF-8 原件。\n');
  const file=await upload(f,first.id,bytes);assert.equal(file.response.status,201);
  const aiFile=await ai.call('read_inspiration_attachment',{attachmentId:file.value.attachment.id});assert.deepEqual(Buffer.from(aiFile.dataBase64,'base64'),bytes);
  const before=(await f.request('/api/atlas')).value;
  const viewport=await f.request('/api/canvas',{method:'PATCH',body:{panX:33,panY:-44,zoom:.8,expectedUpdatedAt:before.canvas.updatedAt,idempotencyKey:key()}});assert.equal(viewport.response.status,200);
  await f.restart();
  const after=(await f.request('/api/atlas')).value;
  assert.equal(after.ideas.length,2);assert.equal(after.connections.length,1);assert.equal(after.canvas.panX,33);assert.equal(after.canvas.zoom,.8);
  assert.deepEqual(after.ideas.map(({id,x,y})=>({id,x,y})),before.ideas.map(({id,x,y})=>({id,x,y})));
  const download=await fetch(`${f.config.origin}/api/attachments/${file.value.attachment.id}`);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
});

test('相同请求重试、异参数冲突、严格版本冲突、无变化结果与未知字段拒绝',async t => {
  const f=await fixture(t),idempotencyKey=key(),body={title:'幂等记录',idempotencyKey};
  const first=await f.request('/api/atlas',{method:'POST',body});
  const retry=await f.request('/api/atlas',{method:'POST',body});assert.equal(retry.response.status,200);assert.equal(retry.value.id,first.value.id);assert.equal(retry.value.outcome,'already_saved');
  const conflict=await f.request('/api/atlas',{method:'POST',body:{...body,title:'另一个内容'}});assert.equal(conflict.response.status,409);
  const patch={expectedUpdatedAt:first.value.updatedAt,body:'第一次修改',idempotencyKey:key()};
  const changed=await f.request(`/api/ideas/${first.value.id}`,{method:'PATCH',body:patch});assert.equal(changed.value.outcome,'updated');
  const replay=await f.request(`/api/ideas/${first.value.id}`,{method:'PATCH',body:patch});assert.equal(replay.response.status,200);assert.equal(replay.value.updatedAt,changed.value.updatedAt);
  const stale=await f.request(`/api/ideas/${first.value.id}`,{method:'PATCH',body:{...patch,idempotencyKey:key()}});assert.equal(stale.response.status,409);
  const unchanged=await f.request(`/api/ideas/${first.value.id}`,{method:'PATCH',body:{...patch,expectedUpdatedAt:changed.value.updatedAt,idempotencyKey:key()}});assert.equal(unchanged.value.outcome,'unchanged');
  assert.equal((await f.request('/api/atlas')).value.ideas.length,1);
  const bad=await f.request('/api/atlas',{method:'POST',body:{title:'bad',ownerId:'someone',idempotencyKey:key()}});assert.equal(bad.response.status,400);
});

test('跨进程并发新建避开旧位置；重复请求原子去重',async t => {
  const f=await fixture(t),ai=await mcp(t,f.config.dataDir);
  const old=await create(f,'旧卡片',{x:-200,y:-100});
  const args={title:'并发去重',x:-200,y:-100,idempotencyKey:key()};
  const results=await Promise.all([ai.call('create_inspiration',args),f.request('/api/atlas',{method:'POST',body:args})]);
  assert.equal(results[0].item.id,results[1].value.id);
  await Promise.all(Array.from({length:20},(_,i)=>i%2?ai.call('create_inspiration',{title:`并发 ${i}`,x:-200,y:-100,idempotencyKey:key()}):create(f,`并发 ${i}`,{x:-200,y:-100})));
  const ideas=(await f.request('/api/atlas')).value.ideas;assert.equal(ideas.length,22);
  for(let i=0;i<ideas.length;i++)for(let j=i+1;j<ideas.length;j++)assert.ok(Math.abs(ideas[i].x-ideas[j].x)>=324||Math.abs(ideas[i].y-ideas[j].y)>=420);
  assert.equal(ideas.find(x=>x.id===old.id).x,-200);assert.equal(ideas.find(x=>x.id===old.id).y,-100);
});

test('全量分页跨 100 条、含归档和无标签；遍历中新增不插入当前快照',async t => {
  const f=await fixture(t),ai=await mcp(t,f.config.dataDir);
  for(let i=0;i<107;i++) {
    const item=await create(f,`分页 ${i}`,{tags:i%2?['分组']:[]});
    if(i%10===0)await f.request(`/api/ideas/${item.id}`,{method:'PATCH',body:{archived:true,expectedUpdatedAt:item.updatedAt,idempotencyKey:key()}});
  }
  let page=await ai.call('list_inspirations',{limit:17}),ids=page.items.map(x=>x.id);assert.equal(page.total,107);
  const late=await create(f,'遍历后的新条目');
  while(page.hasMore){page=await ai.call('list_inspirations',{limit:17,cursor:page.nextCursor});ids.push(...page.items.map(x=>x.id));}
  assert.equal(ids.length,107);assert.equal(new Set(ids).size,107);assert.ok(!ids.includes(late.id));assert.equal(page.nextCursor,null);
  const active=await ai.call('list_inspirations',{includeArchived:false});assert.equal(active.total,97);
  const all=await f.request('/api/list?limit=50');assert.equal(all.value.total,108);
  assert.equal((await f.request(`/api/list?includeArchived=false&cursor=${all.value.nextCursor}`)).response.status,400);
});

test('标签重命名合并与移除、反向连线查重、归档恢复均保留正文附件位置',async t => {
  const f=await fixture(t),ai=await mcp(t,f.config.dataDir);
  const a=await create(f,'标签 A',{body:'不变正文',tags:['Alpha','Beta','D Code']}),b=await create(f,'标签 B',{tags:['Beta']});
  const file=await upload(f,a.id,Buffer.from('tag attachment'));assert.equal(file.response.status,201);
  const one=await ai.call('connect_inspirations',{fromId:a.id,toId:b.id});
  const two=await ai.call('connect_inspirations',{fromId:b.id,toId:a.id});assert.equal(one.connection.id,two.connection.id);assert.equal(two.outcome,'already_connected');
  assert.equal((await ai.call('connect_inspirations',{fromId:a.id,toId:a.id})).isError,true);
  const rename={fromTag:'Alpha',toTag:'Beta',idempotencyKey:key()};assert.equal((await ai.call('rename_inspiration_tag',rename)).affectedCount,1);
  assert.equal((await ai.call('rename_inspiration_tag',rename)).replayed,true);
  const merged=(await f.request(`/api/ideas/${a.id}`)).value;assert.deepEqual(merged.tags,['Beta','D Code']);assert.equal(merged.body,a.body);assert.equal(merged.x,a.x);assert.equal(merged.attachments.length,1);
  await ai.call('remove_inspiration_tag',{tag:'Beta',idempotencyKey:key()});
  const now=await ai.call('read_inspiration',{id:a.id});
  const archived=await ai.call('update_inspiration',{id:a.id,expectedUpdatedAt:now.updatedAt,patch:{archived:true},idempotencyKey:key()});
  assert.equal((await ai.call('connect_inspirations',{fromId:a.id,toId:b.id})).isError,true);
  await ai.call('update_inspiration',{id:a.id,expectedUpdatedAt:archived.item.updatedAt,patch:{archived:false},idempotencyKey:key()});
  await f.restart();assert.equal((await f.request('/api/atlas')).value.connections.length,1);
  await ai.call('remove_inspiration_connection',{connectionId:one.connection.id});assert.equal((await ai.call('remove_inspiration_connection',{connectionId:one.connection.id})).outcome,'unchanged');
  const after=(await f.request(`/api/ideas/${a.id}`)).value;assert.equal(after.attachments.length,1);assert.equal(after.x,a.x);
});

test('附件 SHA 与类型验证、重复上传、数据库失败后重试、损坏读取和中断上传',async t => {
  const f=await fixture(t),a=await create(f),bytes=Buffer.from('<script>bad()</script>'),idempotencyKey=key();
  const first=await upload(f,a.id,bytes,{name:'example.html',mimeType:'text/html',idempotencyKey});assert.equal(first.response.status,201);
  const retry=await upload(f,a.id,bytes,{name:'example.html',mimeType:'text/html',idempotencyKey});assert.equal(retry.value.attachment.id,first.value.attachment.id);
  assert.equal((await upload(f,a.id,bytes,{sha256:'0'.repeat(64)})).response.status,400);
  assert.equal((await upload(f,a.id,bytes,{mimeType:'image/png'})).response.status,400);
  assert.equal((await upload(f,a.id,bytes,{name:'changed.html',mimeType:'text/html',idempotencyKey})).response.status,409);
  const download=await fetch(`${f.config.origin}/api/attachments/${first.value.attachment.id}`);assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');
  f.app.library.db.exec("CREATE TRIGGER simulate_disk_failure BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;");
  const stable=key(),newBytes=Buffer.from('recoverable upload');
  assert.equal((await upload(f,a.id,newBytes,{idempotencyKey:stable})).response.status,503);
  assert.equal((await f.request(`/api/ideas/${a.id}`)).value.attachments.length,1);
  f.app.library.db.exec('DROP TRIGGER simulate_disk_failure');
  assert.equal((await upload(f,a.id,newBytes,{idempotencyKey:stable})).response.status,201);
  assert.equal((await upload(f,a.id,newBytes,{idempotencyKey:stable})).response.status,200);
  await writeFile(join(f.config.dataDir,'attachments',sha256(bytes)),'corrupted');
  assert.equal((await fetch(`${f.config.origin}/api/attachments/${first.value.attachment.id}`)).status,503);
  assert.equal((await fetch(`${f.config.origin}/api/export`)).status,503);
  await writeFile(join(f.config.dataDir,'attachments',sha256(bytes)),bytes);
  await new Promise(resolve => {
    const req=http.request(`${f.config.origin}/api/ideas/${a.id}/attachments`,{method:'POST',headers:{'X-LingBranch-Request':'1','Content-Type':'multipart/form-data; boundary=broken','Content-Length':'1000'}});
    req.on('error',()=>resolve());req.on('socket',socket=>socket.on('connect',()=>{req.write('--broken\r\npartial');setTimeout(()=>{req.destroy();resolve();},15);}));
  });
  assert.equal((await f.request(`/api/ideas/${a.id}`)).value.attachments.length,2);
});

test('完整导出、CLI 恢复到新目录、错误包与已有目标保护',async t => {
  const f=await fixture(t),a=await create(f,'导出 A',{tags:['资料'],sourceUrl:'https://example.com'}),b=await create(f,'导出 B');
  const bytes=Buffer.from('original export bytes'),file=await upload(f,a.id,bytes);
  await f.request('/api/connections',{method:'POST',body:{fromId:a.id,toId:b.id}});
  const canvas=(await f.request('/api/atlas')).value.canvas;
  await f.request('/api/canvas',{method:'PATCH',body:{panX:150,panY:-350,zoom:.65,expectedUpdatedAt:canvas.updatedAt,idempotencyKey:key()}});
  const before=f.app.library.snapshot();
  const response=await fetch(`${f.config.origin}/api/export`);assert.equal(response.status,200);const bundle=Buffer.from(await response.arrayBuffer());
  assert.deepEqual(f.app.library.snapshot(),before);
  const path=join(f.directory,'backup.lingbranch.json.gz'),target=join(f.directory,'restored');await writeFile(path,bundle);
  const restored=await execFile(process.execPath,['server/backup.mjs','restore',path,target],{cwd:projectRoot});assert.equal(JSON.parse(restored.stdout).ideas,2);
  const db=new Library(target);try {assert.deepEqual(db.snapshot(),before);assert.deepEqual((await db.readAttachment(file.value.attachment.id)).bytes,bytes);}finally{db.close();}
  await assert.rejects(restoreBundle(bundle,target),error=>error.code==='target_exists');
  const empty=join(f.directory,'existing-empty');await mkdir(empty);await assert.rejects(restoreBundle(bundle,empty),error=>error.code==='target_exists');
  const object=JSON.parse(gunzipSync(bundle));object.payload.snapshot.connections[0].from_id=randomUUID();object.sha256=fingerprint(object.payload);
  const badTarget=join(f.directory,'bad');await assert.rejects(restoreBundle(gzipSync(JSON.stringify(object)),badTarget));
  assert.ok(!(await readdir(f.directory)).includes('bad'));
  assert.throws(()=>validateBundle(bundle.subarray(0,50)));
  assert.deepEqual(f.app.library.snapshot(),before);
});

test('本机 Host/Origin/跨站/写入头保护和无效服务器配置关闭入口',async t => {
  const f=await fixture(t);
  // Node fetch normalizes Host, so send the hostile Host through raw HTTP.
  const hostileHost=await new Promise((resolve,reject)=>{const req=http.get(f.config.origin+'/api/atlas',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(hostileHost,403);
  for(const headers of [{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.request('/api/atlas',{headers})).response.status,403,JSON.stringify(headers));
  const write=await fetch(f.config.origin+'/api/atlas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'csrf',idempotencyKey:key()})});assert.equal(write.status,403);
  assert.equal((await f.request('/api/atlas')).value.ideas.length,0);
  assert.throws(()=>configuration({LINGBRANCH_MODE:'server'}));assert.throws(()=>configuration({LINGBRANCH_MODE:'local',LINGBRANCH_HOST:'0.0.0.0'}));
  assert.throws(()=>configuration({LINGBRANCH_MODE:'server',LINGBRANCH_ORIGIN:'http://example.com',LINGBRANCH_TOKEN:'x'.repeat(32)}));
  assert.throws(()=>dataDirectory({LINGBRANCH_DATA_DIR:'relative-data'}));
});

test('服务器令牌与会话登录；自报身份不能访问灵感、附件、导出或工具',async t => {
  const f=await fixture(t,'server'),a=await create(f,'受保护资料'),file=await upload(f,a.id,Buffer.from('protected'));
  const paths=['/api/atlas','/api/list','/api/tags','/api/export',`/api/ideas/${a.id}`,`/api/attachments/${file.value.attachment.id}`];
  for(const path of paths) {
    const response=await fetch(f.config.origin+path,{headers:{'oai-authenticated-user-id':'fake','X-Forwarded-User':'owner'}});assert.equal(response.status,401,path);
  }
  for(const [path,body] of [['/api/atlas',{title:'not allowed',idempotencyKey:key()}],['/api/tools',{name:'list_inspirations',arguments:{}}]])assert.equal((await f.request(path,{method:'POST',body,auth:false})).response.status,401);
  assert.equal((await f.request('/api/session',{method:'POST',body:{token:'bad'},auth:false})).response.status,401);
  const login=await f.request('/api/session',{method:'POST',body:{token:f.config.token},auth:false});assert.equal(login.response.status,200);
  const cookie=login.response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.ok(!cookie.includes(f.config.token));
  const read=await f.request('/api/atlas',{auth:false,headers:{Cookie:cookie.split(';')[0]}});assert.equal(read.response.status,200);assert.equal(read.value.ideas.length,1);
  const forged=await f.request('/api/atlas',{auth:false,headers:{Cookie:cookie.split(';')[0]+'forged'}});assert.equal(forged.response.status,401);
  const csrf=await f.request('/api/atlas',{headers:{Origin:'https://untrusted.example'}});assert.equal(csrf.response.status,403);
  assert.equal((await f.request('/api/atlas')).value.ideas.length,1);
});

test('生产服务进程被终止后重启，已确认写入和布局仍然存在',async t => {
  const directory=await mkdtemp(join(tmpdir(),'lingbranch-process-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const start=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['server/http.mjs'],{cwd:projectRoot,env:{...process.env,LINGBRANCH_MODE:'local',LINGBRANCH_PORT:String(port),LINGBRANCH_HOST:'127.0.0.1',LINGBRANCH_ORIGIN:`http://127.0.0.1:${port}`,LINGBRANCH_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
    const timeout=setTimeout(()=>{child.kill();reject(new Error('启动超时'));},10000);
    child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);if(code)reject(new Error(`服务退出 ${code}`));});
    child.stdout.on('data',bytes=>{if(bytes.toString().includes('已启动')){clearTimeout(timeout);resolve(child);}});
  });
  let child=await start();t.after(()=>{child.kill('SIGTERM');});
  const origin=`http://127.0.0.1:${port}`;
  const first=await fetch(origin+'/api/atlas',{method:'POST',headers:{'Content-Type':'application/json','X-LingBranch-Request':'1'},body:JSON.stringify({title:'进程重启资料',x:66,y:77,idempotencyKey:key()})});const item=await first.json();assert.equal(first.status,201);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});child=await start();
  const read=await fetch(origin+'/api/atlas');const data=await read.json();assert.equal(data.ideas[0].id,item.id);assert.equal(data.ideas[0].x,66);assert.equal(data.ideas[0].y,77);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
});

test('MCP 接受 20 MiB 原件，并在默认 SDK 客户端中分段完整读回',async t => {
  const f=await fixture(t),ai=await mcp(t,f.config.dataDir),item=await create(f,'大附件边界');
  const bytes=Buffer.alloc(20*1024*1024,65),hash=sha256(bytes);
  const saved=await ai.call('attach_inspiration_file',{id:item.id,name:'large.txt',mimeType:'text/plain',bytes:bytes.length,sha256:hash,dataBase64:bytes.toString('base64'),idempotencyKey:key()});
  assert.equal(saved.isError,false);assert.equal(saved.attachment.bytes,bytes.length);
  const chunks=[];let offset=0,complete=false;
  while(!complete){
    const part=await ai.call('read_inspiration_attachment',{attachmentId:saved.attachment.id,offset});
    assert.equal(part.isError,false);assert.equal(part.offset,offset);assert.ok(part.dataBase64.length<700000);
    chunks.push(Buffer.from(part.dataBase64,'base64'));offset=part.nextOffset;complete=part.complete;
  }
  assert.equal(offset,null);assert.equal(Buffer.concat(chunks).length,bytes.length);assert.equal(sha256(Buffer.concat(chunks)),hash);
});
