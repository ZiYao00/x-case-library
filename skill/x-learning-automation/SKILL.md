---
name: x-learning-automation
description: Turn one X/Twitter post link into a local Obsidian case through x-case-library, or explicitly refresh/repair an existing finalized case when the user asks to update, repair, re-collect, fix missing replies, or refresh it. Use for a bare valid x.com/twitter.com status link, X案例/推文收集, installing/checking this workflow, and explicit existing-case repair. Discussion, link analysis, or no-save intent takes precedence. Requires authorized access to the user's local x-case-library workspace.
---

# X 案例转笔记

## 先判断意图

- 单个有效帖子链接、或“整理/保存/收集这个 X 帖子” → 新案例流程。
- 明确说“更新/修复/重新采集/刷新已有案例/补齐缺失回复” → repair 流程。
- 讨论、解释、分析链接、不要保存 → 不采集。
- 多条不同帖子、主页、搜索页、短链 → 不猜测、不批量执行。
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

- `existing_case_found`：直接返回已有案例；除非用户明确要求更新，否则不联网、不覆盖。
- `materials_ready`：读取 handoff、source.json、analysis.json；只编辑 runtime analysis.json。
- `failed/action_required`：读取故障/actions 后停止；不自动重试，不切账号，不调用底层 collector 绕过保护。

## repair 已有案例

只在用户明确要求更新时执行：

```text
repair "<包含已有 X 帖子链接的原始消息>"
```

- `repair_materials_ready`：读取 repair handoff、staged source、analysis.json、comparison。
- 正式 source/Markdown 在 repair prepare 和 validate 阶段必须保持不变。
- repair 必须保持现有标题；不要借 repair 改目录名或笔记名。
- 程序会验证同 Tweet ID、同数字 author ID，并阻止丢失旧作者 Tweet、链接实体、已可用 X Article 或减少已下载媒体的降级采集。
- 旧正式 source/Markdown 会保留在 repair `before/` 作为回滚证据。
- `repair_failed/repair_blocked/action_required` 时停止；不得删除旧案例或任务目录后重试。

## 写 analysis

按 `docs/NOTE-SPEC.md` 生成标题、一句话看懂、3–6 条复刻要点和 tags。

- `analysis.posts` 按原帖顺序覆盖 root + 全部已采集作者回复。
- 每篇拆为 `prose` / `prompt` segments；所有 `segment.text` 拼接必须逐字符等于 source text，包括空白。
- 普通非中文正文提供中文 translation。
- Prompt 不翻译、不改写；明确多套 Prompt 分开，边界不确定时保留整块原文。Prompt 内 URL / @handle 也保持原样。
- Tweet / X Article 的可点击链接由 source 元数据和 renderer 自动生成；Agent 不手工补 Markdown 链接，不根据名称猜 URL。
- 若 source 中存在 `tweet.article`，阅读 Article 原文后可把其内容用于 summary/points，但不要把 Article 富文本复制进 analysis.posts 或重新改写链接。
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

默认 Guest-only；不保存普通用户评论；只保留 root author 内容与媒体。不得自动重试、提交、push、删除任务目录、获取 Cookie、写入 auth_token/ct0，或自动启用账号 Session。账号 Session 只有用户明确授权且 Guest-only 已证明不足时才考虑，并遵守项目规定的最多 2 次真实尝试。

安装、宿主发现与多 Agent 说明以 `docs/LOCAL-AGENT-INSTALL.md` 为准。
