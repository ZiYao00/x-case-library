# ChatGPT Web 执行适配

仅在 ChatGPT 网页端安装本 Skill 时使用。

## 前提

网页版 ChatGPT 的远程运行环境不能直接访问 Windows 本机盘符。要真正读写 x-case-library 与 Obsidian，当前会话必须有已连接、已授权的本地开发工作区连接器，例如 CodexPro。

Skill 安装成功只代表指令可被发现，不代表本地项目已经可访问。

## 工作区选择

1. 优先复用用户当前已授权且明确为 `x-case-library` 的本地工作区。
2. 若当前没有选中该项目，只能打开用户明确指定的项目路径；不要扫描磁盘猜位置。
3. 打开后先读取 `AGENTS.md`，再按 mandatory reading order 读取项目文档。
4. 项目至少应包含 `package.json`、`docs/NOTE-SPEC.md`、`scripts/run-x-case.mjs` 和 `skill/x-learning-automation/SKILL.md`。
5. 无法取得本地工作区访问时停止并说明限制，不要在网页 sandbox 创建替代项目。

## 命令路由

网页端不要执行 PowerShell local bridge。通过本地工作区连接器在项目根目录运行：

```text
node scripts/run-x-case.mjs onboarding
node scripts/run-x-case.mjs prepare "<完整原始消息>"
node scripts/run-x-case.mjs repair "<完整原始消息>"   # 仅显式 repair 意图
node scripts/run-x-case.mjs validate <tweet-id>
node scripts/run-x-case.mjs finalize <tweet-id>
```

明确的多链接批量转换先读取项目 `docs/BATCH-OPERATIONS.md`，再通过同一本地工作区执行：

```text
node scripts/run-x-batch.mjs init <project-relative-input.txt> --batch-id <id> --wave-size 3
node scripts/run-x-batch.mjs status <id>
node scripts/run-x-batch.mjs next <id>
# 对返回的单个 Tweet 继续使用 run-x-case validate/finalize
node scripts/run-x-batch.mjs record <id> <tweet-id>
node scripts/run-x-batch.mjs resume <id> --wave-size 5   # 仅 wave_limit 正常暂停
```

使用连接器提供的文件能力编辑 runtime `analysis.json`。不要直接编辑正式 `source.json` 或最终 Markdown。

## repair

- 只有明确“更新/修复/重新采集/补齐已有案例”意图才能启动。
- `repair_materials_ready` 后读取 handoff、staged source、comparison、analysis。
- 保持标题不变。
- validate 后检查 preview；正式案例此时仍应未变化。
- finalize 成功后核对返回的正式 note path。
- 若连接器允许读取 Vault Junction，可比较项目正式 Markdown 与 Junction 目标的哈希/内容；实际没检查时不要声称 Obsidian 已刷新。

## 其它边界

沿用主 `SKILL.md` 与项目 `AGENTS.md` 的安全规则。不要自动安装依赖、开启账号 Session、重试失败采集、删除 repair 任务或 push Git。Batch 模式永久 Guest-only，账号尝试 0 / 0；若环境中启用了 `XACTIONS_ALLOW_ACCOUNT_SESSION`，必须在任何 Batch 网络请求前停止，绝不能改走 Cookie/Session fallback。
