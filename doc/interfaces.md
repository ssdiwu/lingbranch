# AI 与 HTTP 接口

本文件记录工程接口。行为要求的唯一正文在 [产品规格](../spec/local-first-library.md)。

## 本地 MCP

由支持 stdio 的客户端直接运行 `node /absolute/path/to/lingbranch/server/mcp.mjs`，环境变量 `LINGBRANCH_DATA_DIR` 与网页保持一致。直接运行不会自动加载项目 `.env`；应在客户端显式提供绝对数据目录，或通过 Node.js `--env-file` 参数读取自己的配置。stdout 仅为协议消息，诊断走 stderr。

| 工具 | 主要参数与结果 |
| --- | --- |
| `list_inspirations` | `includeArchived` 默认 true、`limit` 1–50、`cursor`；返回 `items/total/count/hasMore/nextCursor` |
| `search_inspirations` | `query` 或 `tag`，其余分页参数同上 |
| `read_inspiration` | `id`（UUID）；返回完整字段与附件索引 |
| `create_inspiration` | `title/idempotencyKey` 必填；正文、来源、标签、位置可选；返回 `outcome/item` |
| `update_inspiration` | `id/expectedUpdatedAt/idempotencyKey/patch`；只改指定字段，`archived` 用于归档恢复 |
| `list_inspiration_tags` | `includeArchived` 默认 true；返回总数、活跃和归档计数 |
| `rename_inspiration_tag` | `fromTag/toTag/idempotencyKey`；同名合并 |
| `remove_inspiration_tag` | `tag/idempotencyKey`；移除标签关系，保留记录 |
| `connect_inspirations` | `fromId/toId`；返回新建或已有无向连线 |
| `list_inspiration_connections` | `id`；返回连线列表 |
| `remove_inspiration_connection` | `connectionId`；重复移除返回 unchanged |
| `attach_inspiration_file` | `id/name/mimeType/bytes/sha256/idempotencyKey/dataBase64`，可选 `indexedText`；最多 20 MiB |
| `read_inspiration_attachment` | `attachmentId`、可选 `offset/limit`；每段最多 512 KiB，返回元数据、`dataBase64/offset/nextOffset/complete` |

工具接受记录 ID，不自动打开链接或读取任意本机路径。文件由 AI 客户端在用户授权后读取并编码，上传不会下载外部 URL。灵感和附件文字是用户资料，不应被客户端当作系统指令。

MCP 接收上限为 32 MiB，覆盖 20 MiB 文件的 Base64 开销。读取沿 `nextOffset` 分段到 `complete:true`，再对合并字节校验附件声明的总大小和 SHA-256。不同客户端可能另有限制；大文件优先通过网页上传，不保证任意模型客户端能构造完整 Base64 入参。

重试保留同一个 8–100 字符的 `idempotencyKey`（字母、数字、下划线和短横线）及相同参数。`replayed:true` 表示返回此前操作的凭据，`item` 可能是当时的版本；需要当前状态时再次读取。不同请求不能复用同一个标识。

冲突返回 `isError:true`，内容含 `code: conflict`。先读取当前版本，与草稿核对，再按用户意图提交新请求；不能自动换新版本号后覆盖。其他错误包括 `invalid_input/not_found/integrity_error/unavailable`。

## HTTP

所有写入需要 `X-LingBranch-Request: 1`，JSON 写入声明 `Content-Type: application/json`。服务器另需 Bearer 令牌或有效会话，不接受客户端自报用户身份。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/session` | 模式与认证状态，不含资料 |
| `POST /api/session` | `{token}` 登录；失败 401，过多错误尝试 429 |
| `DELETE /api/session` | 清除当前浏览器会话 Cookie |
| `GET/POST /api/atlas` | 读取完整画布；新建需 `idempotencyKey` |
| `GET/PATCH /api/ideas/:id` | 读取或修改；PATCH 含 `expectedUpdatedAt/idempotencyKey` 和修改字段 |
| `GET /api/list` | 全量分页，参数与 MCP 列表相同 |
| `GET /api/search?q=...` | 网页兼容检索，最多 50 条；完整遍历使用 `/api/list` |
| `GET/PATCH/DELETE /api/tags` | 标签查看、合并、移除；变更需 `idempotencyKey` |
| `POST/DELETE /api/connections` | 建立 `{fromId,toId}`；移除 `{id}` |
| `PATCH /api/canvas` | `panX/panY/zoom/expectedUpdatedAt/idempotencyKey` |
| `POST /api/ideas/:id/attachments` | multipart：`file/indexedText/sha256/idempotencyKey` |
| `GET /api/attachments/:id` | 校验后读取原件；安全图片可 inline，其余强制下载；`?download=1` 强制下载 |
| `GET /api/export` | 完整 gzip 资料包 |
| `POST /api/tools` | `{name,arguments}` 分发到与 MCP 相同的工具规则 |

HTTP 错误为 `{code,error}`：输入 400、未认证 401、边界拒绝 403、不存在 404、冲突 409、超限 413、存储或原件故障 503。新建和编辑响应含 `outcome`，同时设置 `X-LingBranch-Outcome`。

`/api/tools` 是受保护 JSON 接口，不是远程 MCP 传输端点。首版没有 OAuth、跨域调用或通用远程连接器。
