import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, lstat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Library } from '../server/library.mjs';
import { projectRoot } from '../server/config.mjs';
import { sha256 } from '../server/validation.mjs';

const entry = join(projectRoot,'cli/lingbranch.mjs');
const key = () => randomUUID();
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(),'lingbranch-cli-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  return {directory,dataDir:join(directory,'library')};
}
async function command(args,{dataDir,entryPath=entry,input='',extraEnv={}} = {}) {
  const child = spawn(process.execPath,[entryPath,...args],{cwd:tmpdir(),
    env:{...process.env,LINGBRANCH_DATA_DIR:dataDir,...extraEnv},stdio:['pipe','pipe','pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data',part => {stdout += part;});
  child.stderr.on('data',part => {stderr += part;});
  child.stdin.end(input);
  const code = await new Promise((resolve,reject) => {child.once('error',reject);child.once('close',resolve);});
  assert.equal(stdout.trim().split('\n').length,1,stdout);
  return {code,value:JSON.parse(stdout),stderr};
}
async function call(name,args,options) {
  return command(['call',name,'--json',JSON.stringify(args)],options);
}
async function mcp(t,dataDir) {
  const client = new Client({name:'lingbranch-cli-test',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[join(projectRoot,'server/mcp.mjs')],cwd:tmpdir(),
    env:{...process.env,LINGBRANCH_DATA_DIR:dataDir},stderr:'pipe'});
  transport.stderr?.on('data',() => {});
  await client.connect(transport);
  t.after(() => client.close());
  return {client,async call(name,args={}) {
    const result = await client.callTool({name,arguments:args});
    assert.equal(result.isError || false,false,JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }};
}

test('CLI 发现与 status 不创建库；未知选项、无效 JSON 和路径在写入前拒绝',async t => {
  const f = await fixture(t);
  const help = await command(['help'],f);
  assert.equal(help.code,0);assert.equal(help.value.toolCount,13);
  const tools = await command(['tools'],f);
  assert.equal(tools.value.tools.length,13);
  assert.ok(tools.value.tools.every(tool => tool.inputSchema.type === 'object'));
  const status = await command(['status'],f);
  assert.equal(status.value.status,'not_initialized');assert.equal(status.value.dataDir,f.dataDir);
  const malformed = [
    ['call','create_inspiration','--json',''],
    ['call','create_inspiration','--json','[]'],
    ['call','create_inspiration','--json','{"title":"缺少请求键"}'],
    ['call','missing','--json','{}'],
    ['list','--include-archived','no'],
    ['list','--limit','51'],
    ['list','--all','--cursor','partial'],
    ['list','--all=false'],
    ['list','--query','不属于列表的选项'],
    ['search'],
    ['list','--data-dir','relative'],
    ['list','--data-dir',''],
    ['status','extra'],
    ['call','list_inspirations','--json','{}','--json-file','missing.json'],
  ];
  for (const args of malformed) {
    const result = await command(args,f);
    assert.equal(result.code,1,JSON.stringify(args));
    assert.equal(result.value.ok,false);assert.equal(result.value.code,'invalid_input');
  }
  await assert.rejects(lstat(f.dataDir),{code:'ENOENT'});
  const override = join(f.directory,'selected');
  const selected = await command(['status','--data-dir',override],f);
  assert.equal(selected.value.dataDir,override);
  await assert.rejects(lstat(override),{code:'ENOENT'});
});

test('CLI 命令软链接和技能指定的项目目录软链接均能启动，配置检查不创建库',async t => {
  const f = await fixture(t);
  const bin = join(f.directory,'lingbranch');
  await symlink(entry,bin);
  const tools = await command(['tools'],{...f,entryPath:bin});
  assert.equal(tools.code,0);assert.equal(tools.value.tools.length,13);
  const projectAlias = join(f.directory,'project-alias');
  await symlink(projectRoot,projectAlias);
  const status = await command(['status'],{...f,entryPath:join(projectRoot,'skills/lingbranch/scripts/lingbranch.mjs'),extraEnv:{LINGBRANCH_PROJECT_DIR:projectAlias}});
  assert.equal(status.code,0);assert.equal(status.value.dataDir,f.dataDir);
  await assert.rejects(lstat(f.dataDir),{code:'ENOENT'});
});

test('CLI 写入文件与 stdin、幂等及过期版本，在独立 MCP 中读回同一记录',async t => {
  const f = await fixture(t);
  const request = {title:'CLI 公园观察',body:'自行编写测试材料',tags:['观察'],idempotencyKey:key()};
  const path = join(f.directory,'request.json');
  await writeFile(path,JSON.stringify(request));
  const first = await command(['call','create_inspiration','--json-file',path],f);
  assert.equal(first.code,0);assert.equal(first.value.outcome,'created');
  const retry = await command(['call','create_inspiration','--json-file','-'],{...f,input:JSON.stringify(request)});
  assert.equal(retry.value.item.id,first.value.item.id);assert.equal(retry.value.replayed,true);
  const changedKey = await call('create_inspiration',{...request,title:'不同内容'},f);
  assert.equal(changedKey.code,1);assert.equal(changedKey.value.code,'conflict');
  const ai = await mcp(t,f.dataDir);
  const discovered = await ai.client.listTools();
  assert.equal(discovered.tools.length,13);
  const original = await ai.call('read_inspiration',{id:first.value.item.id});
  const update = {id:original.id,expectedUpdatedAt:original.updatedAt,patch:{body:'CLI 更新后由 MCP 读回'},idempotencyKey:key()};
  const edited = await call('update_inspiration',update,f);
  assert.equal(edited.value.outcome,'updated');
  assert.equal((await ai.call('read_inspiration',{id:original.id})).body,update.patch.body);
  assert.equal((await call('update_inspiration',update,f)).value.replayed,true);
  const stale = await call('update_inspiration',{...update,idempotencyKey:key(),patch:{body:'过期草稿'}},f);
  assert.equal(stale.code,1);assert.equal(stale.value.code,'conflict');
  const now = await command(['read',original.id],f);
  assert.equal(now.value.body,update.patch.body);
  assert.equal((await command(['list','--all'],f)).value.count,1);
});

test('CLI 全量遍历跨页、未打标签及归档记录，搜索与继续游标保持范围',async t => {
  const f = await fixture(t), library = new Library(f.dataDir);
  for (let i=0;i<107;i++) {
    const item = library.createIdea({title:`分页记录 ${i}`,tags:i%2 ? ['奇数'] : [],idempotencyKey:key()}).item;
    if (i<10) library.updateIdea({id:item.id,expectedUpdatedAt:item.updatedAt,patch:{archived:true},idempotencyKey:key()});
  }
  library.close();
  const all = await command(['list','--all','--limit','7'],f);
  assert.equal(all.value.complete,true);assert.equal(all.value.pages,16);
  assert.equal(all.value.total,107);assert.equal(all.value.count,107);
  assert.equal(new Set(all.value.items.map(item => item.id)).size,107);
  const active = await command(['list','--all','--include-archived','false'],f);
  assert.equal(active.value.total,97);
  const found = await command(['search','--tag','奇数','--all','--limit','11'],f);
  assert.equal(found.value.count,53);assert.equal(found.value.pages,5);
  const first = await command(['list','--limit','7'],f);
  assert.equal(first.value.hasMore,true);assert.equal(first.value.count,7);
  const next = await command(['list','--limit','7','--cursor',first.value.nextCursor],f);
  assert.equal(next.value.count,7);assert.ok(!first.value.items.some(item => next.value.items.some(other => other.id === item.id)));
});

test('CLI 通用调用保留附件、标签、连线查重与持久结果',async t => {
  const f = await fixture(t);
  const a = (await call('create_inspiration',{title:'关联 A',tags:['旧标签'],idempotencyKey:key()},f)).value.item;
  const b = (await call('create_inspiration',{title:'关联 B',idempotencyKey:key()},f)).value.item;
  const bytes = Buffer.from('由 CLI 保存的原件\n');
  const attachment = await call('attach_inspiration_file',{id:a.id,name:'example.txt',mimeType:'text/plain',bytes:bytes.length,
    sha256:sha256(bytes),dataBase64:bytes.toString('base64'),idempotencyKey:key()},f);
  assert.equal(attachment.code,0);
  const connection = (await call('connect_inspirations',{fromId:a.id,toId:b.id},f)).value.connection;
  const reverse = await call('connect_inspirations',{fromId:b.id,toId:a.id},f);
  assert.equal(reverse.value.outcome,'already_connected');assert.equal(reverse.value.connection.id,connection.id);
  await call('rename_inspiration_tag',{fromTag:'旧标签',toTag:'新标签',idempotencyKey:key()},f);
  const ai = await mcp(t,f.dataDir);
  assert.equal((await ai.call('list_inspiration_connections',{id:a.id})).connections.length,1);
  const raw = await ai.call('read_inspiration_attachment',{attachmentId:attachment.value.attachment.id});
  assert.deepEqual(Buffer.from(raw.dataBase64,'base64'),bytes);
  await call('remove_inspiration_tag',{tag:'新标签',idempotencyKey:key()},f);
  await call('remove_inspiration_connection',{connectionId:connection.id},f);
  assert.equal((await call('remove_inspiration_connection',{connectionId:connection.id},f)).value.outcome,'unchanged');
  const after = (await command(['read',a.id],f)).value;
  assert.equal(after.x,a.x);assert.equal(after.y,a.y);assert.equal(after.attachments.length,1);assert.deepEqual(after.tags,[]);
  assert.equal((await command(['status'],f)).value.status,'database_present');
});

test('skill 安装为普通文件，搬到独立目录可调用 CLI，重复安装保留已有内容',async t => {
  const f = await fixture(t), destination = join(f.directory,'skills','lingbranch');
  const installed = await command([destination],{...f,entryPath:join(projectRoot,'scripts/install-skill.mjs')});
  assert.equal(installed.code,0);assert.equal(installed.value.outcome,'installed');
  assert.equal(installed.value.files.length,4);
  for (const name of installed.value.files) {
    const metadata = await lstat(join(destination,name));
    assert.equal(metadata.isSymbolicLink(),false);assert.equal(metadata.isFile(),true);
  }
  const original = await readFile(join(destination,'SKILL.md'));
  const again = await command([destination],{...f,entryPath:join(projectRoot,'scripts/install-skill.mjs')});
  assert.equal(again.code,1);assert.equal(again.value.code,'already_exists');
  assert.deepEqual(await readFile(join(destination,'SKILL.md')),original);
  const linked = join(f.directory,'alias','lingbranch');
  await mkdir(join(f.directory,'alias'));await symlink(destination,linked);
  const alias = await command([linked],{...f,entryPath:join(projectRoot,'scripts/install-skill.mjs')});
  assert.equal(alias.code,1);assert.equal(alias.value.code,'already_exists');
  assert.deepEqual(await readFile(join(destination,'SKILL.md')),original);
  const wrongName = join(f.directory,'not-the-skill-name');
  assert.equal((await command([wrongName],{...f,entryPath:join(projectRoot,'scripts/install-skill.mjs')})).code,1);
  await assert.rejects(lstat(wrongName),{code:'ENOENT'});
  assert.deepEqual(await readFile(join(destination,'LICENSE')),await readFile(join(projectRoot,'LICENSE')));
  const helper = join(destination,'scripts/lingbranch.mjs');
  const configured = await command(['status'],{...f,entryPath:helper,extraEnv:{LINGBRANCH_PROJECT_DIR:projectRoot}});
  assert.equal(configured.code,0);assert.equal(configured.value.dataDir,f.dataDir);
  await assert.rejects(lstat(f.dataDir),{code:'ENOENT'});
  const missing = await command(['status'],{...f,entryPath:helper,extraEnv:{LINGBRANCH_PROJECT_DIR:''}});
  assert.equal(missing.code,1);assert.equal(missing.value.code,'configuration_required');
});
