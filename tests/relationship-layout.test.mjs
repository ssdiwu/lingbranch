import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Library} from '../server/library.mjs';
import {createApplication} from '../server/http.mjs';
import {projectRoot} from '../server/config.mjs';
import {arrangeRelationships,directNeighborhood,previewPosition} from '../shared/relationship-layout.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'lingbranch-relations-'));
  const db=new Library(directory);t.after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
  return db;
}
const create=(db,title)=>db.createIdea({title,body:'保留文字与 * 字面符号',tags:['保留标签'],idempotencyKey:randomUUID()}).item;
const positions=ideas=>ideas.map(({id,x,y,updatedAt})=>({id,x:x+500,y:y-100,expectedUpdatedAt:updatedAt}));

test('关系布局稳定、无重叠，直接关联只依据现有无方向连线，卡片在视口内保持 3:4',()=>{
  const ideas=Array.from({length:70},(_,i)=>({id:String(i),x:0,y:0}));
  const links=Array.from({length:15},(_,i)=>({fromId:'0',toId:String(i+1)}));
  links.push({fromId:'2',toId:'1'},{fromId:'missing',toId:'0'});
  const result=arrangeRelationships(ideas,links);
  assert.deepEqual(result,arrangeRelationships(ideas,links));assert.equal(result.length,ideas.length);
  assert.deepEqual(ideas.map(idea=>idea.x),Array(70).fill(0));
  for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++)assert.ok(Math.abs(result[i].x-result[j].x)>=200||Math.abs(result[i].y-result[j].y)>=56,`${i}/${j} overlap`);
  assert.deepEqual([...directNeighborhood('1',links,['0','1','2','16'])].sort(),['0','1','2']);
  assert.deepEqual([...directNeighborhood('16',links,ideas.map(idea=>idea.id))],['16']);
  for(const viewport of [{width:1000,height:700},{width:390,height:736},{width:800,height:450}]){
    const card=previewPosition({x:9000,y:-2000},{zoom:.1,panX:0,panY:0},viewport);
    assert.equal(card.width/card.height,.75);assert.ok(card.left>=0&&card.left+card.width<=viewport.width);assert.ok(card.top>=0&&card.top+card.height<=viewport.height);
  }
});

test('整理保留内容与连线，备份可恢复；重复请求不覆盖后来编辑，过期恢复整批拒绝',async t=>{
  const db=await fixture(t),a=create(db,'第一条'),b=create(db,'第二条');db.connect({fromId:a.id,toId:b.id});
  const before=db.atlas(),input={idempotencyKey:randomUUID(),positions:positions(before.ideas)};
  const saved=db.arrangeIdeas(input);assert.equal(saved.outcome,'updated');assert.equal(saved.replayed,false);
  const after=db.atlas();
  for(const old of before.ideas){const now=after.ideas.find(idea=>idea.id===old.id);assert.deepEqual({...now,x:old.x,y:old.y,updatedAt:old.updatedAt},old);}
  assert.deepEqual(after.connections,before.connections);
  const restored=db.arrangeIdeas({idempotencyKey:randomUUID(),positions:saved.previous});
  assert.deepEqual(restored.positions.map(({id,x,y})=>({id,x,y})),before.ideas.map(({id,x,y})=>({id,x,y})));
  const fresh=db.readIdea(a.id);db.updateIdea({id:a.id,expectedUpdatedAt:fresh.updatedAt,patch:{body:'AI 后来的更新',x:999},idempotencyKey:randomUUID()});
  assert.equal(db.arrangeIdeas(input).replayed,true);assert.equal(db.readIdea(a.id).x,999);assert.equal(db.readIdea(a.id).body,'AI 后来的更新');
  const stable=db.atlas();assert.throws(()=>db.arrangeIdeas({idempotencyKey:randomUUID(),positions:saved.previous}),error=>error.code==='conflict');assert.deepEqual(db.atlas(),stable);
  assert.throws(()=>db.arrangeIdeas({...input,positions:input.positions.map(point=>({...point,x:0}))}),error=>error.code==='conflict');
});

test('任一版本、重复 ID、无效坐标或事务存储失败都不留下部分位置或成功凭据',async t=>{
  const db=await fixture(t),a=create(db,'第一条'),b=create(db,'第二条');
  const before=db.atlas(),input={idempotencyKey:randomUUID(),positions:positions(before.ideas)};
  assert.throws(()=>db.arrangeIdeas({...input,positions:input.positions.map((p,i)=>i?{...p,expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}:p)}),error=>error.code==='conflict');
  assert.throws(()=>db.arrangeIdeas({...input,positions:[input.positions[0],input.positions[0]]}),error=>error.code==='invalid_input');
  assert.throws(()=>db.arrangeIdeas({...input,owner:'self'}),error=>error.code==='invalid_input');
  assert.throws(()=>db.arrangeIdeas({...input,positions:[{...input.positions[0],x:Infinity}]}),error=>error.code==='invalid_input');
  db.db.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON ideas WHEN OLD.id='${b.id}' BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END`);
  assert.throws(()=>db.arrangeIdeas(input),/simulated storage failure/);assert.deepEqual(db.atlas(),before);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM receipts WHERE key=?').get(input.idempotencyKey).n,0);
  db.db.exec('DROP TRIGGER reject_second');assert.equal(db.arrangeIdeas(input).outcome,'updated');
  assert.ok(db.readIdea(a.id).updatedAt!==a.updatedAt);
});

test('HTTP 与独立 stdio MCP 共用位置操作，重启保存，服务器拒绝未授权与客户端自报身份',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lingbranch-layout-http-'));
  const config={mode:'server',port:0,host:'127.0.0.1',origin:'http://127.0.0.1:0',dataDir:directory,token:randomUUID()};
  let app=await createApplication(config);
  const listen=async()=>{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));config.origin=`http://127.0.0.1:${app.server.address().port}`;};await listen();
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  create(app.library,'网页创建');create(app.library,'第二条');
  const before=app.library.atlas(),input={idempotencyKey:randomUUID(),positions:positions(before.ideas)};
  const request=async(auth)=>fetch(config.origin+'/api/tools',{method:'POST',headers:{'Content-Type':'application/json','X-LingBranch-Request':'1','X-User-Id':'pretend',...(auth?{Authorization:`Bearer ${config.token}`}:{})},body:JSON.stringify({name:'arrange_inspirations',arguments:input})});
  assert.equal((await request(false)).status,401);assert.deepEqual(app.library.atlas(),before);
  const response=await request(true);assert.equal(response.status,200);const saved=await response.json();
  const client=new Client({name:'layout-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[join(projectRoot,'server/mcp.mjs')],env:{...process.env,LINGBRANCH_DATA_DIR:directory},stderr:'pipe'});transport.stderr?.on('data',()=>{});
  await client.connect(transport);t.after(()=>client.close());
  const result=await client.callTool({name:'arrange_inspirations',arguments:input});assert.equal(JSON.parse(result.content[0].text).replayed,true);
  await app.close();app=await createApplication(config);await listen();assert.deepEqual(app.library.atlas().ideas.map(({id,x,y,updatedAt})=>({id,x,y,updatedAt})),saved.positions);
  const undo=await client.callTool({name:'arrange_inspirations',arguments:{idempotencyKey:randomUUID(),positions:saved.previous}});assert.equal(undo.isError,undefined);
  assert.deepEqual(app.library.atlas().ideas.map(({id,x,y})=>({id,x,y})),before.ideas.map(({id,x,y})=>({id,x,y})));
});
