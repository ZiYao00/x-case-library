# 原文超链接 / X Article 真实验收

日期：2026-10-06（北京时间）

## 目标

验证 `x-case-library` 能在不改写 source text、Prompt 或账号安全策略的前提下，把 X 原文中的真实链接关系保留到 Obsidian Markdown。

真实样本：

`https://x.com/0xarthurzs/status/2106598997259591922`

该 Tweet 指向一篇 X Article，Article 中包含大量作者推荐。

## 实现规则

- 普通 prose：source 提供的 URL / @mention 元数据由 renderer 自动转成 Markdown 链接。
- Prompt：URL / @handle 保持原始文本，不做 Markdown 链接化。
- URL 只接受 `http://` / `https://`。
- Tweet 原始文本保持不变；链接是阅读层派生。
- X Article：XActions 仍是 Tweet 主采集器；检测到 Article 后，FxTwitter 只做一次无登录、无重试的正文 / 富文本 / 封面补充读取。
- FxTwitter 数据必须通过 Tweet ID 和 Article ID 校验。
- Article 补充失败不让整篇失败，只把 capture 降为 `部分`。
- Article 封面进入现有媒体本地化。

## 离线回归

执行：

```text
npm.cmd run test:links
npm.cmd run test:workflow
```

结果：

- link preservation：4 / 4 PASS
- workflow：18 / 18 PASS
- syntax checks：PASS
- `git diff --check`：PASS

覆盖：

- 中文 + emoji + @mention + URL 不依赖 X 字符索引。
- `@karpathy` -> `[@karpathy](https://x.com/karpathy)`。
- 网站名 -> `[OpenRouter](https://openrouter.ai/)`。
- DraftJS Article LINK entity -> Markdown URL。
- 非 HTTP(S) target 不生成可点击链接。
- Prompt 内 URL 保持原样。
- Article supplement unavailable -> `capture: 部分`，原 Tweet 仍正常发布。
- repair 不允许把正式案例中已经保存的 linkEntities / 可用 X Article 修丢。
- FxTwitter Tweet / Article identity mismatch 拒绝接受。

## 真实 Article 采集

隔离输出：

`.runtime/real-tests/article-link-preservation-v1/`

结果：

- root Tweet：成功
- author replies：1
- Article status：`available`
- Article blocks：102
- 含 mention link 的 Article blocks：62
- Article supplement provider：FxTwitter
- FxTwitter HTTP：200
- Article 封面：1 张，已下载
- 封面大小：163169 bytes
- authenticatedAccountUsed：false
- Account Session：未使用

根帖原始短链：

`https://t.co/owhZuBbjXD`

source 中保存的真实目标：

`https://x.com/i/article/2106592625956638720`

阅读层渲染为可点击 Markdown。

Article 中的真实作者条目：

`@karpathy：模型原理和从零实现……`

source 保存：

```json
{
  "type": "mention",
  "token": "@karpathy",
  "label": "@karpathy",
  "target": "https://x.com/karpathy"
}
```

Markdown 渲染：

```markdown
[@karpathy](https://x.com/karpathy)：模型原理和从零实现……
```

## 完整 renderer 真实预览

真实 source 经过 `renderCase()` 生成隔离 preview：

- capture：`待确认`
- Article 标题链接：存在
- @karpathy 链接：存在
- 实际 X mention Markdown 链接：62
- Article cover Gallery：存在
- Prompt 规则：未改变

预览文件：

`.runtime/real-tests/article-link-preservation-v1/preview.md`

## 网站链接兼容性

当前本地正式案例中没有可复用的外部网站 URL 样本，因此没有额外制造一次真实 X 网络采集。

但同一链接管线已通过离线 fixture 验证：

- Tweet `t.co -> expandedUrl` 支持任意 HTTP(S) 网站。
- Article `data.links` 支持网站名作为显示文字。
- Article DraftJS `LINK` entity 支持真实网页 URL。
- renderer 与 X 作者 mention 共用同一 Markdown 输出机制。

后续自然遇到包含外部网站链接的真实案例时，可再增加一条实网回归；不需要修改架构。

## 结论

**READY**

当前链接保留能力覆盖：

- X @作者
- 普通网站
- 工具 / 产品页
- GitHub / 文章 URL
- Tweet t.co 展开目标
- X Article 作者 mention
- X Article 富文本 website link

所有链接目标必须来自 source 元数据；Agent 不猜链接，Prompt 不改写。
