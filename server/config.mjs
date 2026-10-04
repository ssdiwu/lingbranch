import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function dataDirectory(env = process.env) {
  if (env.LINGBRANCH_DATA_DIR && !isAbsolute(env.LINGBRANCH_DATA_DIR)) {
    throw new Error('LINGBRANCH_DATA_DIR 必须是绝对路径，确保网页与 MCP 使用同一资料库。');
  }
  return env.LINGBRANCH_DATA_DIR || resolve(projectRoot, 'data');
}
export function configuration(env = process.env) {
  const mode = env.LINGBRANCH_MODE || 'local';
  if (!['local', 'server'].includes(mode)) throw new Error('LINGBRANCH_MODE 必须为 local 或 server。');
  const port = Number(env.LINGBRANCH_PORT || 4280);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效。');
  const host = env.LINGBRANCH_HOST || (mode === 'local' ? '127.0.0.1' : '0.0.0.0');
  if (mode === 'local' && host !== '127.0.0.1') throw new Error('本机模式仅允许监听 127.0.0.1。');
  const origin = env.LINGBRANCH_ORIGIN || `http://127.0.0.1:${port}`;
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('站点地址必须仅包含协议、主机与端口。');
  if (mode === 'local' && origin !== `http://127.0.0.1:${port}`) throw new Error('本机模式不能使用外部站点地址。');
  const token = env.LINGBRANCH_TOKEN || '';
  if (mode === 'server') {
    if (token.length < 32 || !env.LINGBRANCH_ORIGIN) throw new Error('服务器模式需要站点地址与至少 32 字符的访问令牌。');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) {
      throw new Error('网络站点必须使用 HTTPS；HTTP 仅用于回环地址验证。');
    }
  }
  return { mode, port, host, origin, token, dataDir:dataDirectory(env) };
}
