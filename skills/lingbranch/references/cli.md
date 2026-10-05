# CLI 参考

先设置 `LINGBRANCH_PROJECT_DIR` 与 `LINGBRANCH_DATA_DIR`。下面的 `<skill-directory>` 是已安装技能的绝对目录，由客户端提供，不是项目仓库地址。

```sh
node <skill-directory>/scripts/lingbranch.mjs status
node <skill-directory>/scripts/lingbranch.mjs tools
node <skill-directory>/scripts/lingbranch.mjs list --all
node <skill-directory>/scripts/lingbranch.mjs search --query "公园" --all
node <skill-directory>/scripts/lingbranch.mjs read <灵感UUID>
```

实际执行时替换尖括号部分，勿原样交给 shell。也可以直接运行项目中的 `cli/lingbranch.mjs`，无需安装技能。运行 `help` 查看完整 CLI 参数。

## 通用工具调用

CLI `call` 复用 MCP 的全部工具及严格参数校验；运行 `tools` 获取当前 JSON schema。使用 JSON 文件或 stdin 可以避免 shell 转义与长正文问题：

```sh
node <skill-directory>/scripts/lingbranch.mjs call create_inspiration --json-file /absolute/path/to/request.json
node <skill-directory>/scripts/lingbranch.mjs call update_inspiration --json-file /absolute/path/to/update.json
```

新建请求格式：

```json
{
  "title": "公园观察：周末散步选题",
  "body": "自行编写的内容，尚未验证的想法按候选保存。",
  "tags": ["观察"],
  "idempotencyKey": "caller-supplies-a-stable-key"
}
```

`idempotencyKey` 由调用者按本次操作生成，8–100 字符，只含字母、数字、下划线和短横线。示例键需替换；同一请求重试保留原键，不能为每次尝试换新键。

更新请求携带 `id`、刚读回的 `expectedUpdatedAt`、稳定请求键和 `patch`。连接使用 `connect_inspirations` 的 `fromId/toId`，移除连线使用工具返回的 `connectionId`。标签、归档和附件也通过实际工具 schema 调用。

## 图文请求

以上旧新建示例省略 `bodyFormat`，仍为纯文本。明确要图文时指定 `bodyFormat:"markdown"`。先取得记录 ID，调用 `attach_inspiration_file` 保存本机图片原件，再提交正文：

```json
{
  "id": "replace-with-the-record-uuid",
  "expectedUpdatedAt": "replace-with-the-confirmed-version",
  "idempotencyKey": "replace-with-a-stable-body-write-key",
  "patch": {
    "bodyFormat": "markdown",
    "body": "图片前的说明。\n\n![截图说明](attachment:replace-with-the-owned-image-uuid)\n\n图片后的说明。"
  }
}
```

这些占位值必须从真实回执替换后再调用；它们不是有效 UUID 或版本。仅支持该灵感所属、已保存的 PNG/JPEG/GIF/WebP 图片作为正文引用。文件原件可保存而不置入正文，SVG 等不可预览图片保留原件读取。不要把 blob/data、外链或本机文件路径写入图文来源，不自动下载外部图片。

新记录可以先保存空正文；已有记录不先清空。新建、各个上传、最终正文分别使用稳定键，响应丢失沿原参数重试；最终读回正文、格式、图片顺序和原件摘要。发生版本冲突先核对，不自动换新版本覆盖。旧文本转图文须按字面转义，不能让原图片语法变成真实引用或外部加载。

## 结果、分页与错误

- stdout 是一个 JSON 结果；成功为 `ok:true`，失败为 `ok:false` 且退出码非零，SQLite 提示走 stderr。
- `list` 默认一页，可用 `--limit 1–50`、`--cursor` 和 `--include-archived true|false`。
- `--all` 从第一页读取，完成后含 `complete:true`、`pages` 和总数量。不得与 `--cursor` 同用；分页变化或数量不符时返回错误，不报告全量完成。
- `call --json-file -` 从 stdin 读 JSON。输入最多 32 MiB，附件仍遵循单文件 20 MiB 的业务上限。
- `status` 只确认路径及数据库文件是否存在，不证明数据完整性、权限可用或某个 AI 客户端已连接。
- 没有本地文件访问能力时，不能使用此 CLI 访问另一台服务器的资料库；按服务器 HTTP 接口及其保护配置处理。
