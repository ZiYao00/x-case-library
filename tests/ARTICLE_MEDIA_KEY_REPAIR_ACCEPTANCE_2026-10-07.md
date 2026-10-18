# Article video and entity-key repair acceptance — 2026-10-07

## Root causes

The real `2100477301976891873` Article payload contains one ApiVideo with four MP4 variants plus HLS, two inline images, and a cover image. The previous normalizer only read original_img_url, counted the video as unsupported, and never handed its MP4 URL to the existing downloader.

FxTwitter's Article entityMap is an array of explicit key/value entries in non-key order. The previous lookup used the requested key as an array index. Video key 0 became a Markdown attachment, character Prompt key 2 became media, and the two saved Prompt payloads appeared in the wrong positions. The downloader itself already supports videoUrl and did not cause this omission.

## Changes

- Resolve explicit entity keys by key, with no positional fallback for missing keys and refusal of duplicates. Keep old unkeyed arrays and object maps compatible.
- Normalize ApiVideo to video/videoUrl using the highest-bitrate HTTPS MP4 on the existing X CDN whitelist. Reject HLS-only/unsafe variants; never substitute a thumbnail for an unavailable video.
- Verify existing Article attachment payloads one-to-one by exact rawMarkdown during repair. Preserve unchanged payloads and filenames across corrected keys; reject removed/rewritten payloads or duplicate substitution. Empty whitespace-only link metadata from the old erroneous mapping does not block correction; real links remain protected.

## Verification

Five focused regression tests fail before the fix and pass afterward. Full command:

`node --test tests/test-x-case-workflow.mjs tests/test-link-preservation.mjs tests/test-x-batch-workflow.mjs tests/test-thread-workflow.mjs`

Result: **75/75 pass**. Tests cover shuffled/missing/duplicate keys, legacy maps, variant order, CDN/HTTPS/credential exclusions, thumbnail substitution and attachment/content/link regression protection. Saved real payload also normalizes to four media records, correct character/scene attachment order and zero unsupported counts, with no network during that check.

One explicit repair used one exact Tweet request, one logged-out SSR page and one FxTwitter Article request; no account session or retry. Prepare/validate left the formal note intact. Unified finalize published the corrected source and note, with before snapshots under `.runtime/2100477301976891873/repairs/2026-10-07T07-56-46-197Z/`.

Final case contains **one video, three photos, and two Prompt attachments**. The new MP4 is 10,337,522 bytes; SHA-256 `8a61708b0a4d4ea581cda2452e9f2192269bda810e68ab1959a36bd0af9e175b`. Selected source URL identifies the 1920x1080 variant; local MP4 ftyp header and file hash match. Old image hashes, attachment paths/content and note title remain unchanged. Character and scene attachment links now appear in their matching sections. Project note and Obsidian Junction bytes match; duplicate input returns read-only without network.

Prior source SHA-256 `eb21c8be178407ea3170174317d8eac9996504f23c02cda8536760b7a1a49fd8` is retained in before/source.json. Runtime evidence: `article-media-evidence-1791359385052.json`, `article-bug-reproduction.json`, `verify-fixed-normalizer.mjs`, `verify-repaired-case.mjs` and `article-repair-result.json` under `.runtime/2100477301976891873/`.

## Limits and Git

Capture improves from 部分 to 待确认: anonymous pages still cannot certify all author replies. No Obsidian live playback or decoded video-resolution check was performed; filesystem/header checks do not substitute for those. NOTE-SPEC, architecture, handoff and README were updated. No dependency installation, Git commit or push was performed for this repair.
