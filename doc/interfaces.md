# AI 与 HTTP 接口

本文件记录工程接口。行为要求的唯一正文在 [产品规格](../spec/local-first-library.md)。

## 本地 MCP

由支持 stdio 的客户端直接运行 `node /absolute/path/to/lingbranch/server/mcp.mjs`，环境变量 `LINGBRANCH_DATA_DIR` 与网页保持一致。直接运行不会自动加载项目 `.env`；应在客户端显式提供绝对数据目录，或通过 Node.js `--env-file` 参数读取自己的配置。stdout 仅为协议消息，诊断走 stderr。

| 工具 | 主要参数与结果 |
| --- | --- |
| `list_inspirations` | `includeArchived` 默认 true、`limit` 1–50、`cursor`；返回 `items/total/count/hasMore/nextCursor` |
| `search_inspirations` | `query` 或 `tag`，其余分页参数同上 |
| `read_inspiration` | `id`（UUID）；返回正文、`bodyFormat/summary/bodyImages`、完整字段与附件索引 |
| `create_inspiration` | `title/idempotencyKey` 必填；正文、可选 `bodyFormat`、来源、标签、位置；返回 `outcome/item` |
| `arrange_inspirations` | `idempotencyKey/positions`；每项 `id/expectedUpdatedAt/x/y`，1–1000 项且 ID 不重复；返回 `outcome/replayed/positions/previous` |
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

## 整批位置与恢复

网页通过 `POST /api/tools` 调用 `arrange_inspirations`，CLI 与 stdio MCP 使用同一分发和 SQLite 事务。位置基于已读回的版本，所有版本先检查，再提交全部坐标和回执；同标识同参数只读回旧凭据，同标识不同参数返回冲突。没有自动推断关系或依赖模型的布局操作。

回执 `positions` 包含新坐标及 `updatedAt`，`previous` 包含原坐标及恢复所需的 `expectedUpdatedAt`。恢复使用新请求键，将原 `previous` 作为 `positions` 调用本工具；不能先替换成最新版本绕过冲突。相同键重试后仍应读取当前记录，不能把历史回执中的坐标当作当前状态。

网页保留本页最近一次实际位置变更的回执（尚无变更时保管当前回执），无变化不替换上次可恢复的位置，提供恢复和下载。下载 JSON 的 `format` 为 `lingbranch-layout`、版本 1；它仅含坐标与版本，不是完整资料备份。跨页面需要调用者保管该回执；完整资料与原件备份继续使用现有导出／隔离恢复入口。恢复失败不改变部分坐标，回执保留在原位置操作的持久凭据中。

## 正文格式与图片引用

`bodyFormat` 为可选入参，值为 `plain` 或 `markdown`。旧新建请求省略它时仍保存纯文本；旧更新请求省略它时沿用记录的现有格式。校验不会给旧请求新增默认字段，所以升级前的幂等请求仍按原摘要重放。网页新建默认图文是网页的明确选择。

编辑与共享解析使用 CommonMark。基础排版与显式链接可用；GFM 裸 URL 自动链接、删除线、任务列表和表格未启用。旧纯文本进入图文前按字面转义，保存再载入不应吞入硬换行或增加原本不存在的反斜杠。

末尾换行、制表及边界空格用同一正文中的标准数字字符引用保持，例如真正换行可编码为 `&#10;`。字面 `&#10;` 则先正常转义，不能被误解为换行。共用转换和编辑器文本序列化采用同一规则，读取仍返回正式 Markdown，并可派生原有可读字符；未编辑保存继续使用已读回的正文，不为规范化而改写版本。

所有读取返回正式 `body`、`bodyFormat`、派生 `summary` 与按正文顺序排列的 `bodyImages`。摘要保留可读文字、代码及图片说明；图文排版标记与真实图片内部地址不作为检索文字。派生字段不能作为第二份正文写入。

图文图片写作 `![图片说明](attachment:UUID)`，也可使用引用式图片与定义。UUID 必须是本记录已保存、允许预览的 PNG、JPEG、GIF 或 WebP 原件标识。先取得记录 ID，再调用 `attach_inspiration_file` 保存原件，最后用 `update_inspiration` 提交稳定引用和 `bodyFormat:"markdown"`。新记录第一阶段可以为空正文；已有记录在最终正文写入前保持原内容，不应先清空正文。

外部地址、blob/data、本机路径、不存在或跨记录的图片，以及不支持预览的文件引用被拒绝。代码块与行内代码中的图片语法保留为代码。Markdown 不执行原始 HTML；阅读仅为有效 HTTP、HTTPS、mailto 链接提供点击入口。移除图片展示不删除原件；SVG 等不能预览的图片仍可下载。

每阶段使用独立、稳定的请求键及完整原参数。附件上传不推进正文版本；最终更新仍用开始编辑时确认的版本。回执丢失先沿原请求重试，不能重新创建记录或自动换版本。成功后读取当前记录及原件索引；重试返回的历史凭据本身不证明当前内容。网页保存时冻结快照并暂停编辑，阶段失败保留草稿、原件和请求。

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

## 本地 CLI

入口为 [cli/lingbranch.mjs](../cli/lingbranch.mjs)，调用与 MCP 相同的 `executeTool`，不另写一套资料操作。直接运行 `node /absolute/path/to/lingbranch/cli/lingbranch.mjs`；项目目录内可用 `npm run --silent cli -- ...`，npm 脚本加载本地 `.env`，直接 Node 启动不自动加载。

所有命令可指定 `--data-dir <绝对目录>`，优先于 `LINGBRANCH_DATA_DIR`；未配置时仍按应用源码位置使用项目 `data/`，与当前工作目录无关。

| 命令 | 行为 |
| --- | --- |
| `help` 或 `--help` | 命令发现、默认资料目录、重试与冲突提示 |
| `status` | 返回目标目录与 `database_present/not_initialized`；不打开或新建数据库，不证明其内容可用 |
| `tools` | 14 个实际工具名、描述、读写属性与 JSON schema；不打开数据库 |
| `list` | 默认一页；`--limit 1–50`、`--cursor`、`--include-archived true\|false` |
| `list --all` | 从第一页遍历，检查数量、重复与游标推进；成功含 `complete:true/pages`，不得与 `--cursor` 同用 |
| `search --query <文字>` 或 `search --tag <标签>` | 与 MCP 搜索共用范围与分页，可加 `--all` |
| `read <UUID>` | 完整内容、附件索引、布局与当前版本 |
| `call <工具名>` | 接受 `--json <JSON>`、`--json-file <文件>` 或 `--json-file -`（stdin），未指定时为 `{}`；实际参数按上文工具 schema 校验 |

stdout 仅有一个 JSON 结果。成功为 `{ok:true,...工具结果}`，失败为 `{ok:false,code,message}` 且退出码为 1。输入、未知命令和未知工具在打开数据库前拒绝；JSON 最大 32 MiB。SQLite 提示走 stderr，不混入结果。

`list --all` 检查每页的总数量、记录标识、继续游标与最后计数；资料范围变化导致无法证明完整时返回 `conflict`，不输出部分结果作为全量成功。普通分页和业务记录更新仍遵循原有工具合同。

CLI 是本地文件访问入口，没有网页登录、远程 URL 或 OAuth 选项。数据操作可初始化尚不存在的目录；操作前用 `status` 确认目标。新建、编辑、标签与附件调用继续要求调用者提供稳定请求键，CLI 不自动替换它，也不自动绕过版本冲突。

## 可安装技能

[skills/lingbranch/SKILL.md](../skills/lingbranch/SKILL.md)提供资料操作和部署的路由，优先使用已连接 MCP，再使用 CLI。技能助手依赖本机已安装的 LingBranch 项目，配置 `LINGBRANCH_PROJECT_DIR` 与 `LINGBRANCH_DATA_DIR` 为用户自己的绝对路径。

`npm run --silent skill:install` 默认复制到 `~/.agents/skills/lingbranch`；也接受一个末级名为 `lingbranch` 的绝对目标技能目录，保证目录与 frontmatter 的 name 一致。复制正文、CLI 参考、助手脚本与许可证共 4 个普通文件，不建立软链接。任何已存在的目标，包括空目录或软链接，均拒绝覆盖。

安装只复制技能文件，不修改 MCP/AI 客户端配置或模型账号，不创建凭据，也不表示客户端已加载该技能。通过其实际加载流程接入，并在操作前核对同一资料目录。搬移后的使用规则见 [CLI 参考](../skills/lingbranch/references/cli.md)。
