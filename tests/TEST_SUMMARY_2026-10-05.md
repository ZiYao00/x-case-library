# X 案例采集 · 三条真实测试总结

日期：2026-10-05  
候选底座：XActions 4.0.1  
当前正式路线：Guest-only + TweetResultByRestId + logged-out SSR author-reply discovery + downloadMedia

## 总结论

当前方案已通过三条真实 X 案例测试，可以稳定完成：

```text
X URL
→ 获取主帖
→ 展开 NoteTweet 长文
→ 匿名 SSR 发现原作者自回复
→ 只精确读取原作者回复
→ 排除普通用户
→ 下载作者图片 / 视频
→ 生成 source.json
→ 生成 case.md
```

用户 X 账号 Session 使用次数：**0**。  
账号尝试额度：**已使用 0 / 2**。

## 测试 1 · Noor

URL：

`https://x.com/Noor_ul_ain43/status/2106679751566094429`

覆盖能力：

- 主帖；
- NoteTweet 长 Prompt；
- 主帖视频；
- 视频本地化。

关键发现：

XActions 4.0.1 默认 `parseTweetData()` 只使用 `legacy.full_text`，会截断 NoteTweet。

修复：

优先使用：

`note_tweet.note_tweet_results.result.text`

结果：

**PASS**

## 测试 2 · Elsa 视频 + 作者自回复 Prompt

URL：

`https://x.com/ElsaSofia__AI/status/2106928507809100018`

覆盖能力：

- 主帖；
- 主帖 1280×720 视频；
- 原作者自回复；
- 作者回复 NoteTweet 长 Prompt；
- 作者回复图片；
- 普通用户过滤。

作者自回复：

`2106928513710518539`

关键发现：

XActions 4.0.1 的 `TweetDetail` queryId 已过期，`scrapeThread` 当前不可作为可靠路线。

替代路线：

```text
logged-out X SSR
→ 找 conversation Tweet ID
→ actual author == root author
→ TweetResultByRestId 精确读取
→ 再次校验 author
```

结果：

**PASS**

## 测试 3 · Elsa 双图 + 双 Prompt

URL：

`https://x.com/ElsaSofia__AI/status/2106204165525610601`

覆盖能力：

- 主帖；
- 主帖两张图片；
- 原作者自回复；
- 作者回复超长文本；
- 同一条回复包含 Image 1 / Image 2 两套 Prompt；
- 原图本地化；
- 全自动一次完成。

作者自回复：

`2106204171380912558`

API：

- 主帖：HTTP 200
- 作者回复：HTTP 200
- 自动重试：0

结果：

**PASS**

## 当前正式采集架构

```text
用户发送 X URL
↓
Agent / LLM
↓
TweetResultByRestId
├─ 主帖文字
├─ NoteTweet
└─ 主帖媒体
↓
匿名读取目标 X 页面 HTML
↓
SSR conversation entries
↓
仅筛 actual author == root author
↓
TweetResultByRestId 精确读取候选作者回复
↓
再次校验 reply.author
↓
只保留：
├─ 作者文字
├─ 作者回复
├─ 作者图片
└─ 作者视频
↓
下载媒体
↓
source.json
↓
case.md
↓
未来 Obsidian
```

## 已解决问题

### NoteTweet 截断

已解决。

### 普通用户评论混入

已解决。

普通用户可能存在于 SSR HTML 中，但：

- 不写入 source.json；
- 不逐条精确读取；
- 不进入 case.md。

### 作者回复里的 Prompt

已解决，并经过两条 Elsa 案例验证。

### X 图片缩放

已解决。

对 `pbs.twimg.com/media/` 自动使用 `name=orig`。

### 视频

已验证 MP4 本地化。

## 当前安全状态

- 用户账号登录：0 次
- auth_token：未使用
- ct0：未使用
- Puppeteer：未安装
- Playwright：未安装
- 搜索：未执行
- Bookmarks：未扫描
- 点赞：未执行
- 回复：未执行
- 关注：未执行
- DM：未执行
- 批量采集：未启用
- 自动重试：关闭

账号 Session 只作为后备。

若未来 Guest-only 明确无法取得人工可见的必要作者内容：

- 最多允许 2 次账号尝试；
- 两次失败立即停止；
- 不自动重试。

## 当前边界

### 1. SSR 可见范围不是完整 Conversation 的证明

如果抓到作者回复，可以确认存在。

如果没抓到，只能说明：

> 当前 logged-out SSR 没有暴露。

不能直接推断：

> 作者一定没有回复。

### 2. X 前端结构会变化

当前作者回复发现依赖新的 logged-out SSR 序列化结构。

因此需要保留两个真实 HTML 样本做回归测试：

- Noor → 应返回 0 条作者回复；
- Elsa → 应返回指定作者回复 ID。

### 3. XActions 4.0.1 的 TweetDetail 当前失效

本项目当前不依赖该能力。

## 当前成熟度判断

### 数据采集层

**READY**

核心目标已经实测通过：

- 作者主帖；
- 作者长文本；
- 作者自回复；
- 图片；
- 视频；
- 普通用户过滤。

### Obsidian 发布层

**尚未正式接入**

下一阶段只剩：

1. 确定正式案例目录；
2. 将 `case.md + media/` 复制/链接到 Obsidian；
3. 让 LLM 在收到 X URL 后自动调用本地入口；
4. 做 2–3 条端到端“只发 URL → Obsidian 看结果”的验收。

## 推荐下一阶段

不再继续测试 XActions 基础抓取能力。

下一步进入：

**URL → LLM → XActions Guest-only → case.md → Obsidian**

也就是把现在已经跑通的采集层接成你真正想要的最终入口。
