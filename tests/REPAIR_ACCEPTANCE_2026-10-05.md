# 已有正式案例 repair 真实验收

日期：2026-10-05（北京时间）

## 目标

验证新增的显式 `repair` 流程可以安全更新已经 finalize 的正式案例，而不是要求人工删除旧目录或绕过 `existing_case_found`。

真实目标：

`https://x.com/xiaoying_eth/status/2106993039894044912`

正式案例：

`notes/x/00-待整理/Gemini 将 Drive 文档转成课程：首条提示词案例/`

## repair 前状态

正式 `source.json` 只有：

- 根帖：1
- 作者回复：1
- 已下载媒体：0

正式 Markdown 也只有“回复 1”。

## repair 准备阶段

执行：

```powershell
node scripts/run-x-case.mjs repair https://x.com/xiaoying_eth/status/2106993039894044912
```

结果：

- `status = repair_materials_ready`
- previousReplyCount = 1
- freshReplyCount = 11
- previousDownloadedMedia = 0
- freshDownloadedMedia = 0
- regressionReasons = []
- 正式 source / Markdown 在 repair prepare 阶段未被改写
- fresh source 写入 Git-ignored `.runtime/<tweet-id>/repairs/<timestamp>/case/`
- 旧正式 source / Markdown 已复制到同一 repair 的 `before/`

身份门禁：

- Tweet ID 相同
- root author 数字 ID 相同
- fresh source 没有丢失旧作者 Tweet
- fresh source 没有减少已下载媒体

## analysis / validate

repair 保留旧笔记标题：

`Gemini 将 Drive 文档转成课程：首条提示词案例`

重新整理后：

- analysis posts = 12（主帖 + 11 条作者回复）
- prompt blocks = 11
- 回复顺序 = 1 -> 11
- summary / reproduction points 已改为覆盖完整 11 条提示词，而不是只描述第 1 条

执行：

```powershell
node scripts/run-x-case.mjs validate 2106993039894044912
```

结果：

- `status = validated`
- `mode = repair`
- `capture = 待确认`
- preview 连续包含“回复 1”到“回复 11”
- validate 后正式 source / Markdown 仍保持 repair 前哈希

## finalize

执行：

```powershell
node scripts/run-x-case.mjs finalize 2106993039894044912
```

结果：

- `status = note_ready`
- `repaired = true`
- previousReplyCount = 1
- authorReplyCount = 11
- copiedMedia = []
- warnings = []

finalize 写回前再次核对旧正式 source / Markdown 哈希。正式替换完成后再次按正式目录重新 render 验证。

## Obsidian Junction 验证

分别读取：

- 项目正式 Markdown
- `G:\ZiYao\Note\X案例库` Junction 下对应 Markdown

结果：

- repo SHA-256 = `7dce7ada6a06e6c3ccc5e8d22d716c72984b513c669249b25f2b66b330317b16`
- vault SHA-256 = `7dce7ada6a06e6c3ccc5e8d22d716c72984b513c669249b25f2b66b330317b16`
- same = true
- reply blocks = 11
- “回复 11”存在
- 新的“实际收录作者连续发布的 11 条提示词”摘要存在

因此 Obsidian 实际读取的是已经 repair 后的正式文件，不是只更新项目内副本。

## 关于“12 个提示词”

主帖原文写“12 个 Gemini 提示词”，但作者公开线程实际只有编号 1–11。用户人工复核确认作者确实只发布 11 条。

本项目保留主帖原文，不为了修正文案而改写 source；阅读层 summary 则准确说明本案例实际收录 11 条。

## 离线回归

新增 repair fixture 覆盖：

- prepare repair 不触碰正式文件
- fresh source 通过同 Tweet / author 校验
- 标题锁定
- validate 前正式文件不变
- finalize 后正式 source / Markdown 更新
- before 备份存在
- 已完成 repair 再 finalize 幂等
- 新采集如果比正式案例少作者回复则阻止降级

最终：

`npm.cmd run test:workflow` -> 15 / 15 PASS

## 结论

**READY**

已有正式案例现在有受控更新路径：

`repair -> analysis -> validate -> finalize`

普通 `prepare` 仍然对正式重复案例只返回 `existing_case_found`，不会自动联网刷新。repair 只有在用户明确要求更新/修复时才允许执行。
