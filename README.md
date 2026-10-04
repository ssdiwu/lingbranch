# LingBranch · 灵枝

自己部署，让你和 AI 共同整理灵感。

个人灵感画布，一人一库。网页与用户自己的 AI 客户端操作同一份 SQLite 数据库和附件目录。基础功能不调用大模型 API，不需要维护者的网站账号。

## 本机运行

需要 Node.js **22.22.3 或更新版本**与 npm。当前验证环境为 macOS、Node.js 22.22.3；该版本的内置 SQLite 会打印实验性功能提示。真实命令来自 [package.json](package.json)。

```sh
git clone https://github.com/ssdiwu/lingbranch.git
cd lingbranch
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4280>，首次运行得到空资料库。默认数据在本项目的 `data/` 下，与启动命令的工作目录无关。停止后重新启动，内容、附件、连线和布局保持。不要删除 `data/`，也不要把它提交进 Git。

可从 [.env.example](.env.example) 复制出 `.env`，用 `LINGBRANCH_DATA_DIR` 指定绝对数据路径、`LINGBRANCH_PORT` 修改端口。`npm run dev` 启动仅监听回环地址的开发模式；日常使用与部署使用构建后的入口。

## 已建立的使用入口

- 网页：新增和编辑灵感，来源与标签，画布拖动与键盘移动，检索，分页全量列表，临时筛选布局，连线，归档恢复，图片查看与附件下载。
- 保存：稳定请求标识防重复，更新检查版本；冲突保留草稿，核对最新内容后继续。顶部刷新按钮读取 AI 的最新修改。
- 附件：保存完整原件，最多 20 MiB；校验字节数、SHA-256 和已知格式签名。UTF-8 文本可索引，也可手填关键文字；不提供图片 OCR 或 PDF 全文识别。
- AI：13 个本地 MCP 工具，与网页共用操作规则。已用官方 TypeScript SDK 客户端验证 stdio；具体桌面客户端仍需按其配置方式接入。
- 备份：网页「导出全部资料」或命令行导出完整资料包，包含附件原件、关系、布局及重试凭据；恢复只写入新目录。

产品要求以 [首条使用路径规格](spec/local-first-library.md) 为准，验证事实与限制见 [验证记录](doc/verification.md)。这些入口不代表所有平台或 AI 客户端已适配。

## 连接自己的 AI

在支持本地 MCP stdio 的客户端添加以下配置，替换为本机绝对路径。直接运行 `node`，避免 `npm run` 的脚本提示混入协议标准输出。

```json
{
  "mcpServers": {
    "lingbranch": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/lingbranch/server/mcp.mjs"],
      "env": {
        "LINGBRANCH_DATA_DIR": "/absolute/path/to/lingbranch/data"
      }
    }
  }
}
```

网页和 MCP 必须指向同一绝对数据目录。MCP 依靠本机文件权限访问数据，不复用网页登录；它不会配置模型或修改全局客户端设置。工具、重试与冲突合同见 [AI 与 HTTP 接口](doc/interfaces.md)。

## 备份与恢复

```sh
npm run backup -- /absolute/path/to/backup.lingbranch.json.gz
npm run restore -- /absolute/path/to/backup.lingbranch.json.gz /absolute/path/to/new-library
```

导出文件和恢复目录均不能已存在。恢复先校验资料包、关系与附件，再交付新目录，不覆盖正在使用的数据。切换到恢复库时，停止网页与 MCP 进程，更新双方的数据目录，再重新启动。

首版资料包解压后上限 128 MiB。不要只复制正在写入的 SQLite 主文件作为备份；保存完整状态使用上述导出入口。导出包含完整个人资料，应自行保管。

## 自有服务器

设置 `LINGBRANCH_MODE=server`、`LINGBRANCH_ORIGIN` 和至少 32 字符的 `LINGBRANCH_TOKEN`。缺少保护配置会拒绝启动，网络站点要求 HTTPS。网页登录使用 HttpOnly 会话，接口可使用 Bearer 令牌。

具体运行、反向代理与持久化边界见 [运行与服务器配置](doc/running.md)。已在本机验证服务器模式的访问保护，尚未在真实服务器部署，也没有远程 HTTP MCP 或 OAuth 接入承诺。

## 工程检查与导航

```sh
npm run check
npm run licenses
```

`check` 执行 TypeScript 检查、网页构建和集成测试，测试使用临时资料库；网页视觉与交互验收单独记录。`licenses` 从锁文件和安装包重新生成依赖许可清单与声明。

| 问题 | 入口 |
| --- | --- |
| 协作与保护边界 | [AGENTS.md](AGENTS.md) |
| 领域词义 | [GLOSSARY.md](GLOSSARY.md) |
| 共用体验 | [DESIGN.md](DESIGN.md) |
| 产品行为与验收 | [spec/local-first-library.md](spec/local-first-library.md) |
| 行为变化与交付记录 | [CHANGELOG.md](CHANGELOG.md) |
| 项目许可证 | [MIT License](LICENSE) |
| 当前架构与一致性 | [doc/architecture.md](doc/architecture.md) |
| 原型与第三方来源 | [doc/source-boundaries.md](doc/source-boundaries.md) |
| 工程说明导航 | [doc/README.md](doc/README.md) |

| 位置 | 职责 |
| --- | --- |
| `web/` | React 画布、详情、表单、筛选与列表 |
| `server/library.mjs`、`server/validation.mjs` | 共用操作、事务、校验与附件持久化 |
| `server/http.mjs` | 网页与 HTTP 接口、访问保护 |
| `server/mcp.mjs`、`server/tools.mjs` | stdio MCP 与共用工具分发 |
| `server/bundle.mjs`、`server/backup.mjs` | 导出、校验和隔离恢复 |
| `tests/` | HTTP、独立 MCP 进程、故障及重启验证 |
| `scripts/`、`vendor/` | 离线维护脚本、复用样式与第三方声明 |
| `spec/`、`doc/` | 当前行为规格与工程依据 |
| `data/`、`dist/`、`node_modules/` | 本地数据、构建和依赖，不进入 Git |

源码仓库为 [ssdiwu/lingbranch](https://github.com/ssdiwu/lingbranch)，项目采用 [MIT License](LICENSE)，第三方材料保留各自许可与声明。当前版本字段为工程版本，尚未创建版本标签或 GitHub Release，也未部署线上实例。`private: true` 保留用于避免误发布 npm。
