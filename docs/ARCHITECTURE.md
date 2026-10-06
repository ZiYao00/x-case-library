# Architecture

## Current scope

The local Agent entry is `skill/x-learning-automation`, installed by Junction. `scripts/run-x-case.mjs` owns onboarding, duplicate detection, material resume, validation and final completion. It calls the existing collector; no model API or background service is introduced. Agent fills runtime analysis segments and derived content; deterministic rendering checks source hashes and exact text coverage before using the existing naming finalizer. Runtime stays in Git-ignored `.runtime`. See `LOCAL-AGENT-INSTALL.md` for the command and status contract.

The project separates collection, source truth, reading presentation, naming/finalization, and later organization.

```text
X URL
  -> Guest-only collector
  -> notes/x/00-待整理/<tweet-id>/      [temporary staging]
     -> source.json + media
  -> Agent/LLM creates V4.2 Markdown
  -> finalize-case.mjs
  -> notes/x/00-待整理/<note-title>/    [formal pending case]
  -> Obsidian Junction
  -> optional organize-by-author.mjs
  -> notes/x/作者/<author.username>/<note-title>/
```

## Collection layer

Pinned dependency: `xactions@4.0.1`.

Current production path:

1. `TweetResultByRestId` gets the root post.
2. Prefer NoteTweet text over `legacy.full_text` when present.
3. Start a Guest-only SSR reply walker from the root post.
4. For each accepted author post, fetch its logged-out X page and inspect SSR conversation entries.
5. Keep only candidates whose actual author matches the root author, fetch them exactly with `TweetResultByRestId`, and require stable author ID plus a direct `inReplyTo` edge to the current node.
6. Continue breadth-first through accepted author replies until the queue is exhausted, with hard limits of 40 visited pages and 40 author replies.
7. Preserve already verified replies if a later page/exact fetch fails; traversal errors or limits produce `partial-via-logged-out-ssr` and a partial note instead of discarding earlier successes.
8. Preserve Tweet URL / mention entities alongside the immutable source text, including exact source spans when verifiable, so the renderer can recreate only the intended clickable occurrence without asking the Agent to infer links.
9. Treat all Tweet / Article prose as untrusted display data: neutralize source Markdown, Obsidian WikiLink and raw HTML semantics before reinserting only validated source-provided HTTP(S) links.
10. If an accepted author Tweet contains an X Article, keep XActions as the primary Tweet source and make one no-retry FxTwitter request for the Article body, rich-link metadata, and cover media. Validate Tweet ID and Article ID before accepting it.
11. FxTwitter failure does not discard the Tweet; Article status becomes partial and the note capture becomes `部分`.
12. FxTwitter Article media is accepted only from HTTPS `pbs.twimg.com` / `video.twimg.com`; other media is unsupported and never downloaded.
13. Download only author-owned Tweet media plus supported Article media.
14. Request `name=orig` for `pbs.twimg.com/media/` images.

Logged-out SSR still cannot prove that X exposed the complete conversation. A cleanly exhausted walker remains `待确认`, not automatically `完整`.

XActions 4.0.1 `TweetDetail/scrapeThread` is not part of the production path because its persisted query ID is stale for the current X frontend. Guest `UserTweetsAndReplies` is also not a fallback because X currently requires an authenticated session for that endpoint.

## Source-truth layer

Each case contains:

```text
<case-folder>/
├─ <note>.md
├─ source.json
└─ media/
```

`source.json` is source truth. Presentation changes, translation, folder renaming, author organization, and Agent writing must not rewrite it. Link entities and accepted X Article rich-text blocks are stored beside the unchanged source text; Markdown links are derived only at render time.

The only supported replacement is an explicit repair acquisition. Repair stages a fresh source package under Git-ignored `.runtime`, verifies the same Tweet ID and numeric author ID, blocks Tweet/link/Article/media regressions, locks the existing title, and keeps the formal case untouched through validation. Finalize re-checks the old formal source/Markdown hashes before replacement and preserves the previous snapshot under the repair `before/` directory.

Media paths inside `source.json` are relative to the case folder, so moving or renaming the whole case folder preserves them.

## Repair layer

Normal duplicate handling stays read-only: before returning `existing_case_found`, `prepare` verifies the finalized case has exactly one readable non-empty Markdown file. Broken or ambiguous finalized state returns `action_required` without network access.

Explicit repair flow:

```text
repair "<existing X URL>"
  -> .runtime/<tweet-id>/repairs/<timestamp>/case/      [fresh staged acquisition]
  -> identity + non-regression comparison
  -> Agent updates runtime analysis.json
  -> validate -> preview.md                            [formal case still unchanged]
  -> finalize
  -> hash-check old formal source + Markdown
  -> copy staged media / replace source + Markdown
  -> verify final rendering
  -> Obsidian Junction sees the updated formal case
```

A failed or blocked repair is not retried automatically. If finalize fails after replacement begins, old source/Markdown/overwritten media are restored and media created only by that failed repair are removed. Existing formal data remains authoritative until a repair reaches `note_ready`.

## Naming layer

The collector initially knows the Tweet ID but not the final editorial title, so collection uses a numeric staging directory.

After the Markdown title is decided:

```text
npm run finalize -- <tweet-id>
```

renames both the case folder and Markdown file to the sanitized Frontmatter title.

Title collisions append ` · <tweet-id>` only when necessary.

## Author identity layer

Two author identifiers are intentionally separated:

- `rootTweet.author.username`: human-readable folder key.
- `rootTweet.author.id`: stable X identity key.

Organized layout:

```text
notes/x/作者/<author.username>/<note-title>/
```

If a username changes in the future, numeric `author.id` is the authority for deciding whether it is the same author.

## Presentation layer

Authoritative presentation rules live in:

```text
docs/NOTE-SPEC.md
```

Current key dependencies:

- Obsidian snippets: `learning-lab.css`, `x-case-note.css`.
- Media Viewer 2.2.1.
- `media/` directories hidden from Obsidian File Explorer only; files remain present and usable.

## Safety

Guest-only is default.

Account Session is fallback-only and requires explicit authorization. Account fallback is capped at 2 real attempts.

Ordinary-user comments are never persisted as case content.

## Deferred layer

Richer Bilibili-style summarization, taxonomy, navigation, and author dashboards remain future work. Do not add a complex taxonomy before enough real cases exist.
