import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Library } from './library.mjs';
import { configuration, projectRoot } from './config.mjs';
import { executeTool } from './tools.mjs';
import { exportBundle } from './bundle.mjs';
import * as v from './validation.mjs';

const secureEqual = (a,b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); };
const sendJson = (res,status,value) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
function readBody(req,limit) {
  if (Number(req.headers['content-length'] || 0) > limit) v.fail('too_large','请求内容过大。',413);
  return new Promise((resolve,reject) => {
    const chunks = []; let size = 0, ended = false;
    req.on('data',chunk => {
      if (ended) return;
      size += chunk.length;
      if (size > limit) { ended = true; reject(new v.LibraryError('too_large','请求内容过大。',413)); }
      else chunks.push(chunk);
    });
    req.on('end',() => { if (!ended) { ended = true; resolve(Buffer.concat(chunks)); } });
    req.on('error',error => { if (!ended) { ended = true; reject(error); } });
    req.on('aborted',() => { if (!ended) { ended = true; reject(new v.LibraryError('aborted','上传已中断。')); } });
  });
}
async function jsonBody(req,limit=150000) {
  if (!req.headers['content-type']?.startsWith('application/json')) v.fail('invalid_input','请发送 JSON 内容。',415);
  const bytes = await readBody(req,limit);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { v.fail('invalid_input','JSON 格式无效。'); }
}
function requireFields(value,keys) {
  return v.parse(z.object(Object.fromEntries(keys.map(k => [k,v.id]))).strict(),value);
}

export async function createApplication(config,{dev=false} = {}) {
  if (dev && config.mode !== 'local') throw new Error('开发模式仅可用于本机回环地址。');
  const library = new Library(config.dataDir);
  let vite;
  const failures = new Map();
  const sign = value => createHmac('sha256',config.token).update(value).digest('base64url');
  function hasAccess(req) {
    if (config.mode === 'local') return true;
    const bearer = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (bearer && secureEqual(bearer,config.token)) return true;
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('lingbranch_session='))?.slice(19);
    if (!cookie || cookie.length > 300) return false;
    const [expires,nonce,signature,...extra] = cookie.split('.');
    return !extra.length && /^\d{13}$/.test(expires || '') && Number(expires) > Date.now()
      && Number(expires) <= Date.now() + 12*3600000 && !!nonce && !!signature && secureEqual(sign(`${expires}.${nonce}`),signature);
  }
  function protectRequest(req) {
    const allowed = config.mode === 'local' ? [`127.0.0.1:${config.port}`,`localhost:${config.port}`] : [new URL(config.origin).host];
    if (!allowed.includes(req.headers.host)) v.fail('forbidden','请求主机不在允许范围内。',403);
    const origins = config.mode === 'local' ? allowed.map(host => `http://${host}`) : [config.origin];
    if (req.headers.origin && !origins.includes(req.headers.origin)) v.fail('forbidden','拒绝跨站请求。',403);
    if (req.headers['sec-fetch-site'] === 'cross-site') v.fail('forbidden','拒绝跨站请求。',403);
    if (config.mode === 'local' && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) v.fail('forbidden','本机模式仅接受回环连接。',403);
    if (!['GET','HEAD'].includes(req.method) && req.headers['x-lingbranch-request'] !== '1') v.fail('forbidden','写入请求缺少保护标识。',403);
  }
  const server = http.createServer(async(req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    if (!dev) res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      protectRequest(req);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) v.fail('invalid_input','请求地址无效。');
      const url = new URL(req.url,config.origin), path = url.pathname;
      if (path === '/api/session') {
        if (req.method === 'GET') return sendJson(res,200,{mode:config.mode,authenticated:hasAccess(req)});
        if (req.method === 'POST') {
          const input = v.parse(z.object({token:z.string().max(1000)}).strict(),await jsonBody(req,2048));
          const address = req.socket.remoteAddress;
          const previous = failures.get(address);
          if (previous && previous.until > Date.now() && previous.count >= 5) v.fail('rate_limited','尝试过于频繁，请一分钟后重试。',429);
          if (config.mode !== 'server' || !secureEqual(input.token,config.token)) {
            if (failures.size > 256) failures.clear();
            failures.set(address,{until:Date.now()+60000,count:(previous?.until > Date.now() ? previous.count : 0)+1});
            v.fail('unauthorized','访问令牌不正确。',401);
          }
          failures.delete(address);
          const value = `${Date.now()+12*3600000}.${randomBytes(16).toString('hex')}`;
          res.setHeader('Set-Cookie',`lingbranch_session=${value}.${sign(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.origin.startsWith('https:') ? '; Secure' : ''}`);
          return sendJson(res,200,{authenticated:true});
        }
        if (req.method === 'DELETE') {
          res.setHeader('Set-Cookie','lingbranch_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return sendJson(res,200,{authenticated:false});
        }
        v.fail('method_not_allowed','不支持此操作。',405);
      }
      if (path.startsWith('/api/') && !hasAccess(req)) v.fail('unauthorized','请使用部署者配置的访问令牌登录。',401);
      if (path === '/api/atlas' && req.method === 'GET') return sendJson(res,200,library.atlas());
      if (path === '/api/atlas' && req.method === 'POST') {
        const result = library.createIdea(await jsonBody(req));
        res.setHeader('X-LingBranch-Outcome',result.outcome);
        return sendJson(res,result.replayed ? 200 : 201,{...result.item,outcome:result.outcome});
      }
      if (path === '/api/list' && req.method === 'GET') {
        const includeArchived = url.searchParams.get('includeArchived');
        if (includeArchived !== null && !['true','false'].includes(includeArchived)) v.fail('invalid_input','归档筛选无效。');
        return sendJson(res,200,library.listIdeas({includeArchived:includeArchived !== 'false',limit:Number(url.searchParams.get('limit') || 50),
          ...(url.searchParams.has('cursor') ? {cursor:url.searchParams.get('cursor')} : {}),query:url.searchParams.get('query') || '',
          ...(url.searchParams.has('tag') ? {tag:url.searchParams.get('tag')} : {})}));
      }
      if (path === '/api/search' && req.method === 'GET') return sendJson(res,200,{ideas:library.listIdeas({query:url.searchParams.get('q') || '',includeArchived:true}).items});
      const ideaMatch = path.match(/^\/api\/ideas\/([^/]+)$/);
      if (ideaMatch && req.method === 'GET') return sendJson(res,200,library.readIdea(ideaMatch[1]));
      if (ideaMatch && req.method === 'PATCH') {
        const {expectedUpdatedAt,idempotencyKey,...patch} = v.parse(z.record(z.unknown()),await jsonBody(req));
        const result = library.updateIdea({id:ideaMatch[1],expectedUpdatedAt,idempotencyKey,patch});
        res.setHeader('X-LingBranch-Outcome',result.outcome);
        return sendJson(res,200,{...result.item,outcome:result.outcome});
      }
      if (path === '/api/canvas' && req.method === 'PATCH') return sendJson(res,200,library.saveCanvas(await jsonBody(req)).canvas);
      if (path === '/api/tags') {
        if (req.method === 'GET') return sendJson(res,200,{tags:library.listTags()});
        if (['PATCH','DELETE'].includes(req.method)) return sendJson(res,200,{...library.changeTag(await jsonBody(req),req.method === 'DELETE'),tags:library.listTags()});
      }
      if (path === '/api/connections') {
        if (req.method === 'POST') return sendJson(res,200,library.connect(await jsonBody(req)).connection);
        if (req.method === 'PATCH') return sendJson(res,200,library.updateConnection(await jsonBody(req)));
        if (req.method === 'DELETE') { const input = v.parse(z.object({id:v.id,expectedUpdatedAt:v.date.optional()}).strict(),await jsonBody(req)); return sendJson(res,200,library.removeConnection(input.id,input.expectedUpdatedAt)); }
      }
      const uploadMatch = path.match(/^\/api\/ideas\/([^/]+)\/attachments$/);
      if (uploadMatch && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('multipart/form-data;')) v.fail('invalid_input','请上传文件表单。',415);
        const body = await readBody(req,v.MAX_ATTACHMENT_BYTES+160000);
        let form;
        try { form = await new Request(config.origin,{method:'POST',headers:{'Content-Type':req.headers['content-type']},body}).formData(); }
        catch { v.fail('invalid_input','附件表单无效。'); }
        const file = form.get('file');
        if (!(file instanceof File)) v.fail('invalid_input','请选择文件。');
        const result = await library.addAttachment({id:uploadMatch[1],name:file.name,mimeType:file.type || 'application/octet-stream',bytes:file.size,
          sha256:form.get('sha256'),indexedText:form.get('indexedText') || '',idempotencyKey:form.get('idempotencyKey')},Buffer.from(await file.arrayBuffer()));
        return sendJson(res,result.replayed ? 200 : 201,result);
      }
      const fileMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
      if (fileMatch && req.method === 'GET') {
        const {metadata,bytes} = await library.readAttachment(fileMatch[1]);
        const image = /^image\/(png|jpeg|gif|webp)$/.test(metadata.mimeType);
        res.setHeader('Content-Type',image ? metadata.mimeType : 'application/octet-stream');
        res.setHeader('Content-Disposition',`${image && !url.searchParams.has('download') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(metadata.name).replace(/'/g,'%27')}`);
        res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
        res.writeHead(200); return res.end(bytes);
      }
      if (path === '/api/export' && req.method === 'GET') {
        const bytes = await exportBundle(library);
        res.setHeader('Content-Type','application/gzip');
        res.setHeader('Content-Disposition','attachment; filename="lingbranch.lingbranch.json.gz"');
        res.writeHead(200); return res.end(bytes);
      }
      if (path === '/api/tools' && req.method === 'POST') {
        const input = v.parse(z.object({name:z.string().max(100),arguments:z.record(z.unknown())}).strict(),await jsonBody(req,29*1024*1024));
        return sendJson(res,200,await executeTool(library,input.name,input.arguments));
      }
      if (path.startsWith('/api/')) v.fail('not_found','接口不存在。',404);
      if (req.method !== 'GET' && req.method !== 'HEAD') v.fail('method_not_allowed','不支持此操作。',405);
      if (vite) return vite.middlewares(req,res,() => sendJson(res,404,{error:'页面不存在。'}));
      const dist = resolve(projectRoot,'dist');
      let target;
      try { target = resolve(dist,`.${decodeURIComponent(path === '/' ? '/index.html' : path)}`); }
      catch { v.fail('invalid_input','文件地址无效。'); }
      if (!target.startsWith(dist+sep)) v.fail('forbidden','无权访问该文件。',403);
      let bytes;
      try { bytes = await readFile(target); } catch { v.fail('not_found','页面不存在；请先运行 npm run build。',404); }
      const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
      res.setHeader('Content-Type',types[extname(target)] || 'application/octet-stream');
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch(error) {
      if (res.destroyed) return;
      const known = error instanceof v.LibraryError;
      if (!known) console.error('LingBranch request failed:',error.message);
      sendJson(res,known ? error.status : 503,{code:known ? error.code : 'unavailable',error:known ? error.message : '存储暂不可用，请保留草稿并用原请求重试。'});
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({configFile:resolve(projectRoot,'vite.config.mjs'),server:{middlewareMode:true,hmr:{server},fs:{allow:[resolve(projectRoot,'web'),resolve(projectRoot,'node_modules'),resolve(projectRoot,'vendor')],deny:['**/.env*','**/*.sqlite*','**/*.db*']}}});
  }
  return {server,library,async close() { await vite?.close(); await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())); library.close(); }};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = configuration();
    const app = await createApplication(config,{dev:process.argv.includes('--dev')});
    app.server.on('error',error => { console.error(error.message); app.library.close(); process.exitCode = 1; });
    app.server.listen(config.port,config.host,() => console.log(`LingBranch · 灵枝 已启动：${config.origin}`));
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => { void app.close().then(() => process.exit(0)); });
  } catch(error) { console.error(error.message); process.exitCode = 1; }
}
