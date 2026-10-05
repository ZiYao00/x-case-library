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

新增正式 Agent 入口：`skill/x-learning-automation/SKILL.md`，安装与使用见 `docs/LOCAL-AGENT-INSTALL.md`。统一命令为 `node scripts/run-x-case.mjs onboarding|prepare|validate|finalize`；prepare 接收一条含链接的完整消息，validate/finalize 接收 Tweet ID。Agent 只编辑返回的 analysis.json，程序生成笔记，不能用底层入口绕过查重和环境门禁。首次真实链接与新会话发现验收需分别执行，不以离线测试替代。

采集：

```powershell
npm run collect -- "https://x.com/.../status/..."
```

完成 Markdown 后，将临时 Tweet-ID 目录改为标题目录：

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
- 不因翻译、排版、总结、命名或分类而修改。

Markdown：

- 阅读层。
- 可加入中文翻译。
- 可加入一句话看懂、复刻要点。

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
- 原作者 self-reply
- 图片原图本地化
- MP4 本地化
- Media Viewer 图片/视频弹窗
- Prompt 一键复制
- 长 Prompt 内滚动
- 英文普通正文中文翻译
- 标题目录 finalize
- Gallery 在目录改名后仍可唯一解析

## 11. 未来方向

已经确定但不自动执行：

- 按作者 username 分类；
- 数字 author.id 用于处理作者改名；
- 未来可增加 Bilibili-style 总结/标签/导航层。

不要在案例数量不足时过早增加复杂 taxonomy。
