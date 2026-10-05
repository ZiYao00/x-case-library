# Obsidian Integration

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

Canonical CSS source is the sibling repository:

```text
..\obsidian-learning-snippets
```

Required:

- Core: `snippets/learning-lab.css`
- Extension: `snippets/x-case-note.css` v0.5
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

## Hidden media folders

Each case keeps a physical:

```text
media/
```

directory.

`x-case-note.css` hides only X-case `media` folders from Obsidian File Explorer using the Vault path pattern under `X案例库`.

This is presentation-only:

- files stay on disk;
- Gallery keeps working;
- images keep working;
- MP4 popup playback keeps working;
- Windows Explorer still sees the folder.

To debug media folders visually in Obsidian, temporarily disable the `x-case-note` snippet.

## Directory names visible in Obsidian

Formal pending cases use:

```text
X案例库/00-待整理/<note-title>/
```

The numeric Tweet-ID folder is staging only and should normally disappear immediately after note generation via:

```powershell
npm run finalize -- <tweet-id>
```

Future organized cases use:

```text
X案例库/作者/<author.username>/<note-title>/
```

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

## Media Extended

Media Extended remains installed but disabled.

It is not part of the X-case rendering contract.
