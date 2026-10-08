import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Library} from '../server/library.mjs';
import {exportBundle,restoreBundle} from '../server/bundle.mjs';
import {fingerprint} from '../server/validation.mjs';
import {CONNECTION_EPOCH} from '../shared/connection-model.mjs';
const key=()=>randomUUID();
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'lingbranch-connections-'));const db=new Library(dir);t.after(async()=>{try{db.close();}catch{}await rm(dir,{recursive:true,force:true});});const a=db.createIdea({title:'方案：组织材料',body:'原正文保留',idempotencyKey:key()}).item,b=db.createIdea({title:'案例：验证方法',body:'候选案例，尚待验证',idempotencyKey:key()}).item;return {dir,db,a,b};}

test('connection reasons deduplicate, reject silent overwrite, guard versions and preserve history on retry',async t=>{
 const {db,a,b}=await fixture(t),before=db.atlas();
 const input={fromId:a.id,toId:b.id,relationType:'example',reason:'此案例用于方案验证，尚待亲测。',idempotencyKey:key()};
 const first=db.connect(input),c=first.connection;assert.equal(c.reason,input.reason);assert.equal(c.relationType,'example');assert.equal(db.connections().length,1);
 assert.equal(db.connect({...input,fromId:b.id,toId:a.id}).connection.id,c.id);assert.throws(()=>db.connect({...input,idempotencyKey:key(),reason:'不应覆盖'}),e=>e.code==='conflict');
 const edit={connectionId:c.id,expectedUpdatedAt:c.updatedAt,idempotencyKey:key(),patch:{relationType:'application',reason:'按已读说明作为方法应用候选。'}};
 const saved=db.updateConnection(edit);assert.ok(saved.connection.updatedAt>c.updatedAt);assert.throws(()=>db.updateConnection({...edit,idempotencyKey:key(),patch:{reason:'过期草稿'}}),e=>e.code==='conflict');
 const next=db.updateConnection({connectionId:c.id,expectedUpdatedAt:saved.connection.updatedAt,idempotencyKey:key(),patch:{reason:'较新说明'}});
 assert.equal(db.updateConnection(edit).replayed,true);assert.equal(db.readConnection(c.id).reason,next.connection.reason);assert.throws(()=>db.removeConnection(c.id,c.updatedAt),e=>e.code==='conflict');
 db.removeConnection(c.id,next.connection.updatedAt);assert.equal(db.connect(input).replayed,true);assert.equal(db.connections().length,0);assert.deepEqual(db.atlas().ideas,before.ideas);assert.deepEqual(db.atlas().canvas,before.canvas);
});

test('v2 schema upgrade and v1/v2 bundles preserve old endpoints; v3 preserves explained links',async t=>{
 const {dir,db,a,b}=await fixture(t),original=db.connect({fromId:a.id,toId:b.id}).connection,before=db.atlas();
 db.db.exec('ALTER TABLE connections DROP COLUMN updated_at; ALTER TABLE connections DROP COLUMN reason; ALTER TABLE connections DROP COLUMN relation_type; PRAGMA user_version=2');db.close();
 const upgraded=new Library(dir);t.after(()=>upgraded.close());const c=upgraded.connections()[0];assert.equal(c.id,original.id);assert.equal(c.reason,'');assert.equal(c.updatedAt,CONNECTION_EPOCH);assert.deepEqual(upgraded.atlas().ideas,before.ideas);assert.deepEqual(upgraded.atlas().canvas,before.canvas);
 const saved=upgraded.updateConnection({connectionId:c.id,expectedUpdatedAt:c.updatedAt,idempotencyKey:key(),patch:{relationType:'workflow',reason:'候选流程两阶段的衔接。'}}).connection;
 const pack=await exportBundle(upgraded),raw=JSON.parse(gunzipSync(pack));assert.equal(raw.version,3);
 const target=join(dir,'restored-v3');await restoreBundle(pack,target);const restored=new Library(target);assert.deepEqual(restored.connections(),upgraded.connections());restored.close();
 for(const version of [1,2]){const old=structuredClone(raw);old.version=version;old.payload.snapshot.connections.forEach(row=>{delete row.relation_type;delete row.reason;delete row.updated_at;});old.payload.snapshot.receipts=[];if(version===1)old.payload.snapshot.ideas.forEach(row=>delete row.body_format);old.sha256=fingerprint(old.payload);const destination=join(dir,'restored-v'+version);await restoreBundle(gzipSync(JSON.stringify(old)),destination);const legacy=new Library(destination);assert.equal(legacy.connections()[0].id,saved.id);assert.equal(legacy.connections()[0].reason,'');assert.equal(legacy.connections()[0].updatedAt,CONNECTION_EPOCH);assert.deepEqual(legacy.atlas().ideas,before.ideas);legacy.close();}
});

test('independent stdio MCP edits the same connection and rejects expired explanation versions',async t=>{
 const {db,dir,a,b}=await fixture(t),connection=db.connect({fromId:a.id,toId:b.id,reason:'初始关系说明'}).connection;
 const client=new Client({name:'connection-metadata-acceptance',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),'server/mcp.mjs')],env:{...process.env,LINGBRANCH_DATA_DIR:dir},stderr:'pipe'});transport.stderr?.on('data',()=>{});await client.connect(transport);t.after(()=>client.close());
 const invoke=async(name,args)=>{const r=await client.callTool({name,arguments:args});return {r,value:JSON.parse(r.content[0].text)};};
 const listed=await invoke('list_inspiration_connections',{id:a.id});assert.equal(listed.value.connections[0].reason,connection.reason);
 const edit=await invoke('update_inspiration_connection',{connectionId:connection.id,expectedUpdatedAt:connection.updatedAt,idempotencyKey:key(),patch:{relationType:'extension',reason:'AI 客户端写入的概念延伸说明'}});assert.equal(edit.r.isError,undefined);assert.equal(db.readConnection(connection.id).reason,'AI 客户端写入的概念延伸说明');
 const old=await invoke('update_inspiration_connection',{connectionId:connection.id,expectedUpdatedAt:connection.updatedAt,idempotencyKey:key(),patch:{reason:'旧版本不能覆盖'}});assert.equal(old.r.isError,true);assert.equal(db.readConnection(connection.id).reason,edit.value.connection.reason);
});
