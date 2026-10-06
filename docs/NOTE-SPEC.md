# X 案例笔记转化规范 V4.2

更新日期：2026-10-06

本文件是 `x-case-library` 的**唯一权威笔记转化规范**。任何 Agent、脚本或人工整理在生成、修改、迁移 X 案例 Markdown 时，都必须以本文件为准。

如果 README、AGENTS、旧迁移脚本或历史测试文档与本文件冲突，以本文件为准。

---

## 1. 核心目标

把一个 X 帖子链接转换成适合 Obsidian 快速浏览、复制 Prompt、查看媒体和后续分类的本地案例。

固定原则：

1. 只保存原作者内容。
2. 不保存普通用户评论。
3. `source.json` 是事实真源：Agent 和展示层不得手改；只有显式 `repair` 可用一次新的、已验证采集快照受控替换。
4. Markdown 是阅读层和 AI 派生层。
5. 原作者 Prompt 必须保持原文，不翻译、不改写。
6. 媒体必须本地化。
7. Obsidian 阅读页优先简洁，不展示采集技术细节。

---

## 2. 数据生命周期

### 2.1 采集 staging

采集器仍然以 Tweet ID 作为临时目录：

```text
notes/x/00-待整理/<tweet-id>/
├─ source.json
├─ media/
└─ documents/   # 仅当 X Article 存在受支持的内嵌文档时创建
```

这是**临时采集目录**，不是正式笔记目录名。

### 2.2 完成 Markdown 后立即 finalize

Agent 生成正式 Markdown 后，必须运行：

```powershell
npm run finalize -- <tweet-id>
```

或：

```powershell
node scripts/finalize-case.mjs <tweet-id>
```

finalize 会把临时 staging：

```text
00-待整理/<tweet-id>/
├─ source.json
├─ media/
└─ documents/   # 可选
```

发布成分离的 Layout V2：

```text
notes/x/
├─ 00-待整理/<笔记标题>.md
└─ _case-data/<tweet-id>/
   ├─ source.json
   ├─ media/
   └─ documents/   # 可选
```

正式 Markdown 文件名来自 Frontmatter 的 `title`；Tweet ID 作为稳定 Case Identity，只用于隐藏数据包，不再增加可见笔记目录层。

### 2.3 标题命名规则

Markdown 文件名应尽量等于笔记标题。

只在 Windows 不允许时做最小清洗：

- 替换 `< > : " / \\ | ? *`
- 去掉结尾空格和句点
- 防止 Windows 保留名
- 最长 120 字符

中文全角标点（例如 `：`）应保留。

如果出现完全相同标题冲突，才追加：

```text
<标题> · <tweet-id>
```

不要默认把 Tweet ID 放进正式 Markdown 文件名；只有标题冲突时追加。

### 2.4 已有正式案例 repair

普通 `prepare` 遇到正式案例必须返回 `existing_case_found`，不得联网刷新或覆盖。

只有用户明确要求“更新 / 修复 / 重新采集已有案例”时，Agent 才能执行：

```powershell
node scripts/run-x-case.mjs repair "<已有 X 帖子链接>"
```

repair 的固定契约：

1. 新数据先写入 `.runtime/<tweet-id>/repairs/<timestamp>/case/`，正式案例在 prepare / validate 阶段保持不变。
2. 重新采集必须校验同一 Tweet ID 与同一数字 `rootTweet.author.id`。
3. 新采集不得丢失旧案例已保存的作者 Tweet、链接实体、已可用 X Article、已捕获 Article documents 或已下载媒体；检测到回归必须停止。
4. 正式案例标题在 repair 中锁定，不借 repair 顺带改名。
5. Agent 只编辑 runtime `analysis.json`，完成后运行 `validate <tweet-id>` 并检查 `preview.md`。
6. `finalize <tweet-id>` 写回前必须再次核对旧正式 `source.json` 与 Markdown 哈希；期间若用户改过文件则拒绝覆盖。
7. 被替换前的 `source.json`、Markdown，以及会被覆盖的 media/documents 备份保留在 repair 的 `before/`；若 finalize 中途失败，恢复旧文件并删除本轮 repair 新创建的正式 media/documents，确保案例目录回到替换前状态。
8. repair 失败或被阻止时不得自动重试，不得删除旧正式案例绕过门禁。

---

## 3. 未来作者分类

### 3.1 目录结构

待整理完成后，可按作者分类：

```text
notes/x/
├─ 00-待整理/
│  └─ <笔记标题>.md
├─ 作者/
│  └─ <author.username>/
│     └─ <笔记标题>.md
└─ _case-data/
   └─ <tweet-id>/
      ├─ source.json
      └─ media/
```

例如：

```text
作者/
└─ ElsaSofia__AI/
   ├─ 日本河岸秋千旧友重逢：30 秒青春电影短片.md
   ├─ 3×3 电影感角色参考板：双图双 Prompt.md
   └─ 望远镜与飞来炸鸡：17 秒荒诞电影感短片.md
```

### 3.2 “作者 ID”的定义

用户可见目录使用：

```text
rootTweet.author.username
```

例如：

```text
ElsaSofia__AI
```

稳定身份判断使用：

```text
rootTweet.author.id
```

例如：

```text
1938074208157773824
```

规则：

- username 用于目录，可读性优先。
- 数字 author.id 用于判断“是否仍是同一个作者”。
- 如果作者未来改 username，应以数字 author.id 识别同一作者，再决定是否重命名作者目录。

### 3.3 整理命令

单个案例：

```powershell
npm run organize:author -- "<笔记标题>"
```

全部待整理案例先预览：

```powershell
npm run organize:author -- --all --dry-run
```

用户确认后才实际整理：

```powershell
npm run organize:author -- --all
```

默认不要自动运行真实 `--all`。只有用户明确要求整理时才执行。

---

## 4. 每个案例的文件结构

正式案例采用阅读层 / 数据层分离：

```text
notes/x/
├─ 00-待整理/<笔记标题>.md           # 或 作者/<username>/<笔记标题>.md
└─ _case-data/<tweet-id>/
   ├─ source.json
   ├─ media/
   │  ├─ ...
   │  └─ ...
   └─ documents/                     # 仅存在受支持的内嵌文档时创建
      └─ <tweet-id>_<来源完整文件名>
```

Tweet ID 是稳定 Case Identity。程序必须通过 Case Resolver 校验 `_case-data/<tweet-id>`、`source.json` 中的 Tweet ID 与 Markdown Frontmatter `source:` URL 三者一致；runtime 中历史绝对路径不作为权威身份。

### source.json

- 原始事实层。
- 不因排版、翻译、总结、标题、分类而改写。
- 保存 Tweet、作者、作者回复、原始媒体、原文链接实体、X Article 富文本、内嵌文档的原始 source 数据与采集完整性证据。
- Agent 不得手工编辑；已有案例只有显式 repair 能用新的已验证采集快照替换，并必须保留旧快照证据。

### media/

- 保留实际图片、视频等文件。
- 不重命名为模糊名称。
- 当前媒体名包含 Tweet ID，确保 Gallery 的 basename 在 Vault 内尽量唯一。

### documents/

- 仅当 X Article 含受支持的内嵌文档时创建。
- 当前支持 FxTwitter Article 的 `MARKDOWN` atomic entity。
- `source.json` 保留 FxTwitter 返回的完整原始 `rawMarkdown`；物理 `.md` 文件只允许确定性去掉唯一的最外层 Markdown fenced code block（语言标记为 `markdown` 或 `md`），内部正文不得改写。
- 文件名优先使用来源正文中明确给出的 `.md` 文件名，格式为 `<tweet-id>_<来源文件名>`；来源没有明确文件名时回退为 `<tweet-id>_MARKDOWN.md`。
- 同一 Tweet 真正出现同名冲突时才追加来源 entity key 作为稳定冲突后缀；不得使用无来源意义的 `001/002` 序号。
- 主笔记不新增独立“附件文档”章节；在 Article 原始 atomic 位置渲染 Obsidian WikiLink，点击打开本地文档。
- 未支持的 atomic entity 不得静默丢弃，必须计入不完整状态并使 `capture` 降为 `部分`。

### Markdown

- 阅读层。
- 可包含翻译、总结、复刻要点。
- 不保存采集器实现细节。

---

## 5. Frontmatter

保持精简，只允许这些常规字段：

```yaml
---
title: "案例标题"
source: "https://x.com/..."
author: "作者显示名"
published: "2026-10-05"
model: "Seedance 2.5"   # 只有确定时才写
status: "未复刻"
capture: "完整"
cssclasses:
  - learning-page
  - x-case-note
tags:
  - X案例
  - AI视频
---
```

### capture

只使用：

- `完整`
- `待确认`
- `部分`

不要在正文重复 Guest-only、SSR、API、reply IDs、Tweet ID 等技术说明。

---

## 6. 正文固定顺序

正文只按以下顺序：

```text
# 标题

## 媒体

## 原文

## 一句话看懂

## 复刻要点
```

不要创建独立的：

- `## Prompt`
- `## 采集完整性`
- `## 原始数据`
- `## 视频属性`
- `## 作者内容`
- `## 可复制 Prompt`

---

## 7. 媒体规范

默认使用 Media Viewer Gallery。

插件：

- Media Viewer
- Plugin ID: `mediaviewer`
- 已验证版本：`2.2.1`

标准格式：

````markdown
## 媒体

```gallery
size: small
addButton: false

![[001_xxx_video_1.mp4]]
![[002_xxx_photo_1.jpg]]
```
````

规则：

1. 缩略图必须小，优先让首屏快速看到后续文字。
2. 图片和视频都通过 Media Viewer 点击弹窗。
3. 不显示媒体路径。
4. 不显示分辨率、文件大小、时长等属性。
5. 不添加“单独打开视频”按钮。
6. Gallery 链接优先使用唯一 basename。
7. 如果 basename 出现歧义，才回退到其它可解析方式。

---

## 8. Obsidian 中隐藏 media 目录

真实 `media/` 必须保留在文件系统中，但 Obsidian File Explorer 中默认隐藏。

该规则由：

```text
obsidian-learning-snippets/snippets/x-case-note.css
```

负责。

隐藏仅影响左侧文件树显示：

- 不删除目录。
- 不影响 Gallery。
- 不影响图片。
- 不影响视频弹窗。
- 不影响外部文件管理器。

如果需要调试媒体，可临时关闭 `x-case-note` CSS snippet。

---

## 9. 原文线程规范

主帖：

```markdown
> [!x-post] 主帖
>
> 作者原文
```

作者回复：

```markdown
> [!x-reply] 回复 1
>
> 作者回复
```

视觉由 `x-case-note.css` 提供：

- 主帖实心圆。
- 回复空心圆。
- 左侧轻量时间线。
- 不使用头像。
- 不做笨重卡片。

普通用户评论不得进入 Markdown。

### 9.1 原文超链接保留

原文阅读层允许把 X 已提供的真实链接实体转成标准 Markdown 超链接，但不得改写 source text 本身。

作者账号：

```markdown
推荐关注 [@karpathy](https://x.com/karpathy)
```

网站、工具、GitHub、文章等：

```markdown
推荐使用 [OpenRouter](https://openrouter.ai/)
```

规则：

1. 只使用 X / Article source 中真实存在的 URL 或 mention 元数据，不让 Agent 根据名字猜链接。
2. 普通 Tweet 的 `t.co` 应优先显示为 X 提供的 `displayUrl`，点击目标使用 `expandedUrl`。
3. `@username` 显示文字保持不变，目标统一为 `https://x.com/<username>`。
4. 只生成 `http://` / `https://` 链接；其它协议保持纯文本。
5. 只对普通 prose 做 Markdown 链接化；Prompt 内 URL / @handle 必须保持原始可复制文本，不添加 Markdown。
6. 链接化属于 Markdown 阅读层派生，不修改 `source.json` 中的原始正文。
7. Tweet 含 X Article 时，主采集仍使用 XActions Guest-only；Article 正文、富文本链接和受支持的内嵌文档允许用 FxTwitter 做无登录补充读取。
8. FxTwitter 不可用、Article 身份不一致、富文本不完整或存在未支持的 atomic entity 时，不让整篇采集失败；保留 Tweet，`capture` 降为 `部分`。
9. Article 封面图纳入现有媒体本地化；无法解析的 Article 正文媒体同样使 `capture` 为 `部分`。
10. Article 富文本当前按 source 原文直接渲染并保留超链接，不做逐 block 自动翻译，避免破坏富文本边界。
11. Article 的 `MARKDOWN` atomic entity 必须保留原始 `rawMarkdown`，并将确定性解包后的文件写入 `documents/<tweet-id>_<来源完整文件名>`；来源没有明确文件名时使用 `<tweet-id>_MARKDOWN.md`。
12. 受支持文档在 Article 原始 atomic 位置渲染为 Obsidian WikiLink；不新增独立“附件文档”章节，也不默认把完整文档展开进主笔记。
13. 未支持的 atomic entity 不得静默变成空白；必须保存类型证据并使 `capture` 为 `部分`。
14. 历史正式案例不会因 renderer 升级自动补出此前未采集的链接、Article 或文档元数据；需要更新时必须显式走 repair。
15. Tweet / Article 普通 prose 一律按不可信外部文本处理：先中和 Markdown、Obsidian WikiLink 与原始 HTML 语义，再只恢复 source 明确提供的安全链接。
16. source 能提供精确链接位置时保存并按该位置渲染；旧 source 没有位置元数据时，只允许一次边界安全的 fallback 匹配，避免重复词全部被误链接或 `@foo` 命中 `@foobar`。
17. FxTwitter 提供的 Article 媒体只允许 HTTPS 的 `pbs.twimg.com` / `video.twimg.com`；其它地址不下载并计为 unsupported media，使 capture 降为 `部分`。
18. 标题正文、中文翻译、一句话看懂、复刻要点和来源核对等非 Prompt 自由文本在 Markdown 正文中同样按纯文本安全渲染；Frontmatter 继续使用结构化转义值。

---

## 10. 非中文原文翻译

作者普通正文如果不是中文：

1. 保留原文。
2. 下方追加简洁中文翻译。
3. 翻译是阅读层派生内容。
4. 不写入 `source.json`。

格式：

```markdown
> [!x-post] 主帖
>
> This AI video is absolutely masterpiece 🔥
>
> > 这支 AI 视频简直是杰作 🔥
```

不要翻译：

- Prompt
- URL
- @handle
- 模型名
- 技术参数
- 需要原样复制的字符串

---

## 11. Prompt 规范

Prompt 必须直接挂在提供它的主帖或作者回复下面。

不要写：

- `## Prompt`
- `Prompt 1 · 回复 1`
- “下方代码块可复制”
- “来源：作者回复”

标准格式：

````markdown
> [!x-reply] 回复 1
>
> ````prompt
> Create ...
> ````
````

视觉规则：

- 顶部固定显示 `PROMPT`。
- 右上角使用 Obsidian 原生复制按钮。
- 最大可见高度 320px。
- 超长 Prompt 内部滚动。
- 顶栏和复制按钮不随正文滚动。
- 点击复制必须得到完整 Prompt。
- 不翻译 Prompt。
- 不修改 Prompt 原文。

同一回复包含多个 Prompt 时，保持多个独立 `prompt` block，不合并。

### 来源数量核对（可选）

只在作者明确声称有 N 个 / 位 / 条，且当前 source 能直接数出同类对象并明显不一致时，填写 `analysis.sourceCheck`；一致或无法直接计数时留空。

最终笔记只显示一句，不新增章节，也不改变 `capture`：

```markdown
> [!warning] 来源核对｜原文称“119 位”，实际正文包含 62 条账号记录，对应 36 个不同账号。
```

不要扩展成事实核查系统，不核验粉丝数、收入、职位等外部事实，也不要把作者自身数量错误默认归因于采集失败。

---

## 12. 一句话看懂

目的：5–30 秒内理解案例价值。

要求：

- 1 个短段落。
- 不复述完整 Prompt。
- 说明作品类型、核心创意、关键视觉或生成思路。
- 不写采集技术信息。

---

## 13. 复刻要点

默认 3–6 点。

重点提炼：

- 角色一致性
- 镜头/构图
- 光线/质感
- 动作链
- Prompt 结构
- 模型/工作流注意点

不要机械重复 Prompt。

---

## 14. Agent 完整执行流程

收到 X URL 后，新案例执行：

```text
1. prepare：Guest-only 采集
2. source.json + media + 可选 documents 写入 00-待整理/<tweet-id>
3. 读取 source.json / handoff / analysis.json
4. 只整理原作者主帖和原作者回复
5. 生成 V4.2 analysis
6. validate 并检查 preview.md
7. finalize：Markdown 发布为 `00-待整理/<标题>.md`，source/media/documents 数据包发布为 `_case-data/<tweet-id>/`
8. 回归检查
9. 等待用户决定是否按作者整理
```

用户明确要求更新已有正式案例时执行：

```text
1. repair "<已有 X URL>"
2. 比较旧、新 source；任何降级立即停止
3. 读取 repair handoff / staged source / analysis.json
4. 保持标题不变，重新整理完整作者线程
5. validate 并检查 preview.md
6. finalize：再次核对正式文件哈希后受控替换
7. 核对正式项目路径与 Obsidian Junction 内容一致
```

除非用户明确要求，不自动 repair、不自动执行作者分类。

---

## 15. 完成验收

每篇案例至少检查：

- [ ] 可见 Markdown 文件名 = 笔记 title（经过 Windows 最小合法化；仅标题冲突时追加 Tweet ID）
- [ ] 稳定数据包位于 `_case-data/<tweet-id>/`
- [ ] source.json 存在且未被人工/展示层改写；若本轮为 repair，旧快照已备份且新快照通过身份、非降级与哈希门禁
- [ ] media 文件全部存在
- [ ] Gallery 所有媒体 basename 在 Vault 中可唯一解析
- [ ] source 声明的 documents 文件全部存在；主笔记中的附件 WikiLink 指向正确的 `_case-data/<tweet-id>/documents/` 文件，文件名遵守 `<tweet-id>_<来源文件名>` 规则
- [ ] 正文顺序正确
- [ ] 没有独立 Prompt 标题
- [ ] Prompt 可复制
- [ ] 长 Prompt 有内部滚动
- [ ] 非中文普通原文有中文翻译
- [ ] Prompt 未翻译且 Prompt 内 URL / @handle 未被 Markdown 化
- [ ] 普通 prose / Article 文本中的原始 Markdown、WikiLink、HTML 不会被当成可执行/可解析标记；只有 source 明确提供的链接会恢复为可点击 Markdown
- [ ] source 提供的普通正文链接在 Markdown 中可点击，目标 URL 与 source 一致；有精确 span 时链接位置一致
- [ ] X Article 若存在，正文链接可点击；`MARKDOWN` atomic 能本地化为 documents 并在原位置提供可点击 WikiLink；未知 atomic、补充失败或媒体/文档不完整时 capture 为 `部分`
- [ ] 作者明确数量与当前 source 可直接计数结果明显不一致时，只显示一行“来源核对”；无差异时不显示
- [ ] 正式重复案例只有在恰好存在一个可读 Markdown 时才返回 `existing_case_found`
- [ ] repair finalize 失败时 source/Markdown/旧媒体/旧 documents 恢复，且本轮新增正式媒体/documents 被清理
- [ ] 普通用户评论未进入笔记
- [ ] Obsidian File Explorer 中 `_case-data` 数据层默认隐藏；隐藏不影响 Gallery 或 documents WikiLink 打开

---

## 16. 不得做的事情

- 不把普通评论区作为笔记内容。
- 不修改 `source.json` 来适配排版、翻译、总结或命名；已有案例更新只能走显式 repair 的受控重新采集与替换。
- 不把媒体或 documents 数据文件塞进 Git。
- 不复制共享 CSS 到本项目。
- 不把 Prompt 翻译后替换原文。
- 不用 Tweet ID 作为可见 Markdown 目录层；Tweet ID 只作为 `_case-data/<tweet-id>` 的稳定身份。
- 不在未确认的情况下自动把全部案例移出 `00-待整理`。
