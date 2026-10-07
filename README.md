# LingBranch · 灵枝

自己部署，让你和 AI 共同整理灵感。

个人灵感画布，一人一库。网页、MCP 与 CLI 操作同一份 SQLite 数据库和附件目录。基础功能不调用大模型 API，不需要维护者的网站账号。

## 让自己的 AI 帮忙

可以把仓库链接和这句话交给自己的 AI：

> 请按 LingBranch README 部署个人灵感库，保护已有数据；选择你的客户端支持的 MCP 或 CLI 接入方式，核对数据目录并验证读取。需要技能时按本文安装，未验证的平台能力请明确说明。

| 你要做什么 | 从这里开始 |
| --- | --- |
| 在电脑上运行网页 | [本机运行](#本机运行) |
| 让支持 MCP 的 AI 操作灵感库 | [连接 MCP](#连接-mcp) |
| 让能执行命令的 AI 操作灵感库 | [使用 CLI](#使用-cli) |
| 给 AI 安装使用说明与助手脚本 | [安装 skill](#安装-skill) |
| 在 MiniMax Code 中完成接入 | [已验证的客户端步骤](doc/ai-clients.md) |
| 部署到自己的服务器 | [自有服务器](#自有服务器) |

参与开发的 AI 先读 [AGENTS.md](AGENTS.md)及 [当前进度](PROGRESS.md)。已有资料库先确认位置，部署和更新时保留数据目录。

## 本机运行

需要 Node.js **22.22.3 或更新版本**与 npm。当前验证环境为 macOS、Node.js 22.22.3；该版本的内置 SQLite 会在 stderr 打印实验性功能提示。真实命令来自 [package.json](package.json)。

```sh
git clone https://github.com/ssdiwu/lingbranch.git
cd lingbranch
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4280>，首次运行得到空资料库。默认数据在本项目的 `data/` 下，与启动命令的工作目录无关。停止后重新启动，内容、附件、连线和布局保持。

需要更改配置时，将 [.env.example](.env.example) 复制为自己的 `.env`：用 `LINGBRANCH_DATA_DIR` 指定绝对数据路径、`LINGBRANCH_PORT` 修改端口。网页、MCP 和 CLI 使用**同一绝对数据目录**。不要删除 `data/` 或将其提交到 Git。

不需要自定义数据位置时，保留模板中 `LINGBRANCH_DATA_DIR` 的注释，继续使用项目 `data/`。启用该行时，把 `/absolute/path/to/library` 替换为自己的真实目录；这个占位值本身是有效的绝对路径，程序不会把它识别为未完成配置。

`npm run dev` 启动仅监听回环地址的开发模式；日常使用与部署使用构建后的入口。原件、持久化和运行环境限制见 [运行说明](doc/running.md)。

## 连接 MCP

支持本地 MCP stdio 的客户端可添加以下配置。先完成 `npm ci`，把 Node.js、项目和数据目录替换为自己机器上的绝对路径：

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

客户端各有自己的配置位置和加载方式，按它的说明添加并重新加载工具。这里直接运行 `node`，避免 npm 的脚本提示混入协议标准输出。直接启动 MCP 不自动加载项目 `.env`，因此数据目录显式配置在 `env` 中。

应把配置交给客户端实际的 MCP 加载入口；仅保存一个示例 JSON 文件不等于已经连接。以该客户端发现的工具及实际调用回执核验，独立脚本握手只能证明 MCP 服务本身可用。

MiniMax Code 3.1.1 已验证工作区 `.mcp.json` 与新会话加载，具体位置和 skill 安装见 [客户端接入说明](doc/ai-clients.md)。该文件包含本机配置，不应提交；本仓库已忽略仓库根的 `.mcp.json`。工作区位于仓库之外时，需要在所属 Git 项目中另行忽略。

接入后让 AI 发现工具，应看到 **14 个工具**，再调用 `list_inspirations` 并沿 `nextCursor` 读到完成；如果库为空，应明确返回空结果。按用户要求保存或修改后，再用 `read_inspiration` 读回，网页刷新能看到同一结果。

MCP 使用本机文件权限，不要求网页登录或 OAuth，也不配置模型。它不会因为网页已部署到远程服务器而自动获得那台服务器的文件访问能力。工具参数、重试与冲突合同见 [接口说明](doc/interfaces.md)。

## 使用 CLI

能运行本机命令的 AI 可以通过 CLI 使用同一套 14 个工具，无需先配置 MCP。先查看目录与当前工具 schema：

```sh
npm run --silent cli -- status
npm run --silent cli -- tools
npm run --silent cli -- list --all
npm run --silent cli -- search --query "公园" --all
```

CLI 返回 JSON；成功为 `ok:true`，失败为 `ok:false` 且退出码非零。`status` 不打开或创建数据库，只显示目标目录和数据库文件是否存在；资料操作在目标不存在时初始化空库。`tools` 返回实际工具名与 JSON 参数 schema。

解析结果时分开 stdout 与 stderr，不要先用 `2>&1` 合并再按 JSON 解析；Node.js 的 SQLite 提示可能混入结果。例如：`npm run --silent cli -- list --all > result.json 2> cli.log`。

从任意工作目录启动可直接用绝对路径，也可以用 `--data-dir` 覆盖数据目录：

```sh
node /absolute/path/to/lingbranch/cli/lingbranch.mjs --data-dir /absolute/path/to/library list --all
node /absolute/path/to/lingbranch/cli/lingbranch.mjs --data-dir /absolute/path/to/library read UUID
```

`UUID` 替换为列表返回的灵感 ID。CLI 直接运行不自动加载 `.env`；以上显式路径避免在不同命令或 AI 会话中误用另一份资料库。npm 的 CLI 脚本会加载项目 `.env`，使用 `--silent` 保持 stdout 为 JSON。

保存、更新、标签、连线与附件均通过 `call` 调用现有工具。长正文优先使用 JSON 文件：

```sh
npm run --silent cli -- call create_inspiration --json-file /absolute/path/to/request.json
npm run --silent cli -- call update_inspiration --json-file /absolute/path/to/update.json
```

请求的实际字段从 `tools` 获取。新建与修改提供稳定 `idempotencyKey`，更新前读取 `expectedUpdatedAt`；重试保留原参数，冲突后先核对当前记录。分页、stdin、命令与错误格式见 [CLI 接口](doc/interfaces.md#本地-cli)。

## 安装 skill

仓库提供 [skills/lingbranch/SKILL.md](skills/lingbranch/SKILL.md)，包含部署与资料操作的路由、重试规则、CLI 参考和可搬移的助手脚本。按 [Agent Skills 格式](https://agentskills.io/specification)组织；具体客户端是否加载技能，以客户端实际支持为准。

安装到本机 `~/.agents/skills/lingbranch`，或显式指定自己的 AI 技能目录：

```sh
npm run --silent skill:install
# 其他技能目录可指定到完整目标文件夹
npm run --silent skill:install -- /absolute/path/to/skills/lingbranch
```

两条命令择一执行，目标末级目录保持为 `lingbranch`，与技能名称一致。安装器复制 **4 个普通文件**：技能正文、CLI 参考、助手脚本和许可证；目标已存在会拒绝覆盖。已有技能先检查版本差异，或选择新目录。技能加载可能需要客户端重新扫描或重启。

安装后，CLI 助手由显式配置定位项目。例如在仓库目录执行：

```sh
LINGBRANCH_PROJECT_DIR="$PWD" \
LINGBRANCH_DATA_DIR="$PWD/data" \
node "$HOME/.agents/skills/lingbranch/scripts/lingbranch.mjs" status
```

`LINGBRANCH_PROJECT_DIR` 指向已安装依赖的仓库；`LINGBRANCH_DATA_DIR` 与网页/MCP 一致。若客户端每次启动新 shell，每次调用都传入这些配置。助手脚本依赖本机的 LingBranch 项目，不包含整个应用；安装 skill 也不会自动配置 MCP 或更改模型账号。

助手脚本直接运行时不自动读取项目 `.env`。若其运行进程没有设置 `LINGBRANCH_DATA_DIR`，当前实现会使用项目 `data/`，而非网页 `.env` 中的自定义目录；先核对 `status.dataDir`，再执行资料操作，不能只看 `ok:true` 就认定连接到了预期资料库。

## 已建立的使用入口

- 网页：关系画布先呈现圆点与完整单行原标题，可查看聚合依据并准确高亮标签成员，点选展开统一 3∶4 卡片，再点卡片进入右侧详情；选中时突出已有直接关联，可聚焦邻居或返回全部。新建默认可视化图文正文，文字与图片可交错。另有来源与标签、画布拖动与键盘移动、检索、分页全量列表、临时筛选布局、连线及归档恢复。
- 正文：点击「插入图片」在当前正文位置选择本机图片，也可粘贴；输入 `/` 选择标题、列表、引用等，选中文字可排版。旧记录保持纯文本，切换图文时按字面保留符号；切回纯文本保留文字与图片说明，原件继续可访问。基础图文不调用模型 API。
- 语法：编辑与读取统一为 CommonMark，支持粗体、斜体、标题、列表、引用、显式链接、代码和图片；不启用裸 URL 自动链接、删除线、任务列表和表格，避免旧文字进入编辑器后被重新解释或追加转义字符。
- 图文保存：原件先保存，完整正文最后提交并读回；保存期间暂停编辑。失败保留草稿和阶段请求，重试不重复创建记录或原件。详情保留大图、文件下载及未插入正文/暂不能预览的图片原件。
- 位置：新节点避让已有节点；「整理位置」按已有关系与共享标签安排全部活跃节点，完整标题参与避让，默认视野保持可读，最多 1000 条，原位置可恢复或下载。任何版本冲突整批拒绝，筛选与关联聚焦中的拖动仍是临时显示。具体操作及验证见 [关系画布说明](doc/relationship-canvas.md)。
- 保存：稳定请求标识防重复，更新检查版本；冲突保留草稿，核对最新内容后继续。顶部刷新按钮读取 AI 的最新修改。
- 附件：保存完整原件，最多 20 MiB；校验字节数、SHA-256 和已知格式签名。UTF-8 文本可索引，也可手填关键文字；不提供图片 OCR 或 PDF 全文识别。
- AI：本地 MCP 和 CLI 共用工具分发与操作规则。MCP 已用官方 TypeScript SDK 客户端验证，并在 MiniMax Code 3.1.1 完成原生工具发现、检索、更新和读回；已验证客户端的配置见 [接入说明](doc/ai-clients.md)。
- 备份：网页「导出全部资料」或命令行导出完整资料包，包含附件原件、关系、布局及重试凭据；恢复只写入新目录。

产品要求以 [首条使用路径规格](spec/local-first-library.md) 为准，验证事实与限制见 [验证记录](doc/verification.md)。这些入口不代表所有平台或 AI 客户端已适配。

## 备份与恢复

```sh
npm run backup -- /absolute/path/to/backup.lingbranch.json.gz
npm run restore -- /absolute/path/to/backup.lingbranch.json.gz /absolute/path/to/new-library
```

导出文件和恢复目录均不能已存在。当前导出版本 2，包含正文格式；支持按原结构校验并恢复版本 1 的旧包。恢复先校验资料包、关系、正文图片与附件，再交付新目录，不覆盖正在使用的数据。切换到恢复库时，停止网页、MCP 与其他资料操作，更新数据目录，再重新启动。升级前同样先停止这些入口并备份；首次打开旧库只补纯文本格式，旧正文不会自动成为 Markdown。

首版资料包解压后上限 128 MiB。不要只复制正在写入的 SQLite 主文件作为备份；保存完整状态使用上述导出入口。导出包含完整个人资料，应自行保管。

## 自有服务器

设置 `LINGBRANCH_MODE=server`、`LINGBRANCH_ORIGIN` 和至少 32 字符的 `LINGBRANCH_TOKEN`。缺少保护配置会拒绝启动，网络站点要求 HTTPS。网页登录使用 HttpOnly 会话，HTTP 接口可使用 Bearer 令牌。

运行、反向代理与持久化边界见 [服务器配置](doc/running.md)。已在本机验证服务器模式的访问保护，尚未在真实服务器部署。

当前 MCP 和 CLI 使用本地文件，**不提供远程 HTTP MCP 或 OAuth**。远程自动化可按 [受保护 HTTP 接口](doc/interfaces.md#http)接入；`/api/tools` 是 JSON 工具调用接口，不能当作 MCP 地址填写。其他 AI 的站点部署功能需要支持 Node.js 服务与持久磁盘，静态托管不能承载这套后端。

## 工程检查与导航

```sh
npm run check
npm run licenses
```

`check` 执行 TypeScript 检查、网页构建和集成测试，测试使用临时资料库；网页视觉与交互验收单独记录。`licenses` 从锁文件和安装包重新生成依赖许可清单与声明。

| 问题 | 入口 |
| --- | --- |
| 协作与保护边界 | [AGENTS.md](AGENTS.md) |
| 当前续办、未完成与下一动作 | [PROGRESS.md](PROGRESS.md) |
| 共同功能交付与运行差异 | [两版边界](doc/editions.md) |
| 本轮本地与渠道状态 | [0.0.3 记录](doc/release-0.0.3.md) |
| 已公开发行的版本 | [0.0.2 交付记录](doc/release-0.0.2.md) |
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
| `shared/` | 网页与服务共用的 Markdown 语义；单份草稿的分阶段保存请求协调 |
| `server/library.mjs`、`server/validation.mjs` | 共用操作、事务、校验与附件持久化 |
| `server/http.mjs` | 网页与 HTTP 接口、访问保护 |
| `server/mcp.mjs`、`server/tools.mjs` | stdio MCP 与网页/CLI 共用工具分发 |
| `cli/lingbranch.mjs` | 本地 JSON 命令行入口与完整分页 |
| `skills/lingbranch/` | 技能正文、CLI 参考与可复制的助手脚本 |
| `server/bundle.mjs`、`server/backup.mjs` | 导出、校验和隔离恢复 |
| `tests/` | HTTP、独立 MCP、CLI、技能安装、故障及重启验证 |
| `scripts/`、`vendor/` | 技能安装、离线维护脚本、复用样式与第三方声明 |
| `spec/`、`doc/` | 当前行为规格与工程依据 |
| `data/`、`dist/`、`node_modules/` | 本地数据、构建和依赖，不进入 Git |

源码仓库为 [ssdiwu/lingbranch](https://github.com/ssdiwu/lingbranch)，项目采用 [MIT License](LICENSE)，第三方材料保留各自许可与声明。当前源码版本为 **0.0.3**（已本地提交，公共渠道仍为 0.0.2），变化见 [CHANGELOG](CHANGELOG.md)。版本标签、GitHub Release 与真实服务器部署分别核验。`private: true` 保留用于避免误发布 npm。
