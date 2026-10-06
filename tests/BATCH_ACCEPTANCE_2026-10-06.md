# Batch V1 真实 Pilot 验收

日期：2026-10-06

## 目标

验证 Batch V1 能对用户明确提供的多条 X status URL 做有界串行转换，同时保持现有单案例质量与账号安全边界。

批次：

```text
history-2026-10-06
```

输入：

- 28 条 X status URL
- 2 条 GitHub URL

## 本地 preflight

`init` 仅做本地解析/查重，没有触发 X 网络采集。

结果：

- pending：26
- existing：2
- ignored：2
- duplicate：0

两条 GitHub 被正确记录为 `non_x_url`：

- `https://github.com/Osmantic/ODS`
- `https://github.com/ai-artist-scripts/image-blaster`

两个已存在 X 案例没有再次请求：

- `2106598997259591922`
- `2106679751566094429`

Batch policy：

```text
guestOnly = true
accountSessionAttempts = 0
concurrency = 1
retryPolicy = none
minCooldownMs = 30000
maxWaveSize = 5
Pilot wave limit = 3
```

## Pilot

Pilot 只允许前三个 pending 案例进入网络阶段。

### 1. Tweet 2107108350299443342

正式标题：

`轻熟女图片生成 Skill：默认人物与人像美术指导`

结果：

- note_ready
- capture：待确认
- authenticatedAccountUsed：false
- retryPolicy：none
- Guest GraphQL：HTTP 200
- remaining：499
- logged-out SSR：HTTP 200
- X Article：available
- Article media：4 / 4 downloaded
- author replies：0 visible via logged-out SSR
- 没有调用账号 Session

Article 原文在“以下保留完整内容：”后没有继续出现可读 SKILL.md 文本块；笔记明确记录该来源边界，没有猜测缺失正文。

### 2. Tweet 2060928267046060445

正式标题：

`公众号新号从0到1起号：定位、内容、运营与冷门赛道`

结果：

- note_ready
- capture：待确认
- authenticatedAccountUsed：false
- retryPolicy：none
- Guest GraphQL：HTTP 200 / 200
- remaining：499 -> 498
- logged-out SSR：HTTP 200 / 200
- X Article：available
- Article media：5 / 5 downloaded
- author replies：1
- 没有调用账号 Session

笔记保留作者的公众号运营经验与 AI 写作提示词，同时没有把作者对平台算法、标签截流、伪原创规避等主张当成已验证事实。

### 3. Tweet 2107111616357728373

正式标题：

`白模素材分享：邀请展示创作成果`

结果：

- note_ready
- capture：待确认
- authenticatedAccountUsed：false
- retryPolicy：none
- Guest GraphQL：HTTP 200
- remaining：499
- logged-out SSR：HTTP 200
- X Article：not-present
- video media：1 / 1 downloaded
- author replies：0 visible via logged-out SSR
- 没有调用账号 Session

原文没有说明白模具体项目/对象；笔记没有从视频画面猜测未写明信息。

## 串行 / cooldown 验收

- 任一 item 为 `processing` 时，Batch 不允许启动第二条。
- 第一条 record 后立即请求下一条，正确返回 `cooldown`，且没有发起第二条网络请求。
- cooldown 满足后才启动下一条。
- 三个案例依次完成，没有并发。

## Wave 验收

第三条 `record` 后：

```text
wave.started = 3
wave.completed = 3
note_ready = 3
pending = 23
existing = 2
```

再次执行 `next` 返回：

```text
status = wave_complete
stopReason = wave_limit
```

第 4 条没有启动。

当前 manifest：

```text
.runtime/batches/history-2026-10-06/batch.json
```

保持 paused，可在用户明确决定后用新 wave 继续；本次验收到此停止，没有自动 resume。

## 账号安全结论

三条正式 source.json 均：

```text
authenticatedAccountUsed = false
retryPolicy = none
```

Batch manifest：

```text
guestOnly = true
accountSessionAttempts = 0
```

Pilot 没有读取或使用用户 X Account Session，没有 Cookie/auth_token/ct0 fallback，没有自动重试、Guest Token 轮换、proxy/IP/account 轮换。

本次观察到的网络限制仅作用于 Guest 路径；如果未来触发 429 / 平台 401/403 / Guest Token / 网络异常，Batch 设计会进入 circuit_breaker，而不是切换用户账号。

## 离线回归

实现后：

- Batch V1：9 / 9 PASS
- link preservation：7 / 7 PASS
- single-case workflow：24 / 24 PASS
- npm audit：0 vulnerabilities
- git diff --check：PASS

## 结论

**Batch V1 Pilot: PASS**

已验证：

- 显式多链接本地 preflight
- GitHub 忽略
- existing 零重复请求
- Guest-only 0 / 0 account attempts
- concurrency = 1
- cooldown
- 3-case Pilot wave
- note_ready 记录
- wave_limit 自动停止
- 可恢复 manifest

未在本次 Pilot 中触发真实 429/circuit breaker；该路径由离线测试覆盖，不主动制造平台限流。
