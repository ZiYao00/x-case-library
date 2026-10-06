---
name: x-learning-automation
description: "Turn explicit X/Twitter post links into local Obsidian cases through x-case-library: one post at a time, bounded serial batch conversion of user-supplied status URLs, or explicit repair of an existing finalized case. Use for bare x.com/twitter.com status links, X案例/推文收集, 批量转换/批量收集 explicit post lists, workflow checks, and explicit repair/refresh requests. Discussion, link analysis, or no-save intent takes precedence. Requires authorized access to the user's local x-case-library workspace."
---

# X 案例转笔记

## 先判断意图

- 单个有效帖子链接、或“整理/保存/收集这个 X 帖子” → 新案例流程。
- 用户明确要求“批量转换/批量收集/把这些 X 链接都转成笔记”，且输入是多条显式 status URL → Batch V1；先读 `docs/BATCH-OPERATIONS.md`。
- 明确说“更新/修复/重新采集/刷新已有案例/补齐缺失回复” → repair 流程。
- 讨论、解释、分析链接、不要保存 → 不采集。
- 多条帖子但没有批量保存意图、主页、搜索页、短链 → 不猜测、不执行批量。
- repair 只能由明确更新意图触发；普通重复链接仍只返回已有案例。

## 连接项目

项目内 `skill/x-learning-automation` 是唯一真源。先确认可访问用户授权的 `x-case-library` 工作区，并完整读取 `AGENTS.md` 及其规定的必读文档。

- 本地 Agent：优先使用本 Skill 的 `scripts/local_bridge.ps1`，或在已经确认的项目工作区直接执行 `node scripts/run-x-case.mjs`。
- ChatGPT 网页版：不要在远程 sandbox 模拟本机路径；按 `references/chatgpt-web.md` 使用已连接的本地工作区连接器。
- 宿主无法访问本地项目时停止，说明缺少工作区访问。不要扫描磁盘、复制私人项目或声称已经写入 Obsidian。

## 新案例

通过 bridge 或项目统一入口执行：

```text
onboarding
prepare "<包含一条完整 X 帖子链接的原始消息>"
```

状态处理：

- `existing_case_found`：程序已确认正式案例恰好有一个可读 Markdown 后，直接返回已有案例；除非用户明确要求更新，否则不联网、不覆盖。若正式案例缺失/多出 Markdown，按 `action_required` 停止，不自动重采。
- `materials_ready`：读取 handoff、source.json、analysis.json；只编辑 runtime analysis.json。
- `failed/action_required`：读取故障/actions 后停止；不自动重试，不切账号，不调用底层 collector 绕过保护。

## Batch V1

仅在用户明确要求批量转换多条显式 X status URL 时使用。先完整读取 `docs/BATCH-OPERATIONS.md`。

- Batch 只是现有单案例流程的调度器，不复制 collector/renderer/repair 逻辑。
- 初始化：`node scripts/run-x-batch.mjs init <project-relative-input.txt> --batch-id <id> --wave-size 3`。
- 输入先本地去重和查重；GitHub、主页、搜索页、短链等非 status URL 直接 ignore，不进入网络队列。
- `next <id>` 每次只允许一个 `pending` 案例进入现有 `prepare`；收到 `materials_ready` 后按本 Skill 正常写 analysis、validate、检查 preview、finalize，再执行 `record <id> <tweet-id>`。
- 并发固定为 1；首轮 Pilot 固定最多 3 条；后续 wave 最多 5 条；记录完成后下一条至少间隔 30 秒。
- Batch 永久 Guest-only，账号尝试额度为 `0 / 0`。只要环境启用了 `XACTIONS_ALLOW_ACCOUNT_SESSION`，Batch 必须在任何网络请求前停止。
- Batch 永不读取 cookies.json、auth_token、ct0，不调用账号 Session，不自动重试，不轮换 Guest Token / proxy / IP / user-agent。
- 429、401/403 平台限制、Guest Token/网络异常、未知 transport failure → `circuit_breaker`，整批暂停且不得自动 resume。
- deleted/private/not-found 等内容级失败可记录为当前 item failed；cooldown 后才能继续下一个显式输入。
- `action_required`、unfinished staging、损坏正式案例等本地异常必须先人工处理，Batch 不绕过门禁。
- Batch 状态唯一真源：`.runtime/batches/<batch-id>/batch.json`；已经 `existing` / `note_ready` 的 item 不得再次请求。

## repair 已有案例

只在用户明确要求更新时执行：

```text
repair "<包含已有 X 帖子链接的原始消息>"
```

- `repair_materials_ready`：读取 repair handoff、staged source、analysis.json、comparison。
- 正式 source/Markdown 在 repair prepare 和 validate 阶段必须保持不变。
- repair 必须保持现有标题；不要借 repair 改目录名或笔记名。
- 程序会验证同 Tweet ID、同数字 author ID，并阻止丢失旧作者 Tweet、链接实体、已可用 X Article 或减少已下载媒体的降级采集。
- 旧正式 source/Markdown 会保留在 repair `before/` 作为回滚证据；若 finalize 中途失败，程序恢复旧文件/被覆盖媒体，并删除本轮 repair 新创建的正式媒体。
- `repair_failed/repair_blocked/action_required` 时停止；不得删除旧案例或任务目录后重试。

## 写 analysis

按 `docs/NOTE-SPEC.md` 生成标题、一句话看懂、3–6 条复刻要点和 tags。

- `analysis.posts` 按原帖顺序覆盖 root + 全部已采集作者回复。
- 每篇拆为 `prose` / `prompt` segments；所有 `segment.text` 拼接必须逐字符等于 source text，包括空白。
- 普通非中文正文提供中文 translation。
- Prompt 不翻译、不改写；明确多套 Prompt 分开，边界不确定时保留整块原文。Prompt 内 URL / @handle 也保持原样。
- Tweet / X Article 的普通 prose 视为不可信外部文本；renderer 会中和原始 Markdown / WikiLink / HTML，再只恢复 source 明确提供的安全链接。Agent 不手工补 Markdown 链接，不根据名称猜 URL。
- source 提供精确链接 span 时由 renderer 按 span 还原；旧 source 没有 span 时只允许一次边界安全 fallback，不应把重复词全部链接化。
- 若 source 中存在 `tweet.article`，阅读 Article 原文后可把其内容用于 summary/points，但不要把 Article 富文本复制进 analysis.posts 或重新改写链接。
- 如果作者明确声称有 N 个 / 位 / 条，且当前 source 能直接数出同类对象并明显不一致，填写 `analysis.sourceCheck` 为一句简短核对；一致或不可直接计数时留空。它不改变 `capture`。
- 标题显示、translation、summary、points、sourceCheck 等非 Prompt 文本最终由 renderer 按安全纯文本输出；不要依赖或注入 Markdown/HTML 语法做展示。
- summary/points 只写来源支持的事实；建议用“复刻时可……”表达。
- 只有真实读取的媒体才可用于画面判断。
- logged-out SSR 不能通用证明完整 Conversation；capture 由程序生成，不强行标“完整”。

## validate 与 finalize

```text
validate <tweet-id>
# 阅读 preview.md，复核原文顺序、Prompt、翻译、事实与建议。
finalize <tweet-id>
```

- 新案例 finalize 后进入标题目录。
- repair finalize 会再次核对旧正式 source/Markdown 哈希，再受控替换并验证正式渲染。
- 只有 `note_ready` 才报告完成。
- repair 完成后应核对正式项目笔记与 Obsidian Junction 指向同一更新内容；没有实际检查就不要声称 UI 已刷新。
- 按作者分类只在用户明确要求时执行。

## 安全边界

单案例默认 Guest-only；不保存普通用户评论；只保留 root author 内容与媒体。不得自动重试、提交、push、删除任务目录、获取 Cookie、写入 auth_token/ct0，或自动启用账号 Session。单案例账号 Session 只有用户明确授权且 Guest-only 已证明不足时才考虑，并遵守项目规定的最多 2 次真实尝试。Batch 模式更严格：永久 Guest-only，账号 Session 尝试额度固定 0 / 0，任何账号 Cookie/Session 环境都不得被 Batch 使用。

安装、宿主发现与多 Agent 说明以 `docs/LOCAL-AGENT-INSTALL.md` 为准。
