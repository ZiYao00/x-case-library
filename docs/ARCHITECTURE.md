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
3. Fetch the logged-out X page HTML.
4. Inspect SSR conversation entries and keep only entries whose actual author equals the root author.
5. Fetch those author-reply IDs exactly with `TweetResultByRestId`.
6. Re-validate returned author identity.
7. Download only author-owned media.
8. Request `name=orig` for `pbs.twimg.com/media/` images.

XActions 4.0.1 `TweetDetail/scrapeThread` is not part of the production path because its persisted query ID is stale for the current X frontend.

## Source-truth layer

Each case contains:

```text
<case-folder>/
├─ <note>.md
├─ source.json
└─ media/
```

`source.json` is immutable source truth.

Presentation changes, translation, folder renaming, and author organization must not rewrite it.

Media paths inside `source.json` are relative to the case folder, so moving or renaming the whole case folder preserves them.

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
