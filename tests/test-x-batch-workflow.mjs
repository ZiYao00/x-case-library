import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseBatchInput,
  extractCaseStatusLinks,
  previewBatchFromCase,
  initBatchFromCase,
  initBatchFromText,
  nextBatchItem as coreNextBatchItem,
  recordBatchItem,
  resumeBatch,
  batchStatus,
  assertBatchGuestOnly,
} from '../scripts/x-batch-core.mjs';

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'x-case-batch-'));
  await fs.mkdir(path.join(root, 'notes', 'x', '00-待整理'), { recursive: true });
  return root;
}

const ready = async () => ({ status: 'ready', warnings: [], networkChecked: false });
const batchNext = (batchId, options = {}) => coreNextBatchItem(batchId, { onboardingFn: ready, ...options });

async function addFormalCase(root, tweetId, title = 'Existing Case') {
  const dir = path.join(root, 'notes', 'x', '00-待整理', title);
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });
  await fs.writeFile(path.join(dir, 'source.json'), JSON.stringify({
    tweetId,
    rootTweet: { id: tweetId },
  }, null, 2));
  const note = path.join(dir, title + '.md');
  await fs.writeFile(note, '---\ntitle: "' + title + '"\ncapture: "待确认"\n---\n');
  return note;
}

async function completeStubCase(root, tweetId, noteTitle = 'Completed') {
  const caseDir = path.join(root, 'notes', 'x', '00-待整理', noteTitle + '-' + tweetId);
  await fs.mkdir(caseDir, { recursive: true });
  const notePath = path.join(caseDir, noteTitle + '.md');
  await fs.writeFile(notePath, '---\ntitle: "' + noteTitle + '"\ncapture: "待确认"\n---\n');
  const jobDir = path.join(root, '.runtime', tweetId);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, 'job.json'), JSON.stringify({
    status: 'note_ready',
    notePath,
  }, null, 2));
  return notePath;
}

test('batch input keeps X status URLs, ignores GitHub/non-status URLs and deduplicates Tweet IDs', () => {
  const parsed = parseBatchInput([
    'https://x.com/a/status/111',
    'https://twitter.com/a/status/111',
    'https://github.com/example/repo',
    'https://x.com/a',
    'https://x.com/b/status/222',
  ].join('\n'));

  assert.deepEqual(parsed.posts.map((item) => item.tweetId), ['111', '222']);
  assert.equal(parsed.duplicates.length, 1);
  assert.equal(parsed.ignored.filter((item) => item.reason === 'non_x_url').length, 1);
  assert.equal(parsed.ignored.filter((item) => item.reason === 'not_x_status_url').length, 1);
});

test('from-case extraction keeps only direct structured X status links and never recurses', () => {
  const source = {
    tweetId: '999',
    rootTweet: {
      id: '999',
      linkEntities: [
        { type: 'url', target: 'https://x.com/a/status/111' },
        { type: 'url', target: 'https://twitter.com/a/status/111' },
        { type: 'mention', target: 'https://x.com/a' },
        { type: 'url', target: 'https://github.com/example/repo' },
        { type: 'url', target: 'https://x.com/source/status/999' },
      ],
      article: {
        status: 'partial',
        blocks: [
          { links: [{ type: 'url', target: 'https://x.com/b/status/222' }, { type: 'mention', target: 'https://x.com/b' }] },
        ],
      },
    },
    authorReplies: [
      {
        id: '998',
        linkEntities: [{ type: 'url', target: 'https://x.com/c/status/333' }],
        article: { status: 'available', blocks: [{ links: [{ type: 'url', target: 'https://x.com/d/status/444' }] }] },
      },
    ],
  };

  const extracted = extractCaseStatusLinks(source);
  assert.deepEqual(extracted.posts.map((item) => item.tweetId), ['111', '222', '333', '444']);
  assert.equal(extracted.duplicates.length, 1);
  assert.equal(extracted.selfReferences.length, 1);
  assert.equal(extracted.ignored.filter((item) => item.reason === 'non_x_url').length, 1);
  assert.equal(extracted.posts.some((item) => item.tweetId === '999'), false);
});

test('from-case dry-run previews local states without creating a batch manifest', async () => {
  const root = await tempRoot();
  const sourceNote = await addFormalCase(root, '999', 'Collection Case');
  await addFormalCase(root, '111', 'Existing Child');
  const sourcePath = path.join(path.dirname(sourceNote), 'source.json');
  await fs.writeFile(sourcePath, JSON.stringify({
    tweetId: '999',
    rootTweet: {
      id: '999',
      linkEntities: [
        { type: 'url', target: 'https://x.com/a/status/111' },
        { type: 'url', target: 'https://x.com/b/status/222' },
        { type: 'mention', target: 'https://x.com/a' },
      ],
      article: null,
    },
    authorReplies: [],
  }, null, 2));

  const result = await previewBatchFromCase('999', { root, env: {} });
  assert.equal(result.status, 'preview');
  assert.deepEqual(result.origin, { type: 'case', tweetId: '999' });
  assert.equal(result.discoveredStatusCount, 2);
  assert.deepEqual(result.counts, { existing: 1, pending: 1 });
  await assert.rejects(fs.access(path.join(root, '.runtime', 'batches')));
});

test('from-case init reuses Batch V1 and records only stable source-case origin metadata', async () => {
  const root = await tempRoot();
  const sourceNote = await addFormalCase(root, '999', 'Collection Case');
  const sourcePath = path.join(path.dirname(sourceNote), 'source.json');
  await fs.writeFile(sourcePath, JSON.stringify({
    tweetId: '999',
    rootTweet: {
      id: '999',
      linkEntities: [
        { type: 'url', target: 'https://x.com/a/status/111' },
        { type: 'url', target: 'https://x.com/source/status/999' },
      ],
      article: null,
    },
    authorReplies: [],
  }, null, 2));

  const result = await initBatchFromCase('999', { root, env: {}, batchId: 'from-case', waveSize: 3, now: 7_000 });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.origin, { type: 'case', tweetId: '999' });
  assert.deepEqual(result.items.map((item) => item.tweetId), ['111']);

  const manifest = JSON.parse(await fs.readFile(path.join(root, '.runtime', 'batches', 'from-case', 'batch.json'), 'utf8'));
  assert.deepEqual(manifest.input.origin, { type: 'case', tweetId: '999' });
  assert.equal(JSON.stringify(manifest).includes('Collection Case'), false);
});

test('batch init performs local preflight only and marks existing versus pending', async () => {
  const root = await tempRoot();
  const existingNote = await addFormalCase(root, '111');
  const result = await initBatchFromText([
    'https://x.com/a/status/111',
    'https://x.com/b/status/222',
    'https://github.com/example/repo',
  ].join('\n'), {
    root,
    batchId: 'preflight',
    waveSize: 3,
    onboardingFn: ready,
    env: {},
    now: 1_000,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.policy.guestOnly, true);
  assert.equal(result.policy.accountSessionAttempts, 0);
  assert.equal(result.policy.concurrency, 1);
  assert.deepEqual(result.counts, { existing: 1, pending: 1 });
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.items[0].notePath, existingNote);
});

test('batch hard mode refuses any enabled account-session environment before work starts', async () => {
  assert.throws(
    () => assertBatchGuestOnly({ XACTIONS_ALLOW_ACCOUNT_SESSION: '1' }),
    /permanently Guest-only/,
  );

  const root = await tempRoot();
  await assert.rejects(
    initBatchFromText('https://x.com/a/status/111', {
      root,
      batchId: 'auth-block',
      onboardingFn: ready,
      env: { XACTIONS_ALLOW_ACCOUNT_SESSION: '1' },
    }),
    /permanently Guest-only/,
  );
});

test('batch next checks environment before marking or preparing a pending item', async () => {
  const root = await tempRoot();
  await initBatchFromText('https://x.com/a/status/111', {
    root,
    batchId: 'environment-gate',
    waveSize: 3,
    env: {},
    now: 5_000,
  });

  let calls = 0;
  const result = await coreNextBatchItem('environment-gate', {
    root,
    env: {},
    now: 6_000,
    onboardingFn: async () => ({ status: 'action_required', actions: ['Enable Media Viewer'], networkChecked: false }),
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready' };
    },
  });

  assert.equal(result.status, 'action_required');
  assert.equal(result.networkStarted, false);
  assert.equal(calls, 0);

  const status = await batchStatus('environment-gate', root);
  assert.equal(status.counts.pending, 1);
  assert.equal(status.wave.started, 0);
});

test('batch enforces concurrency one, records note_ready, and enforces cooldown', async () => {
  const root = await tempRoot();
  await initBatchFromText([
    'https://x.com/a/status/111',
    'https://x.com/b/status/222',
  ].join('\n'), {
    root,
    batchId: 'serial',
    waveSize: 3,
    minCooldownMs: 30_000,
    onboardingFn: ready,
    env: {},
    now: 10_000,
  });

  let calls = 0;
  const first = await batchNext('serial', {
    root,
    env: {},
    now: 20_000,
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready', jobDir: 'job', jobPath: 'job.json', sourcePath: 'source.json', analysisPath: 'analysis.json', handoffPath: 'handoff.md' };
    },
  });
  assert.equal(first.item.tweetId, '111');
  assert.equal(first.item.status, 'processing');
  assert.equal(calls, 1);

  const blocked = await batchNext('serial', {
    root,
    env: {},
    now: 25_000,
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready' };
    },
  });
  assert.equal(blocked.status, 'action_required');
  assert.equal(calls, 1);

  await completeStubCase(root, '111');
  const recorded = await recordBatchItem('serial', '111', { root, env: {}, now: 30_000 });
  assert.equal(recorded.item.status, 'note_ready');
  assert.equal(recorded.item.capture, '待确认');

  const cooldown = await batchNext('serial', {
    root,
    env: {},
    now: 50_000,
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready' };
    },
  });
  assert.equal(cooldown.status, 'cooldown');
  assert.equal(cooldown.retryAfterMs, 10_000);
  assert.equal(calls, 1);

  const second = await batchNext('serial', {
    root,
    env: {},
    now: 60_000,
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready', jobDir: 'job2', jobPath: 'job2.json', sourcePath: 'source2.json', analysisPath: 'analysis2.json', handoffPath: 'handoff2.md' };
    },
  });
  assert.equal(second.item.tweetId, '222');
  assert.equal(second.item.status, 'processing');
  assert.equal(calls, 2);
});

test('wave limit pauses after the configured pilot and resume only opens a new bounded wave', async () => {
  const root = await tempRoot();
  await initBatchFromText([
    'https://x.com/a/status/111',
    'https://x.com/b/status/222',
  ].join('\n'), {
    root,
    batchId: 'waves',
    waveSize: 1,
    minCooldownMs: 30_000,
    onboardingFn: ready,
    env: {},
    now: 100_000,
  });

  await batchNext('waves', {
    root,
    env: {},
    now: 110_000,
    prepareFn: async () => ({ status: 'materials_ready' }),
  });
  await completeStubCase(root, '111');
  await recordBatchItem('waves', '111', { root, env: {}, now: 120_000 });

  const stopped = await batchNext('waves', { root, env: {}, now: 160_000 });
  assert.equal(stopped.status, 'wave_complete');
  assert.equal(stopped.stopReason, 'wave_limit');

  const resumed = await resumeBatch('waves', { root, env: {}, waveSize: 2, now: 170_000 });
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.wave.number, 2);
  assert.equal(resumed.wave.limit, 2);
});

test('429 or platform failures trip a circuit breaker and cannot be automatically resumed', async () => {
  const root = await tempRoot();
  await initBatchFromText('https://x.com/a/status/111', {
    root,
    batchId: 'breaker',
    waveSize: 3,
    onboardingFn: ready,
    env: {},
    now: 200_000,
  });

  const failurePath = path.join(root, 'failure.json');
  await fs.writeFile(failurePath, JSON.stringify({
    error: { message: 'Too Many Requests' },
    apiResponses: [{ status: 429, resetAt: 500 }],
  }, null, 2));

  const result = await batchNext('breaker', {
    root,
    env: {},
    now: 210_000,
    prepareFn: async () => ({ status: 'failed', failurePath, message: 'collection failed' }),
  });
  assert.equal(result.status, 'paused');
  assert.equal(result.stopReason, 'circuit_breaker');
  assert.equal(result.classification.kind, 'platform');

  const resume = await resumeBatch('breaker', { root, env: {}, waveSize: 3, now: 600_000 });
  assert.equal(resume.status, 'action_required');
});

test('content-level unavailable cases can fail without opening account fallback or pausing the whole batch', async () => {
  const root = await tempRoot();
  await initBatchFromText([
    'https://x.com/a/status/111',
    'https://x.com/b/status/222',
  ].join('\n'), {
    root,
    batchId: 'content-failure',
    waveSize: 3,
    minCooldownMs: 30_000,
    onboardingFn: ready,
    env: {},
    now: 300_000,
  });

  const failurePath = path.join(root, 'content-failure.json');
  await fs.writeFile(failurePath, JSON.stringify({
    error: { message: 'Tweet not found (404)' },
    apiResponses: [{ status: 404 }],
  }, null, 2));

  const failed = await batchNext('content-failure', {
    root,
    env: {},
    now: 310_000,
    prepareFn: async () => ({ status: 'failed', failurePath, message: 'not found' }),
  });
  assert.equal(failed.status, 'running');
  assert.equal(failed.classification.kind, 'content');
  assert.equal(failed.item.status, 'failed');

  const status = await batchStatus('content-failure', root);
  assert.equal(status.policy.accountSessionAttempts, 0);
  assert.equal(status.counts.pending, 1);
});

test('batch manifest persists progress so completed work is not prepared again after reload', async () => {
  const root = await tempRoot();
  await initBatchFromText([
    'https://x.com/a/status/111',
    'https://x.com/b/status/222',
  ].join('\n'), {
    root,
    batchId: 'resume-state',
    waveSize: 3,
    minCooldownMs: 0,
    onboardingFn: ready,
    env: {},
    now: 400_000,
  });

  let calls = 0;
  await batchNext('resume-state', {
    root,
    env: {},
    now: 410_000,
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready' };
    },
  });
  await completeStubCase(root, '111');
  await recordBatchItem('resume-state', '111', { root, env: {}, now: 420_000 });

  const next = await batchNext('resume-state', {
    root,
    env: {},
    now: 430_000,
    prepareFn: async () => {
      calls += 1;
      return { status: 'materials_ready' };
    },
  });
  assert.equal(next.item.tweetId, '222');
  assert.equal(calls, 2);

  const reloaded = await batchStatus('resume-state', root);
  assert.equal(reloaded.items.find((item) => item.tweetId === '111').status, 'note_ready');
  assert.equal(reloaded.items.find((item) => item.tweetId === '222').status, 'processing');
});
