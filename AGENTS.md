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
- Never rewrite `source.json` for presentation, translation, naming, or organization.

## Case lifecycle

For link-to-note requests, use `scripts/run-x-case.mjs` (`onboarding`, `prepare`, `validate`, `finalize`). The canonical Skill is `skill/x-learning-automation/SKILL.md`. A bare valid post link requests one complete note; explicit discussion/no-save intent takes precedence. Do not bypass duplicate/environment guards with the low-level collector. Read `docs/LOCAL-AGENT-INSTALL.md` for installation and structured status semantics.

Agent edits only returned runtime `analysis.json`; original prose/prompt segments must concatenate exactly to each source text. Program-generated Markdown follows NOTE-SPEC. Review preview after validate. Only `note_ready` means business completion. Existing published cases are returned without network access or overwrite; failed collection is never automatically retried. Runtime is Git-ignored. SSR discovery alone cannot certify complete author threads.

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

- Body order: `媒体 -> 原文 -> 一句话看懂 -> 复刻要点`.
- No standalone `## Prompt`.
- Prompt blocks attach directly to the source post/reply.
- Prompt text is never translated or rewritten.
- Non-Chinese ordinary author prose keeps original + concise Chinese translation.
- Media uses Media Viewer Gallery with `size: small`, `addButton: false`.
- Long Prompt body is capped at 320px with internal scrolling; copy returns full content.
- Frontmatter remains compact.
- Collection internals do not appear in the reading body.

## Git

Real case content under `notes/x` is local data and remains Git-ignored.

Only empty directory markers are tracked.

Do not push, publish, or release unless explicitly requested.
