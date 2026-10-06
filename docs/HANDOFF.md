# Project Handoff

更新日期：2026-10-05

本文件供后续 ChatGPT / Codex / Claude / WorkBuddy / 其它 Agent 接手本项目时快速阅读。

## 1. 项目是什么

`x-case-library` 是本地 X/Twitter AI 案例采集与 Obsidian 知识库项目。

主流程：

```text
X URL
→ Guest-only 采集
→ 原作者主帖 + 原作者回复
→ source.json + 本地媒体
→ V4.2 Markdown
→ 标题目录
→ Obsidian
→ 用户需要时按作者整理
```

## 2. 接手必须先读

按顺序：

1. `AGENTS.md`
2. `docs/NOTE-SPEC.md` — 唯一权威笔记规范
3. `docs/ARCHITECTURE.md`
4. `docs/OBSIDIAN.md`
5. `README.md`

如果历史迁移脚本或旧测试说明与 `docs/NOTE-SPEC.md` 冲突，以 NOTE-SPEC 为准。

## 3. 路径

项目：当前仓库根目录 `x-case-library`。

Obsidian Junction：

```text
G:\ZiYao\Note\X案例库
→ <repo>\notes\x
```

共享 CSS 真源：相邻仓库 `..\obsidian-learning-snippets`。

不要在 x-case-library 内复制 CSS。

## 4. 当前安全边界

- 默认 Guest-only。
- 不自动使用用户 X Session。
- 普通用户评论不保存。
- 只保留 root author 内容。
- 不做点赞、关注、回复、发帖、DM。
- `auth_token` / `ct0` / cookies 不进 Git。
- Account Session 只有用户明确授权时才能启用，最多 2 次真实尝试。

## 5. 常用命令

新增正式 Agent 入口：`skill/x-learning-automation/SKILL.md`，安装与使用见 `docs/LOCAL-AGENT-INSTALL.md`。统一命令为 `node scripts/run-x-case.mjs onboarding|prepare|repair|validate|finalize`；prepare/repair 接收一条含链接的完整消息，validate/finalize 接收 Tweet ID。普通重复链接仍只返回已有案例；只有用户明确要求更新已有案例时才能走 repair。Agent 只编辑返回的 runtime analysis.json，程序生成/替换笔记，不能用底层入口绕过查重、repair 门禁和环境门禁。首次真实链接与新会话发现验收需分别执行，不以离线测试替代。

新案例底层采集（Agent 日常应走 prepare）：

```powershell
npm run collect -- "https://x.com/.../status/..."
```

显式修复已有正式案例：

```powershell
npm run repair -- "https://x.com/.../status/..."
node scripts/run-x-case.mjs validate <tweet-id>
node scripts/run-x-case.mjs finalize <tweet-id>
```

repair 会先写 `.runtime` staging；prepare/validate 阶段不碰正式 Obsidian 案例。只有通过身份、非降级与旧文件哈希检查后，finalize 才受控替换，并把旧 source/Markdown 备份到 repair `before/`。

完成新案例 Markdown 后，将临时 Tweet-ID 目录改为标题目录：

```powershell
npm run finalize -- <tweet-id>
```

按作者整理单个案例：

```powershell
npm run organize:author -- "<笔记标题>"
```

按作者整理全部前先预览：

```powershell
npm run organize:author -- --all --dry-run
```

用户确认后才执行：

```powershell
npm run organize:author -- --all
```

真实 `--all` 不得自行执行，除非用户明确要求。

离线 SSR 回归：

```powershell
node tests/test-ssr-author-replies.mjs
```

## 6. 目录生命周期

采集 staging：

```text
notes/x/00-待整理/<tweet-id>/
```

正式待整理：

```text
notes/x/00-待整理/<笔记标题>/
```

整理后：

```text
notes/x/作者/<author.username>/<笔记标题>/
```

目录显示使用 username；稳定身份以 `source.json -> rootTweet.author.id` 为准。

## 7. 当前 Obsidian 依赖

CSS：

- `learning-lab.css`
- `x-case-note.css` v0.5

插件：

- Media Viewer 2.2.1

Media Viewer 已通过本地 MP4 弹窗实测。

`media/` 实体目录存在，但由 `x-case-note.css` 从 Obsidian File Explorer 隐藏。

## 8. 数据边界

`source.json`：

- 事实真源。
- Agent 不因翻译、排版、总结、命名或分类而修改。
- 唯一允许的替换是用户明确要求的 repair：重新采集、校验并保留旧快照后由程序写回。
- Tweet/Article 原文链接实体属于 source truth；Markdown 只负责把它们渲染为可点击链接。

Markdown：

- 阅读层。
- 可加入中文翻译。
- 可加入一句话看懂、复刻要点。
- 普通 prose / Article 原文先中和 Markdown、WikiLink、HTML 语义，再只恢复 source 提供的 @mention / URL；Prompt 不做链接化。
- source 有精确 link span 时按 span 渲染；旧 source 无 span 时只做一次边界安全 fallback，避免重复词或 handle 前缀误链接。
- X Article 正文作为主帖附加原文渲染，链接同样来自 source，不由 Agent 猜测；Article 媒体仅接受可信 X CDN HTTPS。
- 作者明确数量与 source 可直接计数结果明显不一致时，可显示一行 `来源核对｜...`；不新增章节、不改变 capture。

Prompt：

- 原文资产。
- 不翻译。
- 不改写。
- 使用 fenced `prompt` block。
- 高度 320px，内部滚动，完整复制。

## 9. 当前 Git

`x-case-library` 已建立本地 Git 仓库。

真实案例目录 `notes/x/**` 保持 Git ignored，仅提交空目录骨架。

共享 CSS 位于独立 Git 仓库 `obsidian-learning-snippets`。

不要 push / release，除非用户明确要求。

## 10. 当前已验证

- Guest-only root Tweet
- NoteTweet 长文本
- 原作者单层 self-reply
- 原作者多跳 self-reply SSR walker
- 多跳过程中单页失败 / 达到遍历上限时保留已验证回复并标记部分采集
- 作者回复必须通过稳定 author.id、username 与 direct inReplyTo 校验
- 显式 repair 已有正式案例：staging、同 Tweet/author 校验、非降级比较、标题锁定、validate、旧文件哈希门禁、before 回滚证据；失败回滚会清理本轮新建媒体
- Gemini 真实案例已通过 repair 从 1 条作者回复更新到 11 条；项目正式文件与 Obsidian Junction SHA-256 一致
- 普通 Tweet 的 t.co / @mention 可按 source 元数据渲染为 Markdown 链接，Prompt 保持原样；精确 span 与 handle 边界已离线验证
- 普通 prose / Article 中的 Markdown、WikiLink、原始 HTML 会被中和，只有 source 链接重新开放
- X Article 通过 FxTwitter 无登录补充读取；真实 0xarthurzs hardening v2 样本仍为 102 个正文 block、62 个 mention link，62/62 都保存精确 span
- Article 媒体仅允许 HTTPS `pbs.twimg.com` / `video.twimg.com`；真实封面继续正常本地化，Article 补充失败或不完整会降级 capture 为 `部分`
- 正式重复案例缺失/多出 Markdown 时返回 `action_required`，不会联网重采
- 可选 `sourceCheck` 已验证为仅一行来源数量核对，不改变 capture
- 图片原图本地化
- MP4 本地化
- Media Viewer 图片/视频弹窗
- Prompt 一键复制
- 长 Prompt 内滚动
- 英文普通正文中文翻译
- 标题目录 finalize
- Gallery 在目录改名后仍可唯一解析

真实验收记录见 `tests/THREAD_WALK_ACCEPTANCE_2026-10-05.md`、`tests/REPAIR_ACCEPTANCE_2026-10-05.md`、`tests/LINK_PRESERVATION_ACCEPTANCE_2026-10-06.md`。logged-out SSR 即使遍历正常结束也不能证明完整 Conversation；Guest `UserTweetsAndReplies` 当前需要登录 Session，因此未作为自动后备。

## 11. 未来方向

已经确定但不自动执行：

- 按作者 username 分类；
- 数字 author.id 用于处理作者改名；
- 未来可增加 Bilibili-style 总结/标签/导航层。

不要在案例数量不足时过早增加复杂 taxonomy。
