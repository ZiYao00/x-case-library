# Thread identity acceptance — 2026-10-07

Historical acceptance of NOTE-SPEC 2.5. The foreign-author boundary and separate character-sheet case described below were superseded by the user-approved NOTE-SPEC 2.6 implementation. Current EvoLink membership, related media and refresh evidence are recorded in [EVOLINK_CASE_ACCEPTANCE_2026-10-07.md](EVOLINK_CASE_ACCEPTANCE_2026-10-07.md); keep this earlier record as migration history.

## Scope

Implement NOTE-SPEC 2.5: captured-member lookup, bounded same-author ancestry, staged missing-reply supplementation, explicit standalone exceptions, authorized legacy merge/retirement, publication recovery, shared CLI lock, and minimum Batch caseId compatibility. No dependencies installed; no Git commit/push.

## Offline checks

`node --test tests/test-thread-workflow.mjs tests/test-x-case-workflow.mjs tests/test-link-preservation.mjs tests/test-x-batch-workflow.mjs`

64 tests pass, including 19 thread tests. Fixtures stay under Git-ignored project `.runtime/offline-tests/`, with no X requests. Covered limits, hidden parent chains, old/new identity receipts, overlapping legacy cases, conflicting staging, standalone precedence, personal edits, path backlinks, media collisions, modified assets, interrupted new/updated publication, command exclusion and Batch accounting. Existing `node tests/test-ssr-author-replies.mjs` also passes. Skill creator quick_validate passes.

## Real acquisition and discovered boundary

The installed Skill bridge made one Guest-only acquisition for `2107667147019194394`, using one exact Tweet request plus one logged-out SSR page; no retry, account Session or media download. Prompt matches the supplied text. The API reports direct parent Tweet `2107589447038451898`, numeric author `1635643077883752450` (`lordservice_`), while the supplied Tweet author is `2001569273681186823` (`EvoLinkAi`). Consequently normalization correctly stops at the different-author boundary. This reply cannot be automatically added to the video case under the approved same-author parent-chain rule.

Published it separately as `暖橙色连衣裙角色设定板：四视图与细节参考 Prompt.md`: one intact Prompt, no media. This is a separate case, not a leftover duplicate. This acceptance did not exercise real same-author supplementation; that path has offline collector fixtures.

## Authorized legacy migration

Local merge dry-run, merge, validate, preview review and finalize completed for canonical `2107436379575840895` and retired `2107436382927171836`. The latter is a verified same-author direct reply already captured in the former. Canonical note retains its original title and video Prompt, and adds the retired filename as an alias. No network requests during migration.

Retired Markdown and data package were moved to `.archive/x-cases/02c6f756-bcdd-44ba-87d0-74e7dcacbf82/2107436382927171836/`, outside the Vault Junction. Archived source SHA-256 `4ab288ee1aa80522daa84823690d58fff9606de60e5cd3c55556ac1f8f51db14` and archived note SHA-256 `b4cad87aa7a8091115034f031fe134e4ed054c72bb21275ee43253914a6f7ba0` match the original snapshots.

Original video remains 10,911,319 bytes with SHA-256 `776449eb27bb0d54e4c9fbea6d7115caabd0139ba54fbde4510a501f32ce0a43`. Project/Junction note hashes match for both active cases. All three supplied URLs subsequently return existing_case_found and networkUsed=false; video/root URLs resolve to the same canonical case, character-sheet URL resolves to its independent case. Both capture values remain 待确认.

## Limits

Obsidian live UI playback, aliases click resolution and automatic discovery in a newly started Agent session were not exercised. Junction and installed Skill target checks do not substitute for those UI/host checks. Runtime evidence is retained in `.runtime/thread-acceptance-before.json` and `.runtime/thread-acceptance-after.json`. No foreign-user comment body was fetched or saved.
