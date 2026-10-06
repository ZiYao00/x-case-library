# Storage Layout V2 验收

日期：2026-10-06

## 目标

把正式 X 案例从“每篇笔记一个可见目录”改为阅读层 / 数据层分离，减少 Obsidian 文件树层级，同时保持 Tweet ID 身份、source truth、媒体、repair、duplicate detection 与 Batch 行为不变。

## 正式布局

```text
notes/x/
├─ 00-待整理/<title>.md
├─ 作者/<author.username>/<title>.md
└─ _case-data/<tweet-id>/
   ├─ source.json
   └─ media/
```

采集 staging 仍保持 `notes/x/00-待整理/<tweet-id>/`，只在 finalize 时拆分为正式 Layout V2。

## Case Resolver

正式案例以 Tweet ID 为稳定 Case Identity。Resolver 同时支持：

- Legacy V1：Markdown / source.json / media 位于同一个标题目录；
- Layout V2：source/media 位于 `_case-data/<tweet-id>`，Markdown 可位于 `00-待整理` 或 `作者/<username>`；
- runtime 中旧绝对路径只作为缓存；已完成任务可以按 Tweet ID 恢复当前正式路径。

## 迁移

全库首次 dry-run：

- Legacy V1 正式案例：33
- 目标路径冲突：0
- source / Markdown 哈希预检：通过

Pilot：

- 图片案例 `2107108350299443342`：4 张图片
- 视频案例 `2106679751566094429`：1 个 MP4
- 两例迁移后均可由 `prepare` 返回 `existing_case_found`
- 旧 runtime 路径案例可由 Tweet ID 自动修复
- 无 runtime 的历史案例可直接由 Tweet ID 恢复为 `note_ready`
- 项目 Markdown 与 Obsidian Junction 内容一致
- Vault 可访问迁移后的图片 / MP4

全量迁移：

- Pilot：2
- 后续迁移：31
- 合计：33
- 每个案例均在迁移时校验 source SHA-256、Markdown SHA-256 与 V2 Resolver
- 未触发回滚

迁移 manifest 保留在 Git-ignored：

```text
.runtime/layout-v2-migrations/
```

## Obsidian

共享仓库 `obsidian-learning-snippets` 的 `x-case-note.css` 升级到 v0.7：

- 隐藏 `X案例库/_case-data` 根目录；
- 保留 Legacy V1 的 `media/` 和 `source.json` 隐藏规则；
- 已通过共享仓库同步脚本同步到 Vault；
- Vault 中 CSS 与共享仓库真源内容一致。

本次主机没有 Obsidian GUI 控制能力，因此没有重新执行“点击 Gallery / MP4 弹窗”的交互验收；Media Viewer 2.2.1 的既有真实弹窗验收仍保留，且本次文件路径/Junction/媒体存在性检查通过。

## 回归

Layout V2 实现完成后：

- single-case workflow：24 / 24 PASS
- link preservation：7 / 7 PASS
- Batch V1：9 / 9 PASS

总计：40 / 40 PASS。

## 结论

**READY**

Storage Layout V2 已完成代码兼容、真实全库迁移、CSS 隐藏与文件层验收。以后按作者整理只移动 Markdown，不再移动 source/media 数据包；用户在 Obsidian 中展开作者目录后可以直接看到笔记文件。
