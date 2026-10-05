# Architecture

## Current scope

The project deliberately separates collection, source truth, presentation, and future summarization.

```text
X URL
  -> Guest-only collector
  -> source.json + media
  -> case Markdown
  -> notes/x/00-待整理
  -> Obsidian Junction
```

## Collection layer

Pinned dependency: `xactions@4.0.1`.

Current production path:

1. `TweetResultByRestId` gets the root post.
2. Prefer NoteTweet text over `legacy.full_text` when present.
3. Fetch the logged-out X page HTML.
4. Inspect SSR conversation entries and keep only entries whose actual author equals the root author.
5. Fetch those author-reply IDs exactly with `TweetResultByRestId`.
6. Re-validate the returned author.
7. Download only author-owned media.
8. Request `name=orig` for `pbs.twimg.com/media/` images.

XActions 4.0.1 `TweetDetail/scrapeThread` is currently not part of the production path because its persisted query ID is stale and its query-ID discovery logic targets an older X frontend bundle structure.

## Data contract

Each case directory is expected to contain:

```text
<tweet-id>/
├─ <readable-title>.md
├─ source.json
└─ media/
```

`source.json` is source truth. Future LLM summarization must not rewrite or replace it.

## Safety

Guest-only is the default. Account Session is fallback-only and requires explicit authorization. The account fallback is capped at 2 real attempts.

## Deferred layer

Bilibili-style knowledge summarization, taxonomy, organizer, and navigation are deferred until enough X cases exist to justify stable rules.
