# AI 客户端安装与使用

本说明记录已实测的接入方法。网页与 AI 始终使用同一绝对数据目录；应用安装从 [README 本机运行](../README.md#本机运行)开始，参数与保存规则以 [接口合同](interfaces.md) 为准。

## MiniMax Code

已在 macOS 的 MiniMax Code 桌面版 **3.1.1**验证工作区 skill（技能）加载，以及本地 MCP（模型上下文协议）工具发现、检索、更新与读回。首次克隆、构建和 CLI（命令行入口）使用在更新前的 3.1.0 完成。日期、源码基线和未覆盖范围见 [验证记录](verification.md#真实-ai-客户端接入)。

1. 安装 Node.js 22.22.3 或更新版本，按 README 克隆 LingBranch、执行 `npm ci` 和 `npm run build`，再用 `npm start` 启动网页。首次启动用自编内容验证，已有资料库先确认其位置。
2. 在 MiniMax Code 打开自己要工作的目录，以下称为“工作区根目录”。本次测试打开的是包含 LingBranch 仓库的父目录；配置放在客户端实际打开的工作区根，不按仓库名猜位置。
3. 从 LingBranch 仓库目录将 skill 安装到该工作区：

   ```sh
   npm run --silent skill:install -- /absolute/path/to/workspace/.agents/skills/lingbranch
   ```

   将示例工作区路径换成自己的路径。安装会复制四个普通文件；目标已存在时拒绝覆盖，先核对旧版本或选择另一个工作区。skill 提供操作说明与 CLI 助手，不会自动连接 MCP。

4. 将 [README 的 MCP JSON 配置](../README.md#连接-mcp)保存为工作区根的 `.mcp.json`。替换 Node.js、仓库和数据目录的绝对路径；其中 `LINGBRANCH_DATA_DIR` 必须与网页一致。如果已有 `.mcp.json`，在保留原服务的前提下添加 `mcpServers.lingbranch`，不要覆盖整份配置。
5. 新建该工作区的会话，让客户端重新发现 skill 和 MCP。按客户端实际提示允许使用本地工具；本轮无需改全局 MCP、模型账号或全局技能配置。
6. 让 AI 先加载 `lingbranch` skill，确认发现 13 个 LingBranch MCP 工具，再列出记录、搜索并读取一条。对自己允许修改的测试记录，读取当前版本后更新，并再次读回；网页使用刷新入口读取同一修改。

| 放置位置，相对于客户端工作区根 | 用途 |
| --- | --- |
| `.agents/skills/lingbranch/SKILL.md` 及随附文件 | 客户端发现并加载 LingBranch 的操作说明 |
| `.mcp.json` | 客户端启动本地 LingBranch MCP 进程 |
| LingBranch 仓库 | 已安装依赖的应用、MCP 和 CLI 实现，可位于工作区内另一目录 |
| 自己选择的绝对数据目录 | 网页、MCP 与 CLI 共同保存资料，可位于仓库之外 |

本机配置不应提交公开仓库。LingBranch 已忽略仓库根的 `.mcp.json` 与 `.agents/`；如果工作区是另一份 Git 项目，也应在那里保护这些本机配置。

可在新会话交给 AI 以下指令，并把测试记录换成自己明确允许修改的对象：

> 加载 lingbranch skill，通过当前已连接的 LingBranch MCP 列出全部记录并报告读取是否完成。先读取指定测试记录，保留标题、来源和标签，只在正文末尾加“客户端接入验证”；提供当前 expectedUpdatedAt 和稳定 idempotencyKey，更新后再次读取。发生冲突先停下核对，不自动覆盖。最后报告记录 ID、当前版本和实际使用的入口，我会在网页刷新确认。

## 没有发现工具时

先核对 MiniMax Code 打开的工作区与文件位置，再开新会话。检查 Node.js 路径可执行、仓库已安装依赖、MCP 中的数据目录为绝对路径。仅保存 `mcp.local.json` 等示例文件、读取 `SKILL.md` 或运行独立握手脚本，均不能证明客户端已加载原生工具。

能执行本机命令的 AI 可以继续使用 [CLI 入口](../README.md#使用-cli)。直接运行 CLI 或技能助手时，显式提供项目和数据目录；它们不会自动读取项目 `.env`。先运行 `status` 核对 `dataDir`。分别读取 stdout 与 stderr，避免 SQLite 提示混入 JSON；新建和更新参数从 `tools` 获取，写入后读回。

## 其他客户端与服务器

本次 Z Code 尝试在模型创建前置环节失败，尚未完成其桌面版接入验证。其他支持本地 stdio MCP 的客户端可参照 README 配置，但必须以该客户端的实际工具发现和调用结果验收，不能外推为全部兼容。

网页部署到自有服务器后，本地 MCP 不会自动访问服务器磁盘。当前接入要求 AI 工具与应用具备同一资料库的文件访问能力；远程自动化见 [受保护 HTTP 接口](interfaces.md#http)，尚未提供远程 HTTP MCP 或 OAuth。
