# Batch Operations

## Purpose

Batch mode is a bounded scheduler for multiple explicit X/Twitter status URLs. It does not introduce a second collector and does not turn the project into a crawler.

Canonical entry:

```text
scripts/run-x-batch.mjs
```

Single-case collection remains owned by:

```text
scripts/run-x-case.mjs
```

Batch only decides which explicit case may enter the existing single-case lifecycle next.

## Non-goals

Batch mode must not:

- scan profiles, search pages, bookmarks, timelines, likes, followers, or recommendations;
- discover additional root cases beyond the explicit input list;
- collect ordinary-user comments;
- run cases concurrently;
- automatically retry failed X requests;
- rotate Guest Tokens, proxies, IPs, user agents, or accounts to continue after a limit;
- read or use the user's X account cookies;
- call account-session fallback;
- automatically continue after a platform-level circuit breaker.

## Account safety: hard rule

Batch mode is permanently Guest-only.

```text
accountSessionAttempts = 0
```

Batch must never read or use:

- `~/.xactions/cookies.json`
- `auth_token`
- `ct0`
- account Session state

If `XACTIONS_ALLOW_ACCOUNT_SESSION` is enabled in the environment, every Batch command must stop before network work.

The single-case project may retain its separately gated, explicitly authorized account fallback for future manual use. Batch mode does not inherit that fallback.

## Input contract

Input may contain arbitrary text and URLs.

Batch keeps only explicit:

```text
https://x.com/<username>/status/<tweet-id>
https://twitter.com/<username>/status/<tweet-id>
```

Equivalent Tweet IDs are deduplicated.

Non-X URLs, including GitHub links, are recorded as ignored and never enter the queue.

Profiles, searches, home timelines, short links, and other non-status X URLs are ignored.

## Local preflight

`init` performs no X network collection and does not require the Obsidian UI environment to be ready. It only parses input and inspects local project state.

Immediately before `next` may mark a pending item `processing` or invoke the single-case `prepare`, Batch reruns the existing onboarding/environment check. If onboarding is not ready, `next` returns `action_required` with `networkStarted: false`; the item remains `pending` and the wave counter does not advance.

For every unique X status URL `init` checks local project state first:

- valid finalized case -> `existing`
- clean new case -> `pending`
- unfinished numeric staging -> `action_required`
- prior orphan runtime job -> `action_required`
- damaged or ambiguous finalized case -> `action_required`
- finalized + unfinished state coexist -> `action_required`

Any local `action_required` makes the batch stop before network work.

## Manifest

Each batch has one Git-ignored state file:

```text
.runtime/batches/<batch-id>/batch.json
```

The manifest records:

- explicit input items
- ignored and duplicate URLs
- item status
- current wave
- safety policy
- timestamps
- note path / capture after completion
- circuit-breaker reason

Supported item states:

```text
pending
existing
processing
note_ready
failed
action_required
```

Completed items are never prepared again when the manifest is reloaded.

## Serial lifecycle

Concurrency is permanently:

```text
1
```

A batch item follows the existing case workflow:

```text
batch next
-> prepare one case
-> Agent edits only runtime analysis.json
-> validate
-> review preview.md
-> finalize
-> batch record
-> cooldown
-> next case
```

A second case cannot start while any item is `processing`.

## Waves

The first real run is a Pilot:

```text
wave size = 3
```

Normal later waves may contain at most:

```text
5 cases
```

Reaching the wave limit pauses the batch with:

```text
stopReason = wave_limit
```

Only a normal `wave_limit` pause may be resumed automatically with a new bounded wave.

## Cooldown

After a case is recorded `note_ready` or ends in a content-level network failure, the next new case may not start for at least:

```text
30 seconds
```

Agent analysis/finalization time usually exceeds this naturally. If not, `next` returns `cooldown` without making a request.

Do not replace this with randomized sleep intended to mimic a person.

## Failure classification

### Content-level failure

Examples:

- Tweet deleted
- Tweet unavailable / not found
- private / protected source
- suspended source

The item may become `failed`. After cooldown, later explicit items in the same wave may continue.

### Platform-level failure

Examples:

- HTTP 429
- HTTP 401 / 403 indicating Guest/platform restriction
- Guest Token activation/auth failure
- rate-limit exhaustion
- network / DNS / connection / timeout failure
- unknown transport failure

Result:

```text
batch.status = paused
stopReason = circuit_breaker
```

No automatic retry.
No token rotation.
No account fallback.
No automatic `resume`.

A person/Agent must inspect the failure before any future network action.

## FxTwitter

FxTwitter remains an optional no-login supplement only for X Article content.

- one attempt per Article;
- no retry;
- no account fallback;
- Article media keeps the existing trusted X CDN allowlist.

A normal per-Article supplement failure may make that case partial.

Do not silently disable Article collection for later cases in the same batch.

## Commands

Initialize from a project-relative text file:

```powershell
node scripts/run-x-batch.mjs init .runtime\batch-input.txt --batch-id <id> --wave-size 3
```

Inspect:

```powershell
node scripts/run-x-batch.mjs status <id>
```

Prepare exactly one next item:

```powershell
node scripts/run-x-batch.mjs next <id>
```

Then complete the returned single case through the normal workflow:

```powershell
node scripts/run-x-case.mjs validate <tweet-id>
node scripts/run-x-case.mjs finalize <tweet-id>
node scripts/run-x-batch.mjs record <id> <tweet-id>
```

After a normal wave limit pause:

```powershell
node scripts/run-x-batch.mjs resume <id> --wave-size 5
```

Circuit-breaker pauses are intentionally not resumable by this command.

## Acceptance

Before Batch V1 is considered production-ready:

1. Batch offline tests pass.
2. Existing link/workflow regressions remain green.
3. A real Pilot uses exactly 3 pending explicit X URLs.
4. Pilot remains Guest-only with account attempts 0/0.
5. No automatic retry, token rotation, proxy rotation, or Session fallback occurs.
6. All three cases reach an explicit terminal state.
7. The batch stops after the Pilot instead of continuing the remaining queue.
