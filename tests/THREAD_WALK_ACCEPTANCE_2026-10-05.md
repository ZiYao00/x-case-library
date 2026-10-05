# 多跳作者回复采集真实验收

日期：2026-10-05（北京时间）

## 目标

验证 `x-case-library` 在 logged-out SSR 只逐层暴露作者自回复时，是否能继续沿作者回复链采集，而不是只停在根帖页面可见的第一条回复。

测试链接：

`https://x.com/xiaoying_eth/status/2106993039894044912`

现有正式案例保持不动。真实测试使用隔离输出：

`.runtime/real-tests/gemini-thread-walk-v1`

该目录 Git ignored，不作为正式案例发布。

## 修复前证据

既有正式案例的 `source.json` 只记录：

- 根帖：`2106993039894044912`
- 作者回复候选：`2106993041554932195`
- 作者回复数：1

只读取根帖 logged-out SSR 时，确实只能发现第一条作者回复。

进一步只读探针证明：

- 根帖页面 SSR -> `2106993041554932195`
- 回复 1 页面 SSR -> `2106993043299782985`

因此问题是单页发现逻辑缺少多跳遍历，不是 Agent 写作层漏掉已经采集的内容。

## 新采集策略

- 从根帖开始 breadth-first 遍历。
- 每个已接受的作者帖子都读取自己的 logged-out SSR 页面。
- SSR 候选先按 username 过滤。
- 候选再通过 `TweetResultByRestId` 精确读取。
- 必须同时满足稳定 `author.id`、username、以及 `inReplyTo.tweetId === 当前节点`。
- 默认最多访问 40 个页面、接受 40 条作者回复。
- 单个后续页面或精确读取失败时保留此前已验证回复，并标记 `partial-via-logged-out-ssr`。
- 不自动重试，不使用账号 Session。

## 离线回归

执行：

- `node --check config/ssr-author-replies.mjs`
- `node --check config/collect-author-case.mjs`
- `node --check scripts/x-case-core.mjs`
- `node tests/test-ssr-author-replies.mjs`
- `npm.cmd run test:workflow`

首轮结果：

- 语法检查全部通过。
- Elsa 既有 SSR fixture 仍发现 `2106928513710518539`。
- Noor 既有 SSR fixture 仍返回 0 条作者回复。
- 新的合成多跳 fixture 成功得到 `101 -> 102`。
- 中途页面失败得到 `partial-via-logged-out-ssr`，并保留已验证回复。
- reply limit 命中时得到 `partial-via-logged-out-ssr`。
- 原 13 项 workflow 测试全部通过。
- 随后新增“回复遍历 partial 会把笔记 capture 标记为部分”的回归测试；最终 workflow 回归为 14/14 通过。

## Gemini 真实测试结果

隔离采集返回：

- HTTP Guest-only：成功
- 登录账号 Session：0 次
- 根帖：1
- 作者回复：11
- 访问 SSR 页面：12
- 12 个页面均 HTTP 200
- `authorRepliesStatus`: `available-via-logged-out-ssr`
- `authorRepliesTermination`: `exhausted`
- 媒体：0

作者回复按链路连续采集到编号 1–11：

1. Drive 文档 -> 完整课程
2. 任意文档 -> 互动大师课
3. 复杂笔记 -> 大白话
4. 文档 -> 考试小抄
5. 文档 -> 思维导图 + 演示文稿
6. Sheets + 日历 -> 完整内容系统
7. 搜索 + YouTube -> 学习路线图
8. Sheets + Docs -> 商业策略报告
9. Drive -> 专业 SOP 生成器
10. Google Sheets -> AI 数据分析师
11. 搜索 -> 创新引擎

这证明原来的“只能拿到回复 1”问题已经被多跳 walker 修复。

## 关于主帖“12 个”与实际 11 条

根帖文案写的是“下面这 12 个 Gemini 提示词”，但公开作者线程实际只有编号 1–11。用户人工复核确认作者确实只发布了这 11 条，因此这里属于作者主帖计数/文案与实际发布数量不一致，不再视为本项目漏采第 12 条。

回复 11 `2106993058139222332` 的机器侧证据也一致：

- `TweetResultByRestId` 的 `legacy.full_text` 就结束在“相邻市场”，不是本项目二次截断。
- `note_tweet` 不存在。
- X 返回的 `legacy.reply_count = 0`。
- 回复 11 的 logged-out SSR 没有新的同作者候选。
- 页面中没有 `12/`。
- Guest `UserTweetsAndReplies` 仍要求登录 Session，本项目没有为此启用账号。

因此这条案例的多跳采集结果可判定为“作者实际公开的 11 条均已采到”。项目通用语义仍保持：logged-out SSR 本身不能对所有未知案例证明完整 Conversation，所以正常 exhausted 状态继续使用 `capture: 待确认`。

## 安全状态

- auth_token：未使用
- ct0：未使用
- Account Session：未使用
- 自动重试：关闭
- 普通用户评论：不持久化
- 本报告最初的隔离测试未覆盖正式案例；随后正式 repair 结果记录在 `tests/REPAIR_ACCEPTANCE_2026-10-05.md`
- 隔离测试输出：仅写入 Git-ignored `.runtime`

## 结论

多跳作者回复缺陷：**修复并通过真实测试**。

Conversation 完整性证明：**仍然不可由 logged-out SSR 保证**。

本报告补充并收紧 `TEST_SUMMARY_2026-10-05.md` 中对“作者回复 READY”的宽泛表述：单层和多跳作者回复现在都已验证，但完整 Conversation 仍只能标记为待确认。
