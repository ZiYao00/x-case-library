# Agent Guide

## Purpose

This project collects reusable X/Twitter AI cases for local Obsidian use.

Target flow:

```text
X URL
-> Guest-only author-only collection
-> source.json + local media
-> V4.2 Markdown
-> title-based case folder
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

If any older migration script, test report, or README wording conflicts with `docs/NOTE-SPEC.md`, follow NOTE-SPEC.

## Safety invariants

- Prefer Guest-only collection.
- Do not use the user's X account unless Guest-only is proven insufficient for required author content.
- If account Session is explicitly authorized, allow at most 2 real attempts; stop after 2 failures.
- Do not collect or persist ordinary-user comments.
- Keep only root-author posts, root-author replies, and their media.
- Do not enable automatic retries, bulk scraping, bookmark scanning, likes, follows, replies, posts, DMs, or other write actions.
- Never store `auth_token`, `ct0`, cookies, or credentials in this repository.
- Never hand-edit `source.json` for presentation, translation, naming, or organization. The only allowed replacement is the explicit `repair` workflow, which must stage a fresh acquisition, verify identity/non-regression, preserve the old snapshot, and finalize through the program.

## Case lifecycle

For link-to-note requests, use `scripts/run-x-case.mjs` (`onboarding`, `prepare`, `repair`, `validate`, `finalize`). The canonical Skill is `skill/x-learning-automation/SKILL.md`. A bare valid post link requests one complete note; an existing finalized case is returned read-only by default only after its formal Markdown integrity passes. Broken/ambiguous finalized state is `action_required` and must not trigger network collection. Only an explicit user request to update/repair an existing case may invoke `repair`. Explicit discussion/no-save intent takes precedence. Do not bypass duplicate, repair, or environment guards with the low-level collector. Read `docs/LOCAL-AGENT-INSTALL.md` for installation and structured status semantics.

Agent edits only returned runtime `analysis.json`; original prose/prompt segments must concatenate exactly to each source text. Program-generated Markdown follows NOTE-SPEC. Review preview after validate. Only `note_ready` means business completion. Existing published cases are returned without network access or overwrite unless the user explicitly requested `repair`; repair stays staged until validated/finalized and preserves rollback evidence. Failed collection or repair is never automatically retried. Runtime is Git-ignored. SSR discovery alone cannot certify complete author threads.

Collection staging:

```text
notes/x/00-待整理/<tweet-id>/
```

This numeric folder is temporary only.

After V4.2 Markdown is generated, always finalize:

```powershell
npm run finalize -- <tweet-id>
```

Result:

```text
notes/x/00-待整理/<note-title>/
├─ <note-title>.md
├─ source.json
└─ media/
```

Do not use Tweet ID as the permanent visible case-folder name.

## Author organization

Future organized layout:

```text
notes/x/作者/<author.username>/<note-title>/
```

Human-visible author folder uses `rootTweet.author.username`.

Stable identity must be checked with `rootTweet.author.id`.

For bulk author organization, preview with `npm run organize:author -- --all --dry-run`. Do not run the real `--all` move unless the user explicitly asks.

## Obsidian

The Vault consumes `notes/x` through a Junction at:

```text
G:\ZiYao\Note\X案例库
```

Shared CSS source is the sibling repository:

```text
..\obsidian-learning-snippets
```

Do not copy shared CSS into this repository.

Required snippets:

- `learning-lab.css`
- `x-case-note.css`

Required plugin for default media rendering:

- Media Viewer 2.2.1

The real `media/` directories stay on disk but are hidden from Obsidian File Explorer by `x-case-note.css`.

## Note contract summary

Full rules live in `docs/NOTE-SPEC.md`.

Minimum invariants:

- Body order: `媒体 -> 原文 -> [可选的一句来源核对] -> 一句话看懂 -> 复刻要点`.
- No standalone `## Prompt`.
- Prompt blocks attach directly to the source post/reply.
- Prompt text is never translated or rewritten; Prompt URL / @handle text also stays raw.
- Ordinary prose links are renderer-owned: source prose is untrusted display data, raw Markdown/WikiLink/HTML semantics are neutralized, and only source-provided validated URL / mention metadata may become Markdown links. Agent must not guess or inject targets.
- When source provides exact link spans, preserve them. Legacy span-less links may use one boundary-safe fallback occurrence; never global-replace every matching token.
- X Article rich text may be supplemented Guest-free through FxTwitter; accepted Article links remain source-derived. Article media is restricted to trusted X CDN HTTPS hosts, and supplement/media failure marks the case partial instead of triggering account fallback.
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
