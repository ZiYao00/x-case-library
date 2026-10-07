# EvoLink case acceptance — 2026-10-07

## Scope and result

Implemented the user-approved NOTE-SPEC 2.6 workflow and adopted the accepted reading layer through the unified CLI. Renderer labels are exactly **视频生成 Prompt** and **图片生成 Prompt**, outside the raw Prompt fences. No dependency installation or Git commit/push was performed.

Canonical case `2107436379575840895` now contains author content from the root, video Prompt reply `2107436382927171836`, and image Prompt reply `2107667147019194394`. The image reply reaches the root through verified foreign-author node `2107589447038451898`; only its ID, author ID and parent metadata are retained, not comment text or media.

Related post `2107658128560934970` is a separately owned, same-author quote of the canonical root. Its Nano Banana 2.1 comparison image renders in the same Gallery with an explicit source note. It is not the GPT Image 2.5 reference image used by the video, and does not become a primary case member. The image Prompt reply itself has no independent media; the main video includes the original character board in its lower half.

## Verification

`node --test tests/test-x-case-workflow.mjs tests/test-link-preservation.mjs tests/test-x-batch-workflow.mjs tests/test-thread-workflow.mjs`: **70/70 pass**. Coverage includes foreign bridges, one-level related ownership, Prompt text/type preservation, lost quote rejection, hash-pinned adoption/retirement and refusal of personally edited repair baselines before network access.

Controlled real supplement collection used four exact requests, zero SSR pages, no retry and no account session. It reused the existing video and downloaded one related photo. The original collected source is retained separately from the adoption candidate. This initial supplement inherited the earlier snapshot's generic SSR discovery wording; its zero pages and baseSnapshot record show that SSR was not repeated. Future supplement provenance now explicitly identifies preserved snapshots and verified candidates.

An isolated refresh used the actual collector and repair/validate/finalize chain: four exact requests and three logged-out SSR pages. It retained two author replies, one related post, both Prompt types and exactly two media files with stable names. Final status was `note_ready`. Six production files were hash-checked and remained unchanged during this isolated test. The fixture uses test-only Vault metadata; it does not prove Obsidian live UI playback.

Read-only prepare for the root and both Prompt reply URLs returned the same canonical case, each with `networkUsed=false`. The current formal Markdown is exactly reproducible from formal source plus runtime analysis. Final read-back checks matched the project's note bytes to the Obsidian Junction copy and confirmed both media hashes, Prompt labels and retired-job delegation. The installed Skill Junction still points to the project Skill; no reinstall was required.

## Assets and migration

- Video: `media/001_2107436379575840895_video_1.mp4`, SHA-256 `776449eb27bb0d54e4c9fbea6d7115caabd0139ba54fbde4510a501f32ce0a43`.
- Related image: `media/002_2107658128560934970_photo_1.jpg`, SHA-256 `d8ef255c91f438e8f62412df578e973f7f0f14d0744267a26a2d0c76f56b5189`.

Approved adoption operation: `.runtime/2107436379575840895/operations/ae2fff80-32df-4d7f-9c8c-a583672206a8/`. Before snapshots and asset baselines are preserved. The old image-Prompt package and its previously archived visible note were retired to `.archive/x-cases/ae2fff80-32df-4d7f-9c8c-a583672206a8/2107667147019194394/`, outside the Vault. Its runtime job delegates to the canonical case; title alias is preserved.

Detailed local evidence: `.runtime/evolink-v3-acceptance/approved-review.json`, `collected-source.json`, `refresh-result.json`, `test-refresh.mjs`, `final-check.mjs` and the isolated fixture. These files are Git-ignored evidence, not portable test prerequisites.

## Limits

Logged-out SSR cannot guarantee discovery of every hidden reply or related quote. Explicit known candidate URLs supplement discovery within the existing request budget, and relationship metadata is independently checked. No live Obsidian UI playback or fresh-session Agent discovery test was performed. Pre-existing uncommitted project changes were retained.
