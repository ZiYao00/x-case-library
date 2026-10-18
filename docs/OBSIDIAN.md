# Obsidian Integration

Thread updates and historical merges follow NOTE-SPEC 2.5. The canonical note keeps its title; optional frontmatter aliases preserve retired basenames for Obsidian lookup. Explicit path-qualified backlinks must be reviewed before retirement. Old Markdown and its data package are moved to the project's Git-ignored `.archive/x-cases/`, outside the notes/x Junction and Vault, only after the canonical publication verifies. Filesystem/Junction hash checks do not prove UI refresh or media playback.

## Purpose

This file documents Obsidian-specific integration only.

The **authoritative content conversion and layout rules** are in:

```text
docs/NOTE-SPEC.md
```

Do not duplicate or override NOTE-SPEC here.

## Paths

Project notes:

```text
notes\x
```

Vault:

```text
G:\ZiYao\Note
```

Vault entry:

```text
G:\ZiYao\Note\X案例库
```

The Vault entry is a Windows Junction pointing to this repository's `notes\x`.

Machine-specific path settings live in `config/local.json`; the example is `config/local.json.example`.

## Shared CSS

The canonical CSS source is the repository named in `config/obsidian-style.json`. Do **not** assume it is located beside this project or that its local folder has any particular name. Onboarding reads required CSS names and the provider URL from the consumer contract. CSS is installed into the user's Vault using the shared provider's sync script.

Required:

- Core: `snippets/learning-lab.css`
- Extension: `snippets/x-case-note.css` v0.7
- Frontmatter classes: `learning-page + x-case-note`

Do not copy or fork these CSS files into `x-case-library`.

Vault snippet destination:

```text
G:\ZiYao\Note\.obsidian\snippets\
```

Sync with the canonical repository's sync script when CSS changes.

## Media Viewer

Default X-case media renderer:

- Plugin: Media Viewer
- Plugin ID: `mediaviewer`
- Validated version: `2.2.1`

Local MP4 fullscreen modal playback has been verified on a real X case.

NOTE-SPEC defines the required Gallery syntax.

## Hidden implementation files

Storage Layout V2 keeps implementation data in a stable hidden package, separate from the Markdown reading layer:

```text
X案例库/_case-data/<tweet-id>/
├─ source.json
├─ media/
└─ documents/   # 可选
```

`source.json` remains the factual source of truth, `media/` remains the local media store, and optional `documents/` stores deterministically materialized embedded Markdown documents. `x-case-note.css` hides the whole `X案例库/_case-data` root from Obsidian File Explorer; legacy V1 selectors for per-case `media/` and `source.json` remain during migration compatibility.

This is presentation-only:

- `source.json` stays on disk and remains available to duplicate checks, validation and repair;
- `media/` stays on disk;
- optional `documents/` stays on disk and remains indexed by Obsidian even though the parent data root is visually hidden;
- Gallery keeps working;
- images keep working;
- MP4 popup playback keeps working;
- generated document WikiLinks open the local document directly; no extra button CSS is required;
- Windows Explorer still sees `source.json`, `media/` and optional `documents/`.

To debug these implementation files visually in Obsidian, temporarily disable the `x-case-note` snippet.

## Directory names visible in Obsidian

Formal pending reading-layer notes use:

```text
X案例库/00-待整理/<note-title>.md
```

The numeric Tweet-ID folder is staging only and should normally disappear immediately after note generation via:

```powershell
npm run finalize -- <tweet-id>
```

Organized reading-layer notes use:

```text
X案例库/作者/<author.username>/<note-title>.md
```

The corresponding source/media/documents package stays at `X案例库/_case-data/<tweet-id>/`, so author organization no longer adds a visible per-note folder level.

## Media basename rule

Media Viewer 2.2.1 resolves Gallery media effectively by Vault link resolution. Current generated media filenames include Tweet IDs and have been verified unique across the current X-case Vault.

Before accepting a generated note, verify Gallery basenames resolve uniquely.

## Current content behavior

See `docs/NOTE-SPEC.md` for full rules.

Current V4.2 summary:

- small Media Viewer thumbnails;
- image/video click -> popup;
- messenger-style author thread;
- non-Chinese ordinary author prose -> original + Chinese translation;
- Prompt remains original language;
- Prompt max visible height 320px with internal scroll;
- Prompt native copy button copies full content;
- no standalone Prompt section;
- no acquisition technical clutter in the body.
- verified Prompt types display 图片生成 Prompt / 视频生成 Prompt outside the code block, without model names in labels; copy still returns the original text;
- Gallery includes verified one-level related media, with concise source notes distinguishing reference assets from model comparisons.

## Media Extended

Media Extended remains installed but disabled.

It is not part of the X-case rendering contract.
