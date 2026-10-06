# X Article Embedded Markdown Acceptance — 2026-10-06

## Scope

Validate support for FxTwitter X Article `MARKDOWN` atomic entities without adding a second Article acquisition route or a new note section.

Real case:

- Tweet: `https://x.com/leo_xiaolei/status/2107108350299443342`
- Case ID: `2107108350299443342`
- Existing note: `轻熟女图片生成 Skill：默认人物与人像美术指导`

## Regression root cause

The Article contains an atomic block whose entity is:

```text
entityMap["3"].value.type = MARKDOWN
entityMap["3"].value.data.markdown = <full document>
```

The old normalizer retained only block `type/text/links`, so the atomic block became a blank line and the embedded document was lost before rendering.

## Implemented contract

- Preserve the raw MARKDOWN payload in `source.json`.
- Deterministically unwrap only one outer `markdown` / `md` fenced code block when writing the physical document.
- Store supported documents at:
  `_case-data/<tweet-id>/documents/<tweet-id>_<source-declared-filename>`.
- If no source filename is explicit, fall back to `<tweet-id>_MARKDOWN.md`.
- Do not use arbitrary ordinal prefixes such as `001_`.
- Render an Obsidian WikiLink at the original Article atomic position; do not add a new `## 附件文档` section and do not inline the whole document.
- Unknown atomic entity types are recorded as unsupported and make capture partial instead of disappearing silently.
- Repair copies, backs up and rolls back documents together with source/Markdown/media.

## Real repair evidence

One explicit Guest-only repair was run. No automatic retry or account Session was used.

Fresh source:

- Article status: `available`
- unsupported atomic count: `0`
- previous author replies: `0`
- fresh author replies: `1`
- downloaded media: `4 -> 4`
- regression reasons: none

Embedded document:

- source filename: `SKILL.md`
- materialized filename: `2107108350299443342_SKILL.md`
- local path: `documents/2107108350299443342_SKILL.md`
- raw MARKDOWN source length: `4396` characters
- materialized document length: `4381` characters
- raw source begins with the outer `markdown` fence
- materialized document begins directly with YAML frontmatter:
  `---\nname: beauty-image-defaults`
- status: `written`

The fresh author reply was also included in the repaired note:

```text
创建 Skill，自己创建下 SKILL.md 把文末的内容复制进去即可或者直接把文章给你的 codex、cc 等让它创建下就好。
```

The main note now renders the document at the original Article location as:

```text
[[X案例库/_case-data/2107108350299443342/documents/2107108350299443342_SKILL.md|打开附件：SKILL.md]]
```

The old incorrect claim that the SKILL.md body was unavailable is no longer present.

Finalize result:

- status: `note_ready`
- repaired: `true`
- copied documents: `2107108350299443342_SKILL.md`
- capture: `待确认` (logged-out SSR still cannot prove full conversation completeness)

## Vault verification

The project note and Vault Junction note are byte-identical.

The project document and Vault Junction document are byte-identical.

The WikiLink target exists under the Vault path. Current tooling does not control the Obsidian GUI, so this acceptance verifies the link target and file availability rather than simulating a GUI click.

A duplicate `prepare` after repair returns `existing_case_found` and resolves the Layout V2 case without a new collection request.

## Offline regressions

- single-case workflow: 24 / 24 PASS
- link preservation / Article atomic: 9 / 9 PASS
- Batch V1: 9 / 9 PASS
- total: 42 / 42 PASS

## Verdict

**READY**

X Article embedded Markdown documents are now preserved as source truth, materialized as stable local documents, linked from the main note, protected by repair rollback, and covered by offline regressions plus one real repair acceptance.
