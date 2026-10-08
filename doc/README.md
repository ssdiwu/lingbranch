# 长期说明导航

本目录保存当前架构、运行接口、来源依据与验证证据。产品行为与验收的唯一正文在 [首条使用路径规格](../spec/local-first-library.md)，共用词义和体验分别在 [GLOSSARY.md](../GLOSSARY.md) 与 [DESIGN.md](../DESIGN.md)。

| 问题 | 入口 |
| --- | --- |
| 关系优先画布的实现、位置恢复与验证边界 | [关系画布记录](relationship-canvas.md) |
| 当前续办状态与下一动作 | [根 PROGRESS](../PROGRESS.md) |
| 两种运行方式的共同要求与平台差异 | [运行边界](editions.md) |
| 已完成的 0.0.2 源码、标签与发行 | [版本交付记录](release-0.0.2.md) |
| 独立版怎样共享资料库、保证保存与恢复 | [运行架构](architecture.md) |
| 图文如何共用正文、分阶段保存、升级与兼容 | [图文架构](architecture.md#图文正文的共享语义与保存)、[正文接口](interfaces.md#正文格式与图片引用) |
| 本机及服务器怎样配置 | [运行说明](running.md) |
| MCP、CLI、HTTP、技能与重试/冲突参数 | [接口合同](interfaces.md) |
| 如何让自己的 AI 使用灵感库 | [README 接入导航](../README.md#让自己的-ai-帮忙)、[技能正文](../skills/lingbranch/SKILL.md) |
| MiniMax Code 如何加载工作区 skill 与 MCP，哪些客户端已实测 | [客户端接入说明](ai-clients.md) |
| 哪些检查通过、哪些尚未验证 | [验证记录](verification.md) |
| 交付审查发现什么、怎样修复与复验 | [交付审查](review.md) |
| CLI 与技能接入的审查结果 | [CLI/技能审查](review-cli-skill.md) |
| 如何复用现有原型，哪些资料受保护，发布前还需哪些依据 | [来源与发布边界](source-boundaries.md) |

本目录不维护第二份产品规格或动态任务状态表。返回 [项目入口](../README.md)。

0.0.3 定版、验证及GitHub渠道读回见 [交付记录](release-0.0.3.md)，各阶段历史与运行验收继续分别成立。
