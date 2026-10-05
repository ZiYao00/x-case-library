# Obsidian Integration

## Paths

Project:

this repository (`x-case-library`)

Local notes:

`notes\x`

Vault:

`G:\ZiYao\Note`

Vault entry:

`G:\ZiYao\Note\X案例库`

The Vault entry is a Windows Junction pointing to the project notes directory.

Machine-specific paths are declared in `config/local.json`. The example lives at `config/local.json.example`.

## Why Junction

The project remains the single filesystem source for case files while Obsidian consumes the same files without copying them into a second note store.

## Shared CSS

The project consumes the canonical sibling repository:

`..\obsidian-learning-snippets`

Current dependency:

- Core: `snippets/learning-lab.css`
- Extension: `snippets/x-case-note.css`
- Frontmatter: `learning-page + x-case-note`

Do not copy shared CSS into this repository.

CSS must be installed at:

`G:\ZiYao\Note\.obsidian\snippets\`

and enabled in Obsidian:

`Settings -> Appearance -> CSS snippets -> learning-lab + x-case-note`

## V4.1 note contract

Every formal X case Markdown must contain:

```yaml
cssclasses:
  - learning-page
  - x-case-note
```

The reading order is fixed:

```text
媒体
原文
  ├─ 主帖
  │   ├─ 中文翻译（原文非中文时）
  │   └─ Prompt（如有）
  └─ 回复 1..N
      ├─ 中文翻译（普通正文非中文时）
      └─ Prompt（如有）
一句话看懂
复刻要点
```

There is no standalone `## Prompt` section.

### Frontmatter

Keep only compact reading/index fields:

- `source`
- `author`
- `published`
- optional `model`
- `status`
- `capture`
- `cssclasses`
- `tags`

Do not expose Tweet IDs, reply IDs, Guest/SSR/API details, account-session flags, local media paths, dimensions, durations, or file sizes in the reading body.

`capture` stays coarse:

- `完整`
- `待确认`
- `部分`

Detailed acquisition evidence remains in `source.json`.

### 媒体

Media Viewer is the default X-case media renderer.

- Plugin: `Media Viewer`
- Plugin ID: `mediaviewer`
- Version validated: `2.2.1`
- Local MP4 fullscreen modal playback has been confirmed in the real `望远镜与飞来炸鸡` case.
- Use `size: small` and `addButton: false`.

Default Gallery syntax:

````markdown
```gallery
size: small
addButton: false

![[unique_video_name.mp4]]
![[unique_image_name.jpg]]
```
````

Gallery entries use unique media basenames. Current generated filenames include Tweet IDs, which keeps existing X-case assets unambiguous in the Vault.

Native embeds remain a fallback if Gallery path resolution becomes ambiguous or Media Viewer is unavailable.

### 原文

- Root post uses an `x-post` timeline message.
- Each root-author reply uses its own `x-reply` timeline message in chronological order.
- Visual style: main post solid dot, replies hollow dots, one subtle vertical timeline.
- Preserve original author prose exactly.
- If ordinary author prose is not Chinese, add a concise Chinese translation directly below it as a nested quote.
- Translation is derived reading-layer content only; never write it to `source.json`.
- Do not translate URLs, @handles, model names, or technical parameters.
- Do not duplicate a long Prompt as ordinary reply prose.

Example:

```markdown
> [!x-post] 主帖
>
> This AI video is absolutely masterpiece 🔥
>
> > 这支 AI 视频简直是杰作 🔥
```

### Prompt

Every reusable Prompt is attached directly to the message that supplied it:

````markdown
> [!x-reply] 回复 1
>
> ````prompt
> Create ...
> ````
````

Do not add labels such as `Prompt 1 · 回复 1`.

Do not translate Prompt content.

`x-case-note.css` renders each block with:

- a `PROMPT` title bar;
- Obsidian's native code-copy button restyled as a compact copy icon;
- full Prompt text preserved for copying;
- maximum visible Prompt body height of 320px;
- internal vertical scrolling for longer Prompts;
- fixed top title bar and copy control while the body scrolls.

Distinct prompts remain separate.

## Current local deployment

The Junction is active and the Vault exposes:

`X案例库\00-待整理\<tweet-id>\...`

`learning-lab.css` and `x-case-note.css` are expected active snippets.

Media Viewer 2.2.1 is installed and enabled. Video modal behavior has passed a real local MP4 test.

Media Extended remains installed but disabled and is not part of the X Case V4.1 contract.
