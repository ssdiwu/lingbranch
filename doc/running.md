# 运行与服务器配置

## 数据位置

默认目录为项目根的 `data/`。程序按源码位置定位项目，MCP 从别的工作目录启动也不会另建一份库。推荐网页和 MCP 都明确配置同一 `LINGBRANCH_DATA_DIR` 绝对路径。

目录包含 `library.sqlite`、WAL/SHM 文件、`attachments/` 原件和可能残留的无引用上传文件。不要单独复制在线 SQLite 主文件，不要放在会清空的容器临时层、静态网站目录或代码发布包中。

## 本机

按 [README](../README.md) 安装、构建和启动。开发使用 `npm run dev`，Vite 和 API 复用同一本机端口。

`.env` 由 npm 脚本加载，已有环境变量优先；临时指定数据目录后，也要同步 AI 客户端配置。`.env`、令牌和导出包不要进入 Git。

## 自有服务器运行合同

需要持久本地磁盘、Node.js 22.22.3 或更新版本、进程管理器及 HTTPS 代理。当前在 macOS 验证了程序和服务器访问保护；Linux、Windows、具体代理和真实网络部署尚未实机验收。

在部署者保管的环境配置中填写：

```dotenv
LINGBRANCH_MODE=server
LINGBRANCH_HOST=127.0.0.1
LINGBRANCH_PORT=4280
LINGBRANCH_ORIGIN=https://ideas.example.com
LINGBRANCH_DATA_DIR=/srv/lingbranch-data
LINGBRANCH_TOKEN=replace-with-a-random-secret-of-at-least-32-characters
```

替换示例值。可在自己的终端用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成令牌，自行保管。令牌只通过环境配置或登录表单传递，不放入 URL。

1. 在应用目录运行 `npm ci`、`npm run build`。
2. 为运行用户提供专属可写的持久目录，以该用户运行 `npm start`，由进程管理器在重启后启动。
3. 代理终止 TLS，把站点原始 Host 转发给 `127.0.0.1:4280`。应用校验 Host 与 Origin，不接受任意 Host 或自报身份。代理不缓存 `/api/`，上传正文上限至少为 21 MiB。
4. 登录后验证附件上传下载；未登录访问 `/api/atlas`、`/api/export`、附件和写入必须被拒绝。
5. 验证程序重启、服务器重启、代码更新后仍指向相同持久目录，并完成导出和隔离恢复。

服务器模式可监听 `0.0.0.0`，只在部署者明确配置网络边界后使用。应用本身不实现 TLS，不应把明文后端端口直接暴露给不可信网络。

会话有效 12 小时。轮换令牌并重启服务使旧签名失效。`DELETE /api/session` 仅清除调用浏览器的 Cookie，全局吊销使用令牌轮换。

## AI 与备份

stdio MCP 可与网页同时访问本机磁盘上的库。不要通过网络文件共享并发打开 SQLite，也不要把本地示例指向另一台电脑的同名目录并声称已共享数据。

服务器自动化使用 [受保护 HTTP 接口](interfaces.md)，首版不提供远程 MCP。完整资料包解压后上限 128 MiB，含个人原件；恢复始终写入新目录。命令见 [README](../README.md)。
