# x-learning-automation 本地安装与离线验收

日期：2026-10-05（北京时间）。本次没有真实 X 请求、账号会话或 Obsidian UI 操作。

## 已执行

- `python -X utf8 <skill-creator>/scripts/quick_validate.py <project>/skill/x-learning-automation`：Skill is valid。普通 Python 调用受到 Windows 默认 GBK 影响；UTF-8 模式校验通过，未修改系统编码或安装依赖。
- `npm.cmd run test:workflow`：13 项离线测试通过。隔离样本保留在 Git-ignored `.runtime/offline-tests`，不删除用户数据。
- `node tests/test-ssr-author-replies.mjs`：既有离线 SSR 样本回归输出 Elsa 作者回复 ID `2106928513710518539`，Noor 无可见候选。
- Node 语法检查：统一核心、入口及采集器通过。
- Codex 安装 Junction：`C:\Users\YAO\.agents\skills\x-learning-automation` 指向 `G:\GitHub\x-case-library\skill\x-learning-automation`。
- 从安装路径执行 `local_bridge.ps1 onboarding`：ready，Node v24.20.0，actions/warnings 为空，networkChecked=false。
- 现有真实案例 `2106204165525610601` 用 prepare 查重：existing_case_found。source.json 前后 SHA-256 相同，没有采集或覆盖。
- Git diff 检查：变更限于 Skill、统一运行与校验、已有采集/命名保护、测试及对应说明。没有 commit/push。

## 离线测试范围

精确域名与链接后缀、多链接拒绝、无效链接无采集、材料复用、analysis 保留、Prompt 与嵌套反引号、来源哈希变化拒绝、翻译缺失拒绝、缺失/重名媒体拒绝、部分采集标记、重复与幂等完成、已有草稿保护、标题冲突、路径越界、Vault 映射门禁、失败不重试、模拟采集到 note_ready。

## 仍需实际验收

1. 新 Codex 会话能发现 Skill，仅发送一条用户选择的有效 X/Twitter 帖子链接后自动进入流程。
2. 用该单条链接验证当前真实 X 接口、作者回复和媒体下载；失败不自动重试。
3. 在 Obsidian 查看生成笔记，验证 Gallery 弹窗、Prompt 完整复制、长 Prompt 滚动及 media 目录隐藏。
4. Hermes / WorkBuddy 尚未安装或验证；本次只安装 Codex。

ready 与离线测试不代替上述验收。机器检查只读取已配置 Vault 状态，没有更改 Vault、插件或共享 CSS。
