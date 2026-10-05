# Agent Guide

## Purpose

This project collects reusable X/Twitter AI cases. The user-facing target is:

```text
X URL -> Agent/LLM -> author-only collection -> local media -> Markdown -> Obsidian
```

## Safety invariants

- Prefer Guest-only collection.
- Do not use the user's X account unless Guest-only is proven insufficient for required author content.
- If account Session is explicitly authorized, allow at most 2 real attempts; stop after 2 failures.
- Do not collect or persist ordinary-user comments.
- Keep only the root author's post, author replies, images, videos, and other author-owned content.
- Do not enable automatic retries, bulk scraping, bookmarks scanning, likes, follows, replies, posts, DMs, or other write actions.
- Never store auth_token, ct0, cookies, or credentials in this repository.

## Notes and Obsidian

- Canonical local notes root: `notes/x`.
- New cases go to `notes/x/00-待整理/<tweet-id>/`.
- The Obsidian Vault consumes this directory through a Windows Junction at `G:\ZiYao\Note\X案例库`.
- Real case data under `notes/x` is local content and must remain Git-ignored.

## Shared Obsidian style dependency

Canonical source:

https://github.com/ZiYao00/obsidian-learning-snippets

Read `config/obsidian-style.json` before changing note layout or Frontmatter.

Do not copy, regenerate, fork, or independently modify shared Core/Extension CSS in this repository. If shared styles need to change, update the canonical CSS repository first.

Current note Frontmatter must include:

```yaml
cssclasses:
  - learning-page
  - x-case-note
```

X case note layout contract:

- Body order is fixed: `## 媒体` -> `## 原文` -> `## 一句话看懂` -> `## 复刻要点`.
- There is no standalone `## Prompt` section.
- Render the root post as an `x-post` timeline message and root-author replies as separate `x-reply` messages in chronological order.
- Attach each reusable fenced `prompt` block directly to the root post or reply that supplied it.
- Do not add labels such as `Prompt 1 · 回复 1`; the block itself shows `PROMPT` and Obsidian's native copy control.
- Do not repeat author handle, Tweet ID, reply IDs, Guest/SSR/API details, local file paths, resolution, duration, or file size in the body.
- Use Media Viewer Gallery as the default media renderer: `size: small`, `addButton: false`.
- Gallery entries should use unique media basenames. Current generated filenames include Tweet IDs and are designed to stay unique.
- Keep native embeds as a fallback only if Gallery resolution becomes ambiguous or Media Viewer is unavailable.
- For non-Chinese author prose, preserve the original text and add a concise Chinese translation directly below it as a nested quote.
- Do not translate Prompt content, URLs, @handles, model names, or technical parameters. Translation is a Markdown reading-layer derivative and must never be written into `source.json`.
- Prompt blocks remain fully copyable but are visually capped at 320px with internal scrolling.
- Frontmatter should stay compact: source, author, published, optional model, status, capture, cssclasses, tags.
- `capture` uses only `完整`, `待确认`, or `部分`; technical reasons remain in `source.json`.
- Never rewrite `source.json` while changing presentation.

## Deferred work

A richer Bilibili-style summarization/organization pipeline is intentionally deferred. Preserve `source.json` as immutable source truth so future summarization can be added without changing the collector.
