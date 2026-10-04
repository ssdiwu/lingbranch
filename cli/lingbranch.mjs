#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { dataDirectory } from '../server/config.mjs';
import { executeTool, toolDefinitions } from '../server/tools.mjs';
import { LibraryError, fail, parse } from '../server/validation.mjs';

const maxJsonBytes = 32 * 1024 * 1024;
const optionDefinitions = {
  'data-dir': {type:'string'}, help:{type:'boolean'}, all:{type:'boolean'},
  limit:{type:'string'}, cursor:{type:'string'}, 'include-archived':{type:'string'},
  query:{type:'string'}, tag:{type:'string'}, json:{type:'string'}, 'json-file':{type:'string'},
};
const commandOptions = {
  help:[], tools:[], status:[], read:[],
  list:['all','limit','cursor','include-archived'],
  search:['all','limit','cursor','include-archived','query','tag'],
  call:['json','json-file'],
};
const descriptions = {
  help:'显示命令、数据目录配置和使用约束。',
  status:'查看目标数据目录及初始化状态，不创建或打开资料库。',
  tools:'列出全部工具及其 JSON 参数 schema，不打开资料库。',
  list:'分页列出灵感；--all 从第一页完整读取，默认包含归档。',
  search:'--query 或 --tag 检索，可用 --all 完整读取匹配项。',
  read:'read <UUID> 读取完整灵感和当前版本。',
  call:'call <工具名> [--json <JSON> | --json-file <文件或 ->] 调用任意现有工具。',
};
const toolNames = Object.keys(toolDefinitions);
const output = value => process.stdout.write(JSON.stringify(value) + '\n');

async function jsonArguments(values) {
  if (values.json !== undefined && values['json-file'] !== undefined) fail('invalid_input','--json 与 --json-file 只能选择一个。');
  let text = values.json ?? '{}';
  if (values['json-file'] !== undefined) {
    const source = values['json-file'] === '-' ? process.stdin : createReadStream(values['json-file']);
    const chunks = []; let bytes = 0;
    try {
      for await (const chunk of source) {
        const buffer = Buffer.from(chunk); bytes += buffer.length;
        if (bytes > maxJsonBytes) fail('invalid_input','JSON 参数超过 32 MiB。');
        chunks.push(buffer);
      }
    } catch(error) {
      if (error instanceof LibraryError) throw error;
      fail('invalid_input','无法读取 JSON 文件，请确认路径和读取权限。');
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text) > maxJsonBytes) fail('invalid_input','JSON 参数超过 32 MiB。');
  let value;
  try { value = JSON.parse(text); } catch { fail('invalid_input','JSON 参数无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_input','JSON 参数必须是对象。');
  return value;
}

function listArguments(values) {
  const args = {};
  if (values.limit !== undefined) {
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(values.limit)) fail('invalid_input','--limit 必须是 1–50 的整数。');
    args.limit = Number(values.limit);
  }
  if (values.cursor !== undefined) args.cursor = values.cursor;
  if (values['include-archived'] !== undefined) {
    if (!['true','false'].includes(values['include-archived'])) fail('invalid_input','--include-archived 必须是 true 或 false。');
    args.includeArchived = values['include-archived'] === 'true';
  }
  if (values.query !== undefined) args.query = values.query;
  if (values.tag !== undefined) args.tag = values.tag;
  if (values.all && values.cursor !== undefined) fail('invalid_input','--all 必须从第一页开始，不能同时提供 --cursor。');
  return args;
}

async function allPages(library, name, args) {
  const items = [], ids = new Set(), cursors = new Set();
  let cursor, total, pages = 0;
  do {
    const page = await executeTool(library,name,{...args,...(cursor ? {cursor} : {})});
    pages++;
    total ??= page.total;
    if (page.total !== total || page.count !== page.items.length || page.hasMore !== !!page.nextCursor) {
      fail('conflict','分页结果已变化，未报告全量完成；请从第一页重新读取。');
    }
    for (const item of page.items) {
      if (ids.has(item.id)) fail('conflict','分页出现重复记录，未报告全量完成。');
      ids.add(item.id); items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor && (cursors.has(cursor) || !page.items.length)) fail('conflict','分页没有继续推进，未报告全量完成。');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (items.length !== total) fail('conflict','分页数量不完整，未报告全量完成；请重试。');
  return {items,total,count:items.length,includeArchived:args.includeArchived,hasMore:false,nextCursor:null,complete:true,pages};
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  let library;
  try {
    let parsed;
    try { parsed = parseArgs({args:argv,options:optionDefinitions,allowPositionals:true,strict:true}); }
    catch { fail('invalid_input','命令选项无效，请运行 help；布尔 --all 不接受字符串值。'); }
    const {values,positionals} = parsed;
    const command = positionals[0] || 'help';
    if (!Object.hasOwn(commandOptions,command)) fail('invalid_input','未知命令，请运行 help。');
    for (const name of Object.keys(values)) {
      if (!['data-dir','help',...commandOptions[command]].includes(name)) fail('invalid_input',`命令 ${command} 不接受 --${name}。`);
    }
    if (values['data-dir'] !== undefined && !isAbsolute(values['data-dir'])) fail('invalid_input','--data-dir 必须是绝对路径。');
    let directory;
    try { directory = dataDirectory({...env,...(values['data-dir'] !== undefined ? {LINGBRANCH_DATA_DIR:values['data-dir']} : {})}); }
    catch(error) { fail('invalid_input',error.message); }
    if (values.help || command === 'help') {
      if (positionals.length > 1) fail('invalid_input','help 不接受额外参数。');
      output({ok:true,commands:descriptions,toolCount:toolNames.length,dataDir:directory,
        notes:['stdout 只输出 JSON；失败 ok:false 且退出码非零。','--data-dir 或 LINGBRANCH_DATA_DIR 必须是绝对路径，网页、MCP、CLI 指向同一目录。','新建与修改的请求标识由调用者提供，重试沿用原参数；更新前读取 expectedUpdatedAt。','基础 CLI 使用本机文件权限，没有远程连接或 OAuth 登录。']});
      return 0;
    }
    if (command === 'tools') {
      if (positionals.length !== 1) fail('invalid_input','tools 不接受额外参数。');
      output({ok:true,tools:toolNames.map(name => ({name,description:toolDefinitions[name].description,
        readOnly:!!toolDefinitions[name].readOnly,inputSchema:zodToJsonSchema(toolDefinitions[name].schema,{$refStrategy:'none'})}))});
      return 0;
    }
    if (command === 'status') {
      if (positionals.length !== 1) fail('invalid_input','status 不接受额外参数。');
      const database = join(directory,'library.sqlite');
      let exists = false;
      try { exists = (await stat(database)).isFile(); }
      catch(error) { if (error.code !== 'ENOENT') throw error; }
      output({ok:true,status:exists ? 'database_present' : 'not_initialized',dataDir:directory,database,
        transport:'local-files',toolCount:toolNames.length});
      return 0;
    }
    let name, args;
    if (command === 'call') {
      if (positionals.length !== 2) fail('invalid_input','用法：call <工具名> [--json <JSON> | --json-file <文件或 ->]。');
      name = positionals[1]; args = await jsonArguments(values);
    } else if (command === 'read') {
      if (positionals.length !== 2) fail('invalid_input','用法：read <灵感 UUID>。');
      name = 'read_inspiration'; args = {id:positionals[1]};
    } else {
      if (positionals.length !== 1) fail('invalid_input',`${command} 使用 --query、--tag 等选项，不接受额外位置参数。`);
      name = command === 'search' ? 'search_inspirations' : 'list_inspirations'; args = listArguments(values);
    }
    if (!Object.hasOwn(toolDefinitions,name)) fail('invalid_input','未知工具，请运行 tools。');
    args = parse(toolDefinitions[name].schema,args);
    const { Library } = await import('../server/library.mjs');
    library = new Library(directory);
    const result = values.all ? await allPages(library,name,args) : await executeTool(library,name,args);
    output({ok:true,...result});
    return 0;
  } catch(error) {
    output({ok:false,code:error instanceof LibraryError ? error.code : 'unavailable',
      message:error instanceof LibraryError ? error.message : '配置或存储不可用；请检查绝对数据目录和文件权限，写入重试沿用原参数。'});
    return 1;
  } finally { library?.close(); }
}

// npm 命令入口和项目目录可能是软链接；比较真实路径，避免直接运行时被误判为模块导入。
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) process.exitCode = await runCli();
