# X 案例 Skill 安装与使用

Skill 名称：`x-learning-automation`。唯一真源是项目内 `skill/x-learning-automation`；本地 Agent 使用 Junction，不维护副本。

## Codex 安装

在 PowerShell 中，先把项目路径替换为实际已指定项目。目标存在时先检查 `LinkType/Target`，不得覆盖旧目录。

```powershell
$source = (Resolve-Path 'G:\GitHub\x-case-library\skill\x-learning-automation').Path
$parent = Join-Path $env:USERPROFILE '.agents\skills'
$target = Join-Path $parent 'x-learning-automation'
if (Test-Path -LiteralPath $target) {
    Get-Item -LiteralPath $target | Format-List FullName,LinkType,Target
} else {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    New-Item -ItemType Junction -Path $target -Target $source
}
```

安装后启动新会话，让宿主重新发现 Skill。只有新会话能看到它，才算发现机制通过；文件可读不等于宿主已加载。

## 环境验收

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$target\scripts\local_bridge.ps1" onboarding
```

`ready` 表示本机文件检查通过：固定版 XActions、可写 notes/x、Vault 根目录、Vault → 项目 notes/x 的 Junction、Media Viewer 已安装且启用。CSS 缺失或未启用是非阻塞 warnings，不静默复制或覆盖。

onboarding 不访问 X，不证明接口当前可用，也不验证 Obsidian 弹窗和复制按钮的实际 UI 行为。首次真实验收用用户提供的一条链接，不自动重试。

配置在 `config/local.json`，示例见 `config/local.json.example`。`notes_root` 当前固定为项目内 `notes/x`；不接受工作区外的笔记真源。依赖缺失时由用户明确决定安装，不在日常流程自动安装软件。

## 日常输入

```text
https://x.com/author/status/123456789
整理这个 X 帖子：https://twitter.com/author/status/123456789
使用 x-learning-automation 整理：帖子链接
```

只发一个帖子链接默认生成笔记。支持 x.com/twitter.com 精确域名、常规 status 路径、`i/web/status` 和 `i/status`、分享查询参数、`photo/N` / `video/N` 后缀。用户明确要求批量转换多条显式 status URL，或明确要求“把这篇已入库合集里的 X 帖子全部转了”时，使用 Batch V1 并先读 `docs/BATCH-OPERATIONS.md`；合集入口只展开该正式 source 中已经采集的一层结构化 X status 链接，不递归子帖。GitHub、主页、搜索页、短链等不会进入 Batch 网络队列。明确的“讨论/分析链接/不保存”优先，不因出现链接就采集。

新案例由 Agent 通过 bridge 或项目统一入口执行 `prepare → 编辑 analysis.json → validate → 阅读 preview.md → finalize`。用户明确要求更新已有正式案例时改用 `repair → 编辑 analysis.json → validate → 阅读 preview.md → finalize`。显式多链接批量转换使用 `batch init → batch next → 单案例完整流程 → batch record`；已入库合集可先用 `batch from-case <tweet-id> --dry-run` 预览，或用 `batch from-case <tweet-id>` 创建同一 Batch V1 manifest，然后继续相同的 `next / 单案例 / record` 生命周期。详细契约只看 `docs/BATCH-OPERATIONS.md`。用户无需手工写 JSON。原帖文本分段后拼接必须逐字符一致，程序负责生成/替换 Markdown；普通 prose 的外部 Markdown/HTML 由 renderer 中和，只恢复 source 提供的安全链接。普通非中文正文追加中文翻译，Prompt 保持原文。作者明确数量与可直接计数 source 明显不一致时，`analysis.sourceCheck` 只写一句；否则留空。只有 `note_ready` 才表示单案例完成。

Layout V2 中，正式 Markdown 位于项目内 `notes/x/00-待整理/<标题>.md`（整理后可移动到 `notes/x/作者/<username>/`），正式 `source.json + media/ + 可选 documents/` 位于 `notes/x/_case-data/<tweet-id>/`。Article `MARKDOWN` atomic 会落为 `<tweet-id>_<来源完整文件名>` 并在主笔记原位置生成 WikiLink。Obsidian Junction 映射查看，`_case-data` 默认由共享 CSS 隐藏。runtime/analysis/preview 位于 `.runtime/<tweet-id>`，不进 Git；runtime 中旧绝对路径不是案例身份，程序按 Tweet ID 重新解析当前正式位置。

## 重复、续写与失败

- 正式案例重复链接：Case Resolver 只有在同一 Tweet ID 能解析到唯一数据包与一个可读非空 Markdown 时才返回 `existing_case_found`，不联网、不覆盖；缺失、重复或歧义 Markdown 则 `action_required`。只有用户明确要求更新/修复时才能改走 `repair`；repair 在 `.runtime` 重新采集并比较，validate 前不碰正式案例，finalize 前再次核对旧文件哈希并保存 `before/` 回滚证据；若 finalize 中途失败，会恢复旧 source/Markdown/被覆盖 media/documents，并清理本轮新增正式媒体/documents。
- 尚未完成但 source.json 已存在：复用材料，保留 analysis；来源哈希变化则拒绝继续，不能自动刷新基线。
- 采集失败或只有旧任务而无材料：停止，先检查 job/failure，不自动重试。不要删除目录绕过状态；修复方案需按具体失败证据决定。
- 媒体缺失或回复获取失败：有足够来源时生成标记为“部分”的笔记；匿名 SSR 无法证明线程完整时标记“待确认”。
- 标题冲突：复用已有命名规则，必要时追加 Tweet ID；冲突仍存在则停止，不能覆盖。
- 不自动分类作者、不抓普通评论、不提交或推送。单案例不自动使用账号；Batch V1 永久 Guest-only，账号尝试固定 0 / 0，即使环境误设 `XACTIONS_ALLOW_ACCOUNT_SESSION=1` 也会在网络请求前停止。

## ChatGPT 网页版

网页版 ChatGPT 自身的远程 sandbox 不能直接访问本机 `G:\`。本 Skill 的网页端模式要求用户已连接并授权 CodexPro（或等价的本地工作区连接器）访问当前用户已授权的 `x-case-library` 本地工作区。

网页端安装 ZIP 后，Skill 应先通过连接器打开该项目并读取 `AGENTS.md` 与强制文档。单案例在本地工作区执行 `node scripts/run-x-case.mjs onboarding|prepare|repair|validate|finalize`；明确批量转换或合集展开则读取 `docs/BATCH-OPERATIONS.md` 并执行 `node scripts/run-x-batch.mjs init|from-case|status|next|record|resume`。不要在网页 sandbox 复制本地项目、模拟 Obsidian 写入或把 `local_bridge.ps1` 当成远程执行器。

若当前 ChatGPT 会话没有可访问该项目的本地连接器，应明确停止并说明缺少本地工作区访问；不能把“Skill 已安装”误报为“本地流程可执行”。

项目内 `skill/x-learning-automation` 是唯一 Skill 真源。网页端发布包只是该真源的可安装快照；项目更新后应重新打包并重新安装/更新网页端 Skill。

## 其他宿主

B 站项目采用的候选安装目录如下。X Skill 使用同一真源，但各宿主发现和执行兼容需要分别验证，不能将 Codex 验收视为所有宿主通过。

| 宿主 | 候选安装位置 |
| --- | --- |
| Hermes | `%LOCALAPPDATA%\hermes\skills\x-learning-automation` |
| WorkBuddy | `%USERPROFILE%\.workbuddy\skills\x-learning-automation` |

远程 ChatGPT sandbox 仍不能直接访问本机 G 盘；网页版发布包通过已连接的本地工作区连接器执行项目流程。Skill 不会扩大宿主工作区权限，其他工作区调用仍须符合宿主授权范围。

## 回滚

业务代码可通过 Git diff 审核；本任务不自动 commit/reset。卸载 Skill 时先确认安装路径确实是指向本项目的 Junction，由用户移除该链接，保留项目及笔记。不要递归删除或让脚本自动清理资料。
