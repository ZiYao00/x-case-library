# X 案例库 · XActions + Obsidian

## 目标

使用固定版本 XActions 4.0.1 作为 X 数据采集层，最终形成与 B 站视频转笔记相似的入口：

```text
用户只发送一个 X 帖子链接
→ LLM / Agent 调用本地采集入口
→ 只保留原作者内容
→ source.json + media 进入临时 Tweet-ID staging
→ 按 docs/NOTE-SPEC.md 生成 V4.2 Markdown
→ finalize 为 `notes/x/00-待整理/<笔记标题>`
→ 通过 Junction 在 Obsidian 查看
→ 用户需要时再按作者 username 整理
```

## 当前主路线：HTTP Guest-only

经过三条真实案例验证，正式路线不再依赖 XActions 4.0.1 已失效的 `TweetDetail`，而采用：

- `GuestTokenManager`
- `createHttpScraper`
- `TweetResultByRestId`
- logged-out X 页面 SSR
- `downloadMedia`
- 本地 `ssr-author-replies.mjs`

流程：

```text
X URL
↓
TweetResultByRestId
→ 主帖 / NoteTweet / 主帖媒体
↓
匿名请求该 X 页面 HTML
↓
SSR 仅筛 actual author == root author 的 conversation Tweet ID
↓
TweetResultByRestId 精确读取这些作者回复
↓
再次校验 reply.author
↓
下载作者主帖与作者回复自己的图片 / 视频
```

原因：

1. 不需要 Puppeteer / Playwright。
2. 不需要登录 X 账号。
3. 不读取 `auth_token` / `ct0`。
4. 不逐条读取普通用户评论。
5. 作者回复只有在 SSR 中先通过作者身份筛选后，才做精确 Tweet 读取。
6. NoteTweet 长文本优先读取 `note_tweet.note_tweet_results.result.text`，避免 XActions 4.0.1 截断长 Prompt。
7. 图片与视频通过 XActions `downloadMedia` 本地化；`pbs.twimg.com/media/` 图片自动请求 `name=orig`，避免保存 X 的缩放版本。

正式入口：

```powershell
powershell -ExecutionPolicy Bypass -File config\run-author-case.ps1 -Url "<X URL>"
```

## 当前安全策略

当前只有一个 X 账号，因此默认按最低风险、最低请求量执行。

1. 正式测试只使用 1 条真实 X 链接。
2. 同一链接不得自动重试；失败后先分析原因。
3. 默认 Guest-only，绝不自动回退到账号 Session。
4. HTTP Client：`maxRetries=0`。
5. Rate limit：遇到 429 立即失败，不等待后重试。
6. GraphQL Query ID 自动刷新关闭，避免失败后额外访问 X bundle。
7. Transaction ID 自动获取关闭，避免额外网页请求。
8. 不调用 `scrapeConversation`，不翻页抓完整普通评论区。
9. 只保存：
   - 原始主帖；
   - logged-out SSR 中实际作者等于 root author 的回复；
   - 上述作者 Tweet 自带的图片 / 视频 / GIF。
10. SSR 中出现的普通用户评论不写入 `source.json`，也不做逐条精确请求。
11. 媒体下载直接使用 XActions 官方 `downloadMedia` 访问媒体 CDN。
12. 不分页遍历完整 Conversation；SSR 没暴露的作者回复要标记为“无法证明不存在”。
13. 不搜索、不扫 Bookmarks、不抓普通用户评论、不做点赞/关注/回复/发帖/DM。
14. 账号 Session 路线保留为后备，但被 `XACTIONS_ALLOW_ACCOUNT_SESSION=1` 显式门禁锁住。
15. 若未来确实需要账号 Session，最多允许 2 次真实尝试；两次失败立即停止。
16. Cookie、auth_token、ct0 不得进入项目、日志、Markdown、ChatGPT 或 Git。

## 目录

- `notes/x/00-待整理/<tweet-id>/`：**临时采集 staging**；只在 finalize 前存在
- `notes/x/00-待整理/<笔记标题>/`：正式待整理案例；包含同名 Markdown、`source.json` 与 `media/`
- `notes/x/作者/<author.username>/<笔记标题>/`：未来按作者整理后的目录
- `tests/cases/`：历史真实测试输出，仅用于回归与证据保留
- `tests/TEST_SUMMARY_2026-10-05.md`：三条真实测试总报告
- `config/`：采集入口、本机配置与 Obsidian 样式依赖
- `docs/NOTE-SPEC.md`：**唯一权威笔记转化规范**
- `docs/HANDOFF.md`：其它 Agent 接手说明
- `docs/ARCHITECTURE.md`：数据与目录生命周期
- `docs/OBSIDIAN.md`：Obsidian 接入说明
- `AGENTS.md`：Agent 安全边界与必读入口

`raw/`、根级 `media/` 是早期试运行留下的空脚手架，不作为正式输出位置。

## Obsidian

当前本机采用与 `bili-learning-automation` 相同的 Junction 模式：

```text
G:\ZiYao\Note\X案例库
        ↓
<本项目>\notes\x
```

- Vault 根目录：见 `config/local.json`
- CSS 真源：`obsidian-learning-snippets`
- 当前使用 Core：`learning-lab.css` + Extension：`x-case-note.css`
- 正式笔记 Frontmatter 自动约定：`cssclasses: [learning-page, x-case-note]`
- V4.2 阅读顺序：媒体 → 原文线程（非中文正文附中文翻译，Prompt 直接挂消息）→ 一句话看懂 → 复刻要点
- Media Viewer 2.2.1 已通过本地 MP4 弹窗实测，作为 X 案例默认媒体 Gallery
- `media/` 实体目录保留，但在 Obsidian File Explorer 中默认隐藏
- 长 Prompt 默认限高 320px，内部滚动，完整内容仍可一键复制
- 正式案例目录与 Markdown 文件名使用笔记 `title`
- 不在本项目复制或维护共享 CSS

笔记内容规范以 `docs/NOTE-SPEC.md` 为唯一权威；Obsidian 环境详见 `docs/OBSIDIAN.md`。

## 已验证环境

- Node.js: v24.20.0
- PowerShell 入口会优先从 PATH 自动发现 `node`，找不到时才回退到标准 Windows 安装路径
- npm: 11.19.0
- XActions: 4.0.1
- 本地依赖仅安装 XActions core：`npm install --omit=optional --ignore-scripts`
- Puppeteer：未安装
- Playwright：未安装
- `collect-author-case.mjs --help`：通过
- 无效 URL 前置拒绝：通过
- 测试 1：Tweet `2106679751566094429`；通过 `TweetResultByRestId + NoteTweet + downloadMedia` 保存完整长 Prompt 与视频；账号未使用。
- 测试 2：Tweet `2106928507809100018`；通过 logged-out SSR 找到原作者自回复 `2106928513710518539`，精确读取完整 Prompt 与回复图片，并正确排除普通用户回复；账号未使用。
- 测试 3：Tweet `2106204165525610601`；一次自动流程获取主帖两张原图 + 原作者自回复 `2106204171380912558` 中的 Image 1 / Image 2 两套完整 Prompt；API 200 / 200，媒体 2 / 2 成功；账号未使用。
- 当前用户账号 Session 使用次数：0；账号尝试额度仍为 0 / 2。
- 三条真实测试总报告：`tests/TEST_SUMMARY_2026-10-05.md`。

## 4.0.1 发布包核验结论

### HTTP `TweetDetail / scrapeThread`

XActions 4.0.1 的固定 `TweetDetail` queryId 当前返回 404；其 `doctor --refresh-ids` 也仍按旧版 `responsive-web/main.*.js` 前端结构发现 queryId，而当前 X 已切换到新的 `x-web/x-web/entry-client-logged-out-*.js` 架构。

因此当前正式路线**不调用 `scrapeThread`**。

作者回复改为：

```text
logged-out page SSR
→ 发现 conversation Tweet ID
→ 按 actual author 过滤
→ TweetResultByRestId 精确读取作者回复
```

真实 Elsa 样本已证明这条路线能获得作者自回复中的 NoteTweet Prompt 与图片，并排除普通用户回复。

### Tweet media

`parseTweetData` 已包含：

- `media[].type`
- `media[].url`（图片）
- `media[].videoUrl`（视频 / GIF 最高质量 MP4）
- 尺寸信息

因此不需要为了获取媒体再扫描作者主页。

### 浏览器版 `x_get_replies`

禁用。4.0.1 当前实现会读取普通用户回复，且没有 author filter，不符合本项目要求。

### 浏览器版 MCP `x_get_thread`

保留为后备，不作为第一阶段主路线。它需要 Puppeteer，并会做多次页面滚动；Guest HTTP 路线更符合单账号安全约束。

## 单次正式验收

收到用户提供的 1 条真实案例链接后：

1. Guest-only 读取主帖 `TweetResultByRestId`。
2. 不登录账号，不读取账号 Cookie。
3. 匿名读取目标 X 页面 HTML，仅用于发现 SSR 中的 conversation Tweet ID。
4. 只对 actual author 与 root author 相同的候选 Tweet 做精确读取。
5. 再次校验返回 Tweet 的 author，普通用户回复立即丢弃。
6. 对主帖与作者回复中的媒体各下载一次，不重试。
7. 保存到 `tests/cases/<tweet-id>/source.json + media/`。
8. 检查：
   - 作者正文 / NoteTweet 是否完整；
   - 作者自回复是否被识别；
   - 普通用户是否被排除；
   - 图片 / 视频是否本地化。
9. LLM 根据 source package 生成短案例 Markdown。
10. 若 SSR 未发现作者回复，只能记录“匿名页面未暴露”，不能断言作者没有回复。
11. 若失败或疑似缺失，不自动切账号模式；需要账号时遵守最多 2 次尝试规则。

## 账号 Session 后备

`config/connect-xactions.ps1` 和 `config/start-xactions-readonly.ps1` 仅作为未来后备。

默认运行会被拒绝。只有在 Guest 路线已经被证明确实无法读取所需公开内容、用户再次明确授权后，才允许设置：

```powershell
$env:XACTIONS_ALLOW_ACCOUNT_SESSION = "1"
```

默认不使用。只有 Guest-only 已明确无法覆盖所需内容时才允许启用，并严格限制为最多 2 次真实账号尝试；两次失败后立即停止。

## 暂不做

- 不批量抓取。
- 不抓普通用户评论。
- 不分页遍历完整 Conversation。
- 不扫描 Bookmarks。
- 不搜索 X。
- 不做账号自动化。
- 不安装浏览器自动化依赖。
- 不接正式 Obsidian，先在 `tests/cases/` 验收。
- 不 fork / 修改 XActions 上游源码。
