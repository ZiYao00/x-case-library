# X 案例库 · XActions + Obsidian

## Agent 一条链接入口

本项目现提供 `x-learning-automation` Skill。Codex 用户级目录通过 Junction 指向 `skill/x-learning-automation`，无需复制项目或维护 Skill 副本；ChatGPT 网页版使用同一真源打包的安装 ZIP，并通过已授权的本地工作区连接器执行项目。安装、网页端适配与验收见 [Agent 安装说明](docs/LOCAL-AGENT-INSTALL.md)。

新会话发送一条 X/Twitter 帖子链接即可请求自动生成案例笔记；也可说“整理这个 X 帖子：链接”。用户明确要求批量转换多条显式 X status URL 时，Skill 使用有界串行 Batch V1；批量规则见 [Batch Operations](docs/BATCH-OPERATIONS.md)。明确讨论或不保存的指令优先。Agent 统一执行环境检查、查重、Guest-only 采集、analysis 写作、校验与 finalize。只读环境检查：

```powershell
node scripts/run-x-case.mjs onboarding
```

重复案例默认返回已有笔记，未完成材料可续写；只有用户明确要求更新/修复已有正式案例时才走 `repair`。Agent 不手改 source.json，repair 仅通过重新采集、身份/非降级比较、validate 与旧文件哈希门禁受控替换，并保留旧快照。SSR 无法证明完整线程时 capture 为“待确认”，媒体或回复缺失则为“部分”。只有 `note_ready` 才表示完成。Skill 可读、本机环境 ready、真实 X 网络采集、新会话自动触发及 Obsidian UI 均是独立验收项。

### Batch V1 · 显式多链接转换

Batch 只接受用户明确提供的 X/Twitter status URL，并逐条复用现有单案例流程，不扫描主页/搜索/书签，也不并发。初始化会先在本地去重和查重；GitHub/非 status URL 直接 ignore。首轮 Pilot 最多 3 条，后续 wave 最多 5 条，并发固定 1，单案例完成后至少 30 秒才允许启动下一条。

Batch 的账号边界比单案例更严格：**永久 Guest-only，账号尝试固定 0 / 0**。Batch 不读取 `cookies.json`、`auth_token`、`ct0`，不调用账号 Session；如果环境误设 `XACTIONS_ALLOW_ACCOUNT_SESSION=1`，会在任何 Batch 网络请求前直接停止。429、平台 401/403、Guest Token/网络异常会触发 circuit breaker，绝不自动重试、轮换 token/proxy/IP/账号或自动 resume。完整规则见 `docs/BATCH-OPERATIONS.md`。

## 项目目标

使用固定版本 XActions 4.0.1 作为 X 数据采集层，最终形成与 B 站视频转笔记相似的入口：

```text
用户只发送一个 X 帖子链接
→ LLM / Agent 调用本地采集入口
→ 只保留原作者内容
→ source.json + media 进入临时 Tweet-ID staging
→ 按 docs/NOTE-SPEC.md 生成 V4.2 Markdown
→ finalize 将阅读层发布为 `notes/x/00-待整理/<笔记标题>.md`，并将事实/媒体层发布到 `notes/x/_case-data/<tweet-id>/`
→ 通过 Junction 在 Obsidian 查看；`_case-data` 默认隐藏
→ 用户需要时只移动 Markdown 到 `notes/x/作者/<username>/`
```

## 当前主路线：HTTP Guest-only

经过三条真实案例验证，正式路线不再依赖 XActions 4.0.1 已失效的 `TweetDetail`，而采用：

- `GuestTokenManager`
- `createHttpScraper`
- `TweetResultByRestId`
- logged-out X 页面 SSR
- `downloadMedia`
- 本地 `ssr-author-replies.mjs`
- 本地 `x-link-preservation.mjs`
- FxTwitter（仅 X Article 无登录补充读取）

流程：

```text
X URL
↓
TweetResultByRestId
→ 主帖 / NoteTweet / 主帖媒体
↓
匿名请求根帖 X 页面 HTML
↓
SSR 仅筛 actual author == root author 的 conversation Tweet ID
↓
TweetResultByRestId 精确读取候选，并校验 author.id / username / direct inReplyTo
↓
对已确认作者回复继续读取它自己的 logged-out SSR 页面
↓
广度优先走完整个当前公开作者自回复链（最多 40 页 / 40 条作者回复）
↓
保留 Tweet URL / @mention 元数据；若存在 X Article，则额外用 FxTwitter 无登录补正文、富文本链接和封面
↓
下载作者主帖、作者回复与已支持 Article 媒体
```

原因：

1. 不需要 Puppeteer / Playwright。
2. 不需要登录 X 账号。
3. 不读取 `auth_token` / `ct0`。
4. 不逐条读取普通用户评论。
5. 作者回复只有在 SSR 中先通过作者身份筛选后，才做精确 Tweet 读取。
6. NoteTweet 长文本优先读取 `note_tweet.note_tweet_results.result.text`，避免 XActions 4.0.1 截断长 Prompt。
7. 图片与视频通过 XActions `downloadMedia` 本地化；`pbs.twimg.com/media/` 图片自动请求 `name=orig`，避免保存 X 的缩放版本。
8. 普通 prose / Article 原文先中和 Markdown、WikiLink、原始 HTML，只把 source 明确提供的 URL / @mention 恢复为 Markdown 链接；有精确 span 时按 span 渲染，Prompt 内链接不改写。
9. FxTwitter 只在检测到 X Article 时调用一次，不登录、不重试；Article 媒体只允许 HTTPS `pbs.twimg.com` / `video.twimg.com`，其它媒体不下载并把 Article 标记为部分，不触发账号 Session。
10. 正式重复案例只有在恰好存在一个可读 Markdown 时才返回 `existing_case_found`；损坏或歧义状态直接 `action_required`，不联网重采。
11. repair finalize 若中途失败，会恢复旧 source/Markdown/被覆盖媒体并删除本轮新建媒体。

Agent 正式入口是 `scripts/run-x-case.mjs`。以下保留为底层单次采集入口，只产生原始数据与媒体；已有输出目录拒绝覆盖，Agent 不应使用它绕过查重和环境门禁：

```powershell
powershell -ExecutionPolicy Bypass -File config\run-author-case.ps1 -Url "<X URL>"
```

## 当前安全策略

当前只有一个 X 账号，因此单案例默认按最低风险、最低请求量执行；Batch V1 完全不使用该账号，永久 Guest-only，账号尝试 0 / 0。

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
12. 不翻页抓取完整普通 Conversation；只沿已验证的原作者自回复链逐层读取 logged-out SSR，SSR 未暴露的内容仍标记为“无法证明不存在”。
13. 不搜索、不扫 Bookmarks、不抓普通用户评论、不做点赞/关注/回复/发帖/DM。
14. 账号 Session 路线保留为后备，但被 `XACTIONS_ALLOW_ACCOUNT_SESSION=1` 显式门禁锁住。
15. 若未来确实需要账号 Session，最多允许 2 次真实尝试；两次失败立即停止。
16. Cookie、auth_token、ct0 不得进入项目、日志、Markdown、ChatGPT 或 Git。

## 目录

- `notes/x/00-待整理/<tweet-id>/`：**临时采集 staging**；只在 finalize 前存在
- `notes/x/00-待整理/<笔记标题>.md`：正式待整理阅读层
- `notes/x/作者/<author.username>/<笔记标题>.md`：按作者整理后的阅读层；整理只移动 Markdown
- `notes/x/_case-data/<tweet-id>/`：正式隐藏数据层；包含 `source.json` 与 `media/`，以 Tweet ID 作为稳定 Case Identity
- `tests/cases/`：历史真实测试输出，仅用于回归与证据保留
- `tests/TEST_SUMMARY_2026-10-05.md`：三条真实测试总报告
- `config/`：采集入口、本机配置与 Obsidian 样式依赖
- `docs/NOTE-SPEC.md`：**唯一权威笔记转化规范**
- `docs/BATCH-OPERATIONS.md`：显式多链接 Batch V1 的唯一批量操作规范
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
- `source.json` 与 `media/` 保留在 `_case-data/<tweet-id>/`；`_case-data` 在 Obsidian File Explorer 中默认隐藏
- 长 Prompt 默认限高 320px，内部滚动，完整内容仍可一键复制
- 正式 Markdown 文件名使用笔记 `title`；Tweet ID 只作为隐藏数据包身份，不作为可见笔记目录层
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
- 多跳测试：Gemini Tweet `2106993039894044912` 从根帖逐层遍历 11 条作者回复、12 个 SSR 页面均 200；账号未使用。
- repair 真实验收：同一 Gemini 正式案例通过显式 repair 从旧 1 条作者回复更新为 11 条，旧 source/Markdown 保留在 `.runtime/.../before`；正式项目文件与 Obsidian Junction SHA-256 一致。
- 链接 / Article 真实验收：Tweet `2106598997259591922` 通过 FxTwitter 无登录补充读取 102 个 Article blocks、62 个作者 mention；hardening v2 再次真实采集后 62 / 62 个 Article 链接都保存精确 span，封面仍从 `pbs.twimg.com` 本地化，账号未使用。
- link preservation 离线回归：7 / 7 通过（Markdown/HTML 中和、精确 occurrence、handle 边界、Article 媒体白名单等）。
- workflow 离线回归：24 / 24 通过（含派生文本安全渲染、来源核对一句话、损坏/歧义正式案例门禁、legacy span enrichment、repair 失败媒体回滚）。
- Batch V1 离线回归：9 / 9 通过（输入过滤/去重、本地 preflight、账号 Session 硬拒绝、网络前环境门禁、单并发、cooldown、wave、circuit breaker、断点状态）。
- Batch V1 真实 Pilot：整批 preflight 得到 26 pending + 2 existing + 2 GitHub ignored；前三个 pending 串行完成 3 / 3 `note_ready`，三条 source 均 `authenticatedAccountUsed=false`，第三条后自动停在 `wave_limit`，第 4 条未启动。
- 当前用户账号 Session 使用次数：0；单案例后备尝试额度仍为 0 / 2；Batch 尝试额度固定为 0 / 0。
- 基础真实测试总报告：`tests/TEST_SUMMARY_2026-10-05.md`；多跳、repair、链接 / Article、Batch 与 Storage Layout V2 验收分别见 `tests/THREAD_WALK_ACCEPTANCE_2026-10-05.md`、`tests/REPAIR_ACCEPTANCE_2026-10-05.md`、`tests/LINK_PRESERVATION_ACCEPTANCE_2026-10-06.md`、`tests/BATCH_ACCEPTANCE_2026-10-06.md`、`tests/LAYOUT_V2_ACCEPTANCE_2026-10-06.md`。

## 4.0.1 发布包核验结论

### HTTP `TweetDetail / scrapeThread`

XActions 4.0.1 的固定 `TweetDetail` queryId 当前返回 404；其 `doctor --refresh-ids` 也仍按旧版 `responsive-web/main.*.js` 前端结构发现 queryId，而当前 X 已切换到新的 `x-web/x-web/entry-client-logged-out-*.js` 架构。

因此当前正式路线**不调用 `scrapeThread`**。

作者回复改为：

```text
root logged-out page SSR
→ 发现同作者候选 Tweet ID
→ TweetResultByRestId 精确读取
→ 校验 author.id / username / direct inReplyTo
→ 对已确认回复继续读取自己的 logged-out SSR
→ 直到当前公开作者自回复链 exhausted 或达到安全上限
```

真实 Elsa 样本证明单层 self-reply、Gemini 样本证明多跳 self-reply；两者都能排除普通用户回复。

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
3. 从根帖 logged-out SSR 开始，只发现 root author 候选。
4. 候选通过 `TweetResultByRestId` 精确读取，并校验数字 author ID、username 与 direct `inReplyTo`。
5. 对已确认作者回复继续读取它自己的 logged-out SSR，直到队列 exhausted 或安全上限；普通用户回复不进入队列。
6. 对主帖与作者回复中的媒体各下载一次，不重试。
7. 保存 source package，并检查正文/NoteTweet、作者回复链、普通用户过滤与媒体本地化。
8. LLM / Agent 只编辑 runtime analysis，validate 后检查 preview，再 finalize。
9. 若用户明确要求修复已有正式案例，则改走 repair staging、非降级比较与旧文件哈希门禁；普通重复链接不刷新。
10. 若 SSR 未发现更多作者回复，只能记录“匿名页面未暴露”，不能凭 SSR 单独证明完整 Conversation。
11. 若失败或疑似缺失，不自动切账号模式；需要账号时遵守最多 2 次尝试规则。

## 账号 Session 后备

`config/connect-xactions.ps1` 和 `config/start-xactions-readonly.ps1` 仅作为未来后备。

默认运行会被拒绝。只有在 Guest 路线已经被证明确实无法读取所需公开内容、用户再次明确授权后，才允许设置：

```powershell
$env:XACTIONS_ALLOW_ACCOUNT_SESSION = "1"
```

默认不使用。只有 Guest-only 已明确无法覆盖所需内容时才允许启用，并严格限制为最多 2 次真实账号尝试；两次失败后立即停止。

## 暂不做

- 不做无边界、并发或自动发现目标的批量抓取；仅允许 `docs/BATCH-OPERATIONS.md` 定义的显式 URL、有界、串行 Batch V1。
- 不抓普通用户评论。
- 不抓取/分页遍历完整普通 Conversation；只遍历经作者身份与 direct inReplyTo 验证的作者自回复页面。
- 不扫描 Bookmarks。
- 不搜索 X。
- 不做账号自动化。
- 不安装浏览器自动化依赖。
- 新采集逻辑先在隔离测试目录验收，再接正式 Obsidian；正常 Skill 输出到项目 notes/x。
- 不 fork / 修改 XActions 上游源码。
