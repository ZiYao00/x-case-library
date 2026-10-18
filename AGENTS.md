# Agent Guide

## Purpose

This project collects reusable X/Twitter AI cases for local Obsidian use.

Target flow:

```text
X URL
-> Guest-only author-only collection
-> source.json + local media / embedded documents
-> V4.2 Markdown
-> Storage Layout V2 reading/data split
-> Obsidian
-> optional author-based organization
```

## Mandatory reading order

Before changing collection, note layout, folder structure, or Obsidian behavior, read:

1. `docs/NOTE-SPEC.md` — **single source of truth for note conversion**
2. `docs/ARCHITECTURE.md`
3. `docs/OBSIDIAN.md`
4. `docs/HANDOFF.md`
5. `README.md`

For any explicit multi-link batch request or explicit request to expand links from an already-finalized collection case, also read `docs/BATCH-OPERATIONS.md` before running or changing Batch behavior.

If any older migration script, test report, or README wording conflicts with `docs/NOTE-SPEC.md`, follow NOTE-SPEC.

## Safety invariants

- Prefer Guest-only collection.
- Do not use the user's X account unless Guest-only is proven insufficient for required author content.
- If account Session is explicitly authorized, allow at most 2 real attempts; stop after 2 failures.
- Batch V1 is stricter than single-case mode: permanently Guest-only, account attempts `0 / 0`, no cookies/Session fallback, concurrency 1, no automatic retry/token/proxy/account rotation.
- Do not collect or persist ordinary-user comments.
- Keep only root-author content and media, including verified one-level related quotes; foreign-author bridges contain relationship metadata only, never comment prose/media.
- Do not enable automatic retries, unbounded/broad scraping, bookmark scanning, likes, follows, replies, posts, DMs, or other write actions. The only multi-link mode allowed is bounded serial Batch V1 for either explicit user-supplied status URLs or one-level structured status links from an explicitly selected finalized collection case under `docs/BATCH-OPERATIONS.md`.
- Never store `auth_token`, `ct0`, cookies, or credentials in this repository.
- Never hand-edit `source.json` for presentation, translation, naming, or organization. Program updates are limited to explicit repair, verified missing-reply supplementation, authorized legacy merge, and hash-pinned adoption of approved reading-layer revisions under NOTE-SPEC 2.4–2.6; stage, verify, preserve snapshots, and finalize through the unified CLI.

## Case lifecycle

For single link-to-note requests, use `scripts/run-x-case.mjs` (`onboarding`, `prepare`, `repair`, `validate`, `finalize`). For an explicit multi-link conversion request, use `scripts/run-x-batch.mjs` and follow `docs/BATCH-OPERATIONS.md`; direct URL lists use `init`, while an explicitly selected finalized collection case may use `from-case <tweet-id>` to expand only its already-captured direct X status links. Batch may only schedule the existing single-case lifecycle one item at a time and `from-case` must never recurse into child posts. The canonical Skill is `skill/x-learning-automation/SKILL.md`. A bare valid post link requests one complete note; an existing finalized case is returned read-only by default only after its formal Markdown integrity passes. Broken/ambiguous finalized state is `action_required` and must not trigger network collection. Only an explicit user request to update/repair an existing case may invoke `repair`. Explicit discussion/no-save intent takes precedence. Do not bypass duplicate, repair, Batch, or environment guards with the low-level collector. Read `docs/LOCAL-AGENT-INSTALL.md` for installation and structured status semantics.

Agent edits only returned runtime `analysis.json`; original prose/prompt segments must concatenate exactly to each source text. Program-generated Markdown follows NOTE-SPEC. Review preview after validate. Only `note_ready` means business completion. Captured member links return the existing case without network access. A supplied uncaptured reply may supplement its verified same-author case through staging, validation and controlled finalize; explicit repair remains a full refresh. Use returned caseId for validate/finalize, not necessarily the input ID. Legacy merge requires preview and user authorization; old cases are archived outside the Vault after successful publication. Failed work is never automatically retried. Runtime/archive are Git-ignored. SSR discovery alone cannot certify complete author threads.

Collection staging:

```text
notes/x/00-待整理/<tweet-id>/
```

This numeric folder is temporary only.

After V4.2 Markdown is generated, always finalize:

```powershell
node scripts/run-x-case.mjs finalize <case-id>
```

Result (Storage Layout V2):

```text
notes/x/
├─ 00-待整理/<note-title>.md
└─ _case-data/<tweet-id>/
   ├─ source.json
   ├─ media/
   └─ documents/          [only when Article embeds supported documents]
```

The verified same-author root Tweet ID is the default stable case identity; inputTweetId remains separate. Explicit standalone cases keep the input ID. The visible Markdown filename comes from the note title. See NOTE-SPEC 2.5 for ancestry limits, aliases, merge and explicit publication/lock recovery.

## Author organization

Organized Layout V2 moves only the reading-layer Markdown:

```text
notes/x/作者/<author.username>/<note-title>.md
```

Human-visible author folder uses `rootTweet.author.username`.

Stable identity must be checked with `rootTweet.author.id`.

For bulk author organization, preview with `npm run organize:author -- --all --dry-run`. Do not run the real `--all` move unless the user explicitly asks.

## Obsidian

The Vault consumes `notes/x` through a Junction at:

```text
G:\ZiYao\Note\X案例库
```

Shared CSS is owned by the repository identified in `config/obsidian-style.json`.
The provider may be renamed or checked out anywhere. Onboarding reads its CSS
dependency list from that contract and checks installed Vault snippets; it does
not resolve a local sibling repository. Do not copy shared CSS into this project.

Required snippets:

- `learning-lab.css`
- `x-case-note.css`

Required plugin for default media rendering:

- Media Viewer 2.2.1

Storage Layout V2 keeps real `source.json`, `media/`, and optional `documents/` packages under `notes/x/_case-data/<tweet-id>/`. The `_case-data` root stays on disk but is hidden from Obsidian File Explorer by `x-case-note.css`; supported embedded Markdown documents remain openable through generated Obsidian WikiLinks even though the data root is hidden.

## Note contract summary

Full rules live in `docs/NOTE-SPEC.md`.

Minimum invariants:

- Body order: `媒体 -> 原文 -> [可选的一句来源核对] -> 一句话看懂 -> 复刻要点`.
- No standalone `## Prompt`.
- Prompt blocks attach directly to the source post/reply.
- Prompt text is never translated or rewritten; Prompt URL / @handle text also stays raw. Renderer labels are only 图片生成 Prompt / 视频生成 Prompt when promptType is verified; no model name in the label.
- Ordinary prose links are renderer-owned: source prose is untrusted display data, raw Markdown/WikiLink/HTML semantics are neutralized, and only source-provided validated URL / mention metadata may become Markdown links. Agent must not guess or inject targets.
- When source provides exact link spans, preserve them. Legacy span-less links may use one boundary-safe fallback occurrence; never global-replace every matching token.
- X Article rich text may be supplemented Guest-free through FxTwitter. Article `MARKDOWN` atomic entities are preserved as source truth, materialized under `documents/<tweet-id>_<filename>`, and rendered at the original Article position as an Obsidian WikiLink; unsupported atomic entities mark the case partial instead of being silently dropped.
- If the author explicitly claims a directly countable N and current source clearly disagrees, set `analysis.sourceCheck` to one short sentence only; otherwise leave it empty. This does not change `capture`.
- Derived non-Prompt text (display title, translation, summary, points, sourceCheck) is rendered as safe plain text in the Markdown body; do not rely on source-supplied Markdown/HTML syntax.
- Non-Chinese ordinary author prose keeps original + concise Chinese translation.
- Media uses Media Viewer Gallery with `size: small`, `addButton: false`.
- Long Prompt body is capped at 320px with internal scrolling; copy returns full content.
- Frontmatter remains compact.
- Collection internals do not appear in the reading body.

## Git

Real case content under `notes/x` is local data and remains Git-ignored.

Only empty directory markers are tracked.

Do not push, publish, or release unless explicitly requested.
