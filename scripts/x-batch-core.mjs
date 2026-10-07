import fs from 'node:fs/promises';
import path from 'node:path';
import {
  projectRoot,
  parseMessage,
  findCases,
  finalizedCaseProblems,
  onboarding,
  prepare,
  json,
  exists,
  inside,
} from './x-case-core.mjs';
import { resolveFinalizedCase } from './case-layout.mjs';

export const BATCH_SCHEMA_VERSION = 1;
export const DEFAULT_PILOT_WAVE_SIZE = 3;
export const MAX_WAVE_SIZE = 5;
export const MIN_COOLDOWN_MS = 30_000;

function iso(now = Date.now()) {
  return new Date(now).toISOString();
}

function truthyEnv(value) {
  if (value == null) return false;
  return !['', '0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

export function assertBatchGuestOnly(env = process.env) {
  if (truthyEnv(env.XACTIONS_ALLOW_ACCOUNT_SESSION)) {
    const error = new Error('Batch mode is permanently Guest-only. Unset XACTIONS_ALLOW_ACCOUNT_SESSION before any batch operation.');
    error.code = 'BATCH_ACCOUNT_SESSION_FORBIDDEN';
    throw error;
  }
  return true;
}

function validWaveSize(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_WAVE_SIZE) {
    throw new Error('Wave size must be an integer from 1 to ' + MAX_WAVE_SIZE + '.');
  }
  return number;
}

function sanitizeBatchId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error('Invalid batch id.');
  return id;
}

function defaultBatchId(now = Date.now()) {
  return 'batch-' + iso(now).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function extractHttpUrls(text) {
  return [...String(text).matchAll(/https?:\/\/[^\s<>"'`]+/gi)]
    .map((match) => match[0].replace(/[)\]}>。，；！？、]+$/u, ''));
}

export function parseBatchInput(text) {
  const seen = new Set();
  const posts = [];
  const ignored = [];
  const duplicates = [];

  for (const value of extractHttpUrls(text)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      ignored.push({ url: value, reason: 'invalid_url' });
      continue;
    }

    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname.toLowerCase())) {
      ignored.push({ url: value, reason: 'non_x_url' });
      continue;
    }

    let post;
    try {
      post = parseMessage(value);
    } catch {
      ignored.push({ url: value, reason: 'not_x_status_url' });
      continue;
    }

    if (seen.has(post.tweetId)) {
      duplicates.push({ url: value, tweetId: post.tweetId });
      continue;
    }
    seen.add(post.tweetId);
    posts.push(post);
  }

  return { posts, ignored, duplicates };
}

function collectStructuredCaseLinks(tweet, targets) {
  if (!tweet) return;
  for (const link of tweet.linkEntities || []) {
    if (link?.type === 'url' && typeof link.target === 'string') targets.push(link.target);
  }
  if (Array.isArray(tweet.article?.blocks)) {
    for (const block of tweet.article.blocks) {
      for (const link of block.links || []) {
        if (link?.type === 'url' && typeof link.target === 'string') targets.push(link.target);
      }
    }
  }
}

export function extractCaseStatusLinks(source) {
  const sourceTweetId = String(source?.rootTweet?.id || source?.tweetId || '');
  if (!/^\d+$/.test(sourceTweetId)) throw new Error('Source case is missing a numeric Tweet ID.');

  const targets = [];
  collectStructuredCaseLinks(source.rootTweet, targets);
  for (const reply of source.authorReplies || []) collectStructuredCaseLinks(reply, targets);

  const parsed = parseBatchInput(targets.join('\n'));
  const selfReferences = [];
  parsed.posts = parsed.posts.filter((post) => {
    if (post.tweetId !== sourceTweetId) return true;
    selfReferences.push({ url: post.sourceUrl, tweetId: post.tweetId });
    return false;
  });

  return {
    sourceTweetId,
    structuredUrlCount: targets.length,
    posts: parsed.posts,
    ignored: parsed.ignored,
    duplicates: parsed.duplicates,
    selfReferences,
  };
}

async function inspectLocalCase(post, root) {
  const matches = await findCases(root, post.tweetId);
  const finalized = matches.filter((item) => item.finalized);

  if (finalized.length) {
    const problems = await finalizedCaseProblems(finalized);
    if (matches.length !== finalized.length) {
      problems.push('Finalized and unfinished cases coexist for the same Tweet ID; inspect local state before batching.');
    }
    if (problems.length) {
      return { status: 'action_required', cases: matches, actions: problems };
    }
    return { status: 'existing', cases: finalized };
  }

  if (matches.length > 1) {
    return { status: 'action_required', cases: matches, actions: ['Multiple unfinished cases exist for this Tweet ID.'] };
  }
  if (matches.length === 1) {
    return { status: 'action_required', cases: matches, actions: ['An unfinished staging case already exists; inspect it before batching.'] };
  }

  const jobPath = path.join(root, '.runtime', post.tweetId, 'job.json');
  if (await exists(jobPath)) {
    return { status: 'action_required', actions: ['A prior runtime job exists without a finalized case; inspect it before batching.'], jobPath };
  }

  return { status: 'pending' };
}

async function loadFinalizedSourceCase(tweetId, root) {
  const id = String(tweetId || '').trim();
  if (!/^\d+$/.test(id)) return { status: 'action_required', actions: ['Provide a numeric source-case Tweet ID.'] };

  const matches = await findCases(root, id);
  const finalized = matches.filter((item) => item.finalized);
  const problems = finalized.length ? await finalizedCaseProblems(finalized) : [];
  if (matches.length !== finalized.length) problems.push('Finalized and unfinished source-case states coexist; inspect local state before expanding the collection.');
  if (finalized.length !== 1) problems.push('Source case must resolve to exactly one finalized case before collection expansion.');
  if (problems.length) return { status: 'action_required', actions: [...new Set(problems)] };

  const source = await json(finalized[0].sourcePath);
  const sourceId = String(source?.rootTweet?.id || source?.tweetId || '');
  if (sourceId !== id) return { status: 'action_required', actions: ['Source case Tweet ID does not match its data package.'] };
  return { status: 'ready', source, caseRecord: finalized[0] };
}

export async function previewBatchFromCase(tweetId, options = {}) {
  const root = path.resolve(options.root || projectRoot);
  assertBatchGuestOnly(options.env || process.env);
  const loaded = await loadFinalizedSourceCase(tweetId, root);
  if (loaded.status !== 'ready') return loaded;

  const extracted = extractCaseStatusLinks(loaded.source);
  if (!extracted.posts.length) {
    return {
      status: 'action_required',
      origin: { type: 'case', tweetId: extracted.sourceTweetId },
      actions: ['No direct X/Twitter status links were found in the source case.'],
      discoveredStatusCount: 0,
      ignored: extracted.ignored,
      duplicates: extracted.duplicates,
      selfReferences: extracted.selfReferences,
    };
  }

  const items = [];
  for (let index = 0; index < extracted.posts.length; index += 1) {
    const post = extracted.posts[index];
    const local = await inspectLocalCase(post, root);
    items.push({
      index,
      tweetId: post.tweetId,
      url: post.sourceUrl,
      status: local.status,
      actions: local.actions || [],
      notePath: local.cases?.[0]?.markdown?.[0] || null,
    });
  }
  const counts = countStatuses(items);
  const hasActionRequired = items.some((item) => item.status === 'action_required');
  return {
    status: hasActionRequired ? 'action_required' : 'preview',
    origin: { type: 'case', tweetId: extracted.sourceTweetId },
    discoveredStatusCount: extracted.posts.length,
    structuredUrlCount: extracted.structuredUrlCount,
    counts,
    items,
    ignored: extracted.ignored,
    duplicates: extracted.duplicates,
    selfReferences: extracted.selfReferences,
  };
}

export async function initBatchFromCase(tweetId, options = {}) {
  const root = path.resolve(options.root || projectRoot);
  assertBatchGuestOnly(options.env || process.env);
  const loaded = await loadFinalizedSourceCase(tweetId, root);
  if (loaded.status !== 'ready') return loaded;

  const extracted = extractCaseStatusLinks(loaded.source);
  if (!extracted.posts.length) {
    return {
      status: 'action_required',
      origin: { type: 'case', tweetId: extracted.sourceTweetId },
      actions: ['No direct X/Twitter status links were found in the source case.'],
    };
  }

  return initBatchFromText(extracted.posts.map((post) => post.sourceUrl).join('\n'), {
    ...options,
    root,
    origin: { type: 'case', tweetId: extracted.sourceTweetId },
  });
}

function batchRoot(root) {
  return path.join(root, '.runtime', 'batches');
}

function manifestPath(root, batchId) {
  return path.join(batchRoot(root), sanitizeBatchId(batchId), 'batch.json');
}

async function atomicSaveManifest(file, manifest) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  inside(batchRoot(manifest.projectRoot), dir);
  const tmp = file + '.tmp-' + process.pid;
  const body = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(tmp, body, { encoding: 'utf8', flag: 'w' });
  await fs.rename(tmp, file);
}

function countStatuses(items) {
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

function publicSummary(manifest) {
  return {
    status: manifest.status,
    batchId: manifest.batchId,
    manifestPath: manifest.manifestPath,
    policy: manifest.policy,
    wave: manifest.wave,
    counts: countStatuses(manifest.items),
    ignoredCount: manifest.input.ignored.length,
    duplicateCount: manifest.input.duplicates.length,
    origin: manifest.input.origin || null,
    stopReason: manifest.stopReason || null,
    stopUntil: manifest.stopUntil || null,
  };
}

export async function initBatchFromText(text, options = {}) {
  const root = path.resolve(options.root || projectRoot);
  assertBatchGuestOnly(options.env || process.env);

  const parsed = parseBatchInput(text);
  if (!parsed.posts.length) {
    return { status: 'action_required', actions: ['No valid X/Twitter status URLs were found.'], ignored: parsed.ignored };
  }

  const now = options.now ?? Date.now();
  const batchId = sanitizeBatchId(options.batchId || defaultBatchId(now));
  const file = manifestPath(root, batchId);
  if (await exists(file)) {
    return { status: 'action_required', actions: ['Batch id already exists; use status/resume instead of overwriting it.'], batchId, manifestPath: file };
  }

  const waveSize = validWaveSize(options.waveSize ?? DEFAULT_PILOT_WAVE_SIZE);
  const items = [];
  for (let index = 0; index < parsed.posts.length; index += 1) {
    const post = parsed.posts[index];
    const local = await inspectLocalCase(post, root);
    items.push({
      index,
      tweetId: post.tweetId,
      url: post.sourceUrl,
      status: local.status,
      actions: local.actions || [],
      notePath: local.cases?.[0]?.markdown?.[0] || null,
      capture: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });
  }

  const hasActionRequired = items.some((item) => item.status === 'action_required');
  const manifest = {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchId,
    projectRoot: root,
    manifestPath: file,
    createdAt: iso(now),
    updatedAt: iso(now),
    status: hasActionRequired ? 'action_required' : 'ready',
    stopReason: hasActionRequired ? 'local_preflight' : null,
    stopUntil: null,
    input: {
      totalUrls: parsed.posts.length + parsed.ignored.length + parsed.duplicates.length,
      xStatusCount: parsed.posts.length,
      ignored: parsed.ignored,
      duplicates: parsed.duplicates,
      ...(options.origin ? { origin: options.origin } : {}),
    },
    policy: {
      guestOnly: true,
      accountSessionAttempts: 0,
      concurrency: 1,
      retryPolicy: 'none',
      minCooldownMs: Number(options.minCooldownMs ?? MIN_COOLDOWN_MS),
      maxWaveSize: MAX_WAVE_SIZE,
    },
    wave: {
      limit: waveSize,
      started: 0,
      completed: 0,
      number: 1,
    },
    lastCaseCompletedAt: null,
    items,
  };

  await atomicSaveManifest(file, manifest);
  return { ...publicSummary(manifest), items: manifest.items, ignored: parsed.ignored, duplicates: parsed.duplicates };
}

export async function loadBatch(batchId, root = projectRoot) {
  const resolvedRoot = path.resolve(root);
  const file = manifestPath(resolvedRoot, batchId);
  const manifest = await json(file);
  if (manifest.schemaVersion !== BATCH_SCHEMA_VERSION) throw new Error('Unsupported batch manifest schema.');
  if (path.resolve(manifest.projectRoot) !== resolvedRoot) throw new Error('Batch manifest project root mismatch.');
  manifest.manifestPath = file;
  return manifest;
}

function normalizeResetAt(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number > 1e12 ? number : number * 1000;
}

export async function classifyBatchFailure(failurePath) {
  if (!failurePath || !await exists(failurePath)) {
    return { kind: 'platform', reason: 'missing_failure_evidence', stopUntil: null };
  }

  const failure = await json(failurePath);
  const statuses = (failure.apiResponses || []).map((item) => Number(item.status)).filter(Number.isFinite);
  const message = String(failure.error?.message || '').toLowerCase();

  const resetTimes = (failure.apiResponses || []).map((item) => normalizeResetAt(item.resetAt)).filter(Boolean);
  const stopUntil = resetTimes.length ? new Date(Math.max(...resetTimes)).toISOString() : null;

  if (statuses.some((status) => [401, 403, 429].includes(status))) {
    return { kind: 'platform', reason: 'http_' + statuses.find((status) => [401, 403, 429].includes(status)), stopUntil, failure };
  }

  if (/rate.?limit|too many requests|guest.*token|token.*guest|authorization|forbidden|fetch failed|timeout|timed out|econn|enotfound|eai_again|network/.test(message)) {
    return { kind: 'platform', reason: 'guest_or_network_failure', stopUntil, failure };
  }

  if (/404|not found|no tweet result|deleted|protected|private|does not exist|suspended/.test(message)) {
    return { kind: 'content', reason: 'content_unavailable', stopUntil: null, failure };
  }

  return { kind: 'platform', reason: 'unknown_transport_failure', stopUntil, failure };
}

function markCompletedIfDone(manifest, now) {
  const active = manifest.items.some((item) => ['pending', 'processing'].includes(item.status));
  if (!active && !manifest.items.some((item) => item.status === 'action_required')) {
    manifest.status = 'completed';
    manifest.stopReason = null;
    manifest.stopUntil = null;
    manifest.completedAt = iso(now);
  }
}

export async function nextBatchItem(batchId, options = {}) {
  const root = path.resolve(options.root || projectRoot);
  assertBatchGuestOnly(options.env || process.env);
  const manifest = await loadBatch(batchId, root);
  const now = options.now ?? Date.now();

  if (manifest.status === 'action_required') return { ...publicSummary(manifest), actions: ['Resolve batch action_required items before any network request.'] };
  if (manifest.status === 'completed') return publicSummary(manifest);
  if (manifest.status === 'paused') return { ...publicSummary(manifest), actions: ['Batch is paused. Inspect stopReason before continuing.'] };
  if (manifest.items.some((item) => item.status === 'processing')) {
    return { status: 'action_required', batchId, actions: ['A batch item is already processing; concurrency is fixed at 1.'] };
  }

  if (manifest.wave.started >= manifest.wave.limit) {
    manifest.status = 'paused';
    manifest.stopReason = 'wave_limit';
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return { ...publicSummary(manifest), status: 'wave_complete' };
  }

  if (manifest.lastCaseCompletedAt) {
    const elapsed = now - Date.parse(manifest.lastCaseCompletedAt);
    const remaining = manifest.policy.minCooldownMs - elapsed;
    if (remaining > 0) {
      return { status: 'cooldown', batchId, retryAfterMs: remaining, eligibleAt: iso(now + remaining), counts: countStatuses(manifest.items) };
    }
  }

  const item = manifest.items.find((candidate) => candidate.status === 'pending');
  if (!item) {
    markCompletedIfDone(manifest, now);
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return publicSummary(manifest);
  }

  const onboardingFn = options.onboardingFn || onboarding;
  const environment = await onboardingFn(root);
  if (environment.status !== 'ready') {
    return { ...environment, batchId, counts: countStatuses(manifest.items), networkStarted: false };
  }

  item.status = 'processing';
  item.startedAt = iso(now);
  item.error = null;
  manifest.status = 'running';
  manifest.wave.started += 1;
  manifest.updatedAt = iso(now);
  await atomicSaveManifest(manifest.manifestPath, manifest);

  const prepareFn = options.prepareFn || ((url) => prepare(url, root));
  let result;
  try {
    result = await prepareFn(item.url);
  } catch (error) {
    item.status = 'failed';
    item.error = { message: error.message, kind: 'platform', reason: 'prepare_exception' };
    item.completedAt = iso(now);
    manifest.wave.completed += 1;
    manifest.lastCaseCompletedAt = iso(now);
    manifest.status = 'paused';
    manifest.stopReason = 'circuit_breaker';
    manifest.stopUntil = null;
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return { ...publicSummary(manifest), item, prepareResult: { status: 'failed', message: error.message } };
  }

  if (result.status === 'materials_ready') {
    item.prepareResult = {
      status: result.status,
      jobDir: result.jobDir,
      jobPath: result.jobPath,
      sourcePath: result.sourcePath,
      analysisPath: result.analysisPath,
      handoffPath: result.handoffPath,
      authorRepliesStatus: result.authorRepliesStatus,
      partialMedia: result.partialMedia,
    };
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return { ...publicSummary(manifest), item, prepareResult: result };
  }

  if (result.status === 'existing_case_found') {
    item.status = 'existing';
    item.notePath = result.cases?.[0]?.markdown?.[0] || null;
    item.completedAt = iso(now);
    manifest.wave.started = Math.max(0, manifest.wave.started - 1);
    markCompletedIfDone(manifest, now);
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return { ...publicSummary(manifest), item, prepareResult: result };
  }

  if (result.status === 'action_required') {
    item.status = 'action_required';
    item.actions = result.actions || [];
    item.completedAt = iso(now);
    manifest.wave.completed += 1;
    manifest.status = 'action_required';
    manifest.stopReason = 'case_action_required';
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return { ...publicSummary(manifest), item, prepareResult: result };
  }

  if (result.status === 'failed') {
    const classification = await classifyBatchFailure(result.failurePath);
    item.status = 'failed';
    item.error = {
      message: result.message || classification.failure?.error?.message || 'Collection failed.',
      kind: classification.kind,
      reason: classification.reason,
    };
    item.completedAt = iso(now);
    manifest.wave.completed += 1;
    manifest.lastCaseCompletedAt = iso(now);

    if (classification.kind === 'platform') {
      manifest.status = 'paused';
      manifest.stopReason = 'circuit_breaker';
      manifest.stopUntil = classification.stopUntil;
    } else {
      manifest.status = 'running';
    }
    manifest.updatedAt = iso(now);
    await atomicSaveManifest(manifest.manifestPath, manifest);
    return { ...publicSummary(manifest), item, prepareResult: result, classification };
  }

  item.status = 'action_required';
  item.error = { message: 'Unexpected prepare status: ' + result.status };
  item.completedAt = iso(now);
  manifest.wave.completed += 1;
  manifest.status = 'action_required';
  manifest.stopReason = 'unexpected_prepare_status';
  manifest.updatedAt = iso(now);
  await atomicSaveManifest(manifest.manifestPath, manifest);
  return { ...publicSummary(manifest), item, prepareResult: result };
}

function readCapture(markdown) {
  const match = String(markdown).match(/^capture:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

export async function recordBatchItem(batchId, tweetId, options = {}) {
  const root = path.resolve(options.root || projectRoot);
  assertBatchGuestOnly(options.env || process.env);
  const manifest = await loadBatch(batchId, root);
  const now = options.now ?? Date.now();
  const item = manifest.items.find((candidate) => candidate.tweetId === String(tweetId));
  if (!item) return { status: 'action_required', batchId, actions: ['Tweet ID is not part of this batch.'] };
  if (item.status === 'note_ready') return { ...publicSummary(manifest), item, alreadyRecorded: true };
  if (item.status !== 'processing') return { status: 'action_required', batchId, actions: ['Only the current processing item can be recorded as complete.'] };

  const jobPath = path.join(root, '.runtime', item.tweetId, 'job.json');
  if (!await exists(jobPath)) return { status: 'action_required', batchId, actions: ['Case job.json is missing; do not guess completion.'] };
  const job = await json(jobPath);
  if (job.status !== 'note_ready') {
    return { status: 'action_required', batchId, actions: ['Case is not note_ready yet. Complete analysis, validate and finalize first.'], jobStatus: job.status };
  }
  let notePath = job.notePath;
  if (!notePath || !await exists(notePath)) {
    const resolved = await resolveFinalizedCase(root, item.tweetId);
    notePath = resolved?.notePath || null;
  }
  if (!notePath || !await exists(notePath)) {
    return { status: 'action_required', batchId, actions: ['Completed case note cannot be resolved by Tweet ID. Inspect local case layout before recording.'], jobStatus: job.status };
  }

  const markdown = await fs.readFile(notePath, 'utf8');
  item.status = 'note_ready';
  item.notePath = notePath;
  item.capture = readCapture(markdown);
  item.completedAt = iso(now);
  manifest.wave.completed += 1;
  manifest.lastCaseCompletedAt = iso(now);
  manifest.updatedAt = iso(now);
  markCompletedIfDone(manifest, now);
  await atomicSaveManifest(manifest.manifestPath, manifest);
  return { ...publicSummary(manifest), item };
}

export async function resumeBatch(batchId, options = {}) {
  const root = path.resolve(options.root || projectRoot);
  assertBatchGuestOnly(options.env || process.env);
  const manifest = await loadBatch(batchId, root);
  const now = options.now ?? Date.now();

  if (manifest.items.some((item) => item.status === 'processing')) {
    return { status: 'action_required', batchId, actions: ['Cannot resume while an item is processing.'] };
  }
  if (manifest.status !== 'paused' || manifest.stopReason !== 'wave_limit') {
    return { status: 'action_required', batchId, actions: ['Only a normal wave_limit pause can be resumed automatically. Circuit-breaker stops require manual inspection.'] };
  }

  manifest.wave = {
    limit: validWaveSize(options.waveSize ?? MAX_WAVE_SIZE),
    started: 0,
    completed: 0,
    number: Number(manifest.wave.number || 1) + 1,
  };
  manifest.status = 'ready';
  manifest.stopReason = null;
  manifest.stopUntil = null;
  manifest.updatedAt = iso(now);
  await atomicSaveManifest(manifest.manifestPath, manifest);
  return publicSummary(manifest);
}

export async function batchStatus(batchId, root = projectRoot) {
  const manifest = await loadBatch(batchId, root);
  const items = [];
  for (const item of manifest.items) {
    let notePath = item.notePath;
    if (['existing', 'note_ready'].includes(item.status) && (!notePath || !await exists(notePath))) {
      const resolved = await resolveFinalizedCase(root, item.tweetId);
      notePath = resolved?.notePath || notePath;
    }
    items.push({ ...item, notePath });
  }
  return { ...publicSummary(manifest), items, ignored: manifest.input.ignored, duplicates: manifest.input.duplicates };
}
