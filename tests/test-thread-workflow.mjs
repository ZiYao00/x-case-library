import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot, save, json, hash, prepare, renderCase, validate, exists, repairPrepare, repairAnalysisTemplate, repairRegressions } from '../scripts/x-case-core.mjs';
import { finalize, recoverPublication } from '../scripts/run-x-case.mjs';
import { memberCases, orderAuthorTweets, resolveAuthorRoot, relationshipNode, validateRelatedPosts } from '../scripts/thread-identity.mjs';
import { mergeThreadCases, adoptReviewedCase } from '../scripts/thread-update.mjs';
import { walkAuthorReplyThread } from '../config/ssr-author-replies.mjs';
import { withWorkflowLock } from '../scripts/workflow-lock.mjs';
import { initBatchFromText, nextBatchItem, recordBatchItem, batchStatus } from '../scripts/x-batch-core.mjs';

const author = { id: '99', username: 'author', name: '作者' };
const tweet = (id, parent = null) => ({ id, text: '原文 ' + id, author, createdAt: '2026-10-07T00:00:00Z', inReplyTo: parent ? { tweetId: parent, userId: '99', username: 'author' } : null });
const source = (id, replies = []) => ({ schemaVersion: 2, capturedAt: '2026-10-07T00:00:00Z', tweetId: id, sourceUrl: 'https://x.com/author/status/' + id, rootTweet: tweet(id), authorReplies: replies, mediaFiles: [], completeness: { rootTweetComplete: true, authorRepliesStatus: 'available-via-logged-out-ssr', articleStatus: 'not-present' } });

async function fixture() {
  const root = path.join(projectRoot, '.runtime', 'offline-tests', 'thread-' + randomUUID());
  const obsidian = path.join(root, 'vault', '.obsidian');
  await fs.mkdir(path.join(root, 'notes', 'x', '00-待整理'), { recursive: true });
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'xactions'), { recursive: true });
  await fs.mkdir(path.join(obsidian, 'plugins', 'mediaviewer'), { recursive: true });
  await fs.mkdir(path.join(obsidian, 'snippets'), { recursive: true });
  await save(path.join(root, 'node_modules', 'xactions', 'package.json'), { version: '4.0.1' });
  await save(path.join(obsidian, 'community-plugins.json'), ['mediaviewer']);
  await save(path.join(obsidian, 'plugins', 'mediaviewer', 'manifest.json'), { version: '2.2.1' });
  await save(path.join(obsidian, 'appearance.json'), { enabledCssSnippets: [] });
  await fs.symlink(path.join(root, 'notes', 'x'), path.join(root, 'vault', 'X案例库'), 'junction');
  await save(path.join(root, 'config', 'local.json'), { notes_root: 'notes/x', vault_root: path.join(root, 'vault'), notes_subdir: 'X案例库' });
  return root;
}

async function formal(root, s, title = '案例 ' + s.tweetId, exclude = []) {
  const dir = path.join(root, 'notes', 'x', '_case-data', s.tweetId), jobDir = path.join(root, '.runtime', s.tweetId);
  await fs.mkdir(dir, { recursive: true }); await fs.mkdir(jobDir, { recursive: true });
  await save(path.join(dir, 'source.json'), s);
  for (const media of s.mediaFiles) { await fs.mkdir(path.dirname(path.join(dir, media.localPath)), { recursive: true }); await fs.writeFile(path.join(dir, media.localPath), 'video'); }
  const analysis = { title, summary: '摘要。', points: ['要点一。', '要点二。', '要点三。'], tags: ['X案例'], posts: [s.rootTweet, ...s.authorReplies].map((t) => ({ id: t.id, segments: [{ kind: 'prose', text: t.text, translation: '' }] })) };
  const job = { tweetId: s.tweetId, caseDir: dir, sourcePath: path.join(dir, 'source.json'), sourceHash: hash(await fs.readFile(path.join(dir, 'source.json'))), status: 'note_ready', notePath: path.join(root, 'notes', 'x', '00-待整理', title + '.md') };
  const rendered = await renderCase({ ...job, mode: 'repair', lockedTitle: title, targetDataDir: dir, retireCases: exclude }, analysis, root);
  await fs.writeFile(job.notePath, rendered.markdown, 'utf8'); await save(path.join(jobDir, 'analysis.json'), analysis); await save(path.join(jobDir, 'job.json'), job);
  return { job, analysis, dir };
}

test('numeric IDs stay exact; trees order parents before children and reject cycles/foreign authors', () => {
  const a = tweet('2107436379575840895'), b = tweet('2107436382927171836', a.id), c = tweet('2107667147019194394', b.id);
  assert.deepEqual(orderAuthorTweets(a, [c, b]).map((t) => t.id), [a.id, b.id, c.id]);
  assert.throws(() => orderAuthorTweets(a, [tweet('2', '3'), tweet('3', '2')]), /cycle/);
  assert.throws(() => orderAuthorTweets(a, [{ ...b, author: { id: '88' } }]), /author/);
});

test('bounded parent normalization reuses evidence and refuses unreadable/unknown parents', async () => {
  let requests = 0;
  const resolved = await resolveAuthorRoot(tweet('102', '101'), { lookup: async () => tweet('101'), fetchTweet: async () => { requests++; throw new Error(); } });
  assert.equal(resolved.root.id, '101'); assert.equal(requests, 0);
  const foreign = { ...tweet('102'), inReplyTo: { tweetId: '101', userId: '88' } };
  const outsider = { ...tweet('101'), author: { id: '88' } };
  assert.equal((await resolveAuthorRoot(foreign, { lookup: async () => outsider, fetchTweet: async () => { throw new Error(); } })).boundary, 'different-author');
  await assert.rejects(resolveAuthorRoot(foreign, { lookup: async () => null, fetchTweet: async () => { throw new Error('unreadable parent'); } }), /unreadable/);
  await assert.rejects(resolveAuthorRoot({ ...tweet('102'), inReplyTo: { tweetId: '101' } }, {}), /unknown/);
  await assert.rejects(resolveAuthorRoot(tweet('110', '109'), { maxHops: 1, lookup: async (id) => tweet(id, String(BigInt(id) - 1n)), fetchTweet: async () => null }), /limit/);
});

test('a foreign-author question bridges author content without storing comment text', async () => {
  const a = tweet('100'), question = { ...tweet('101', '100'), author: { id: '88' }, text: 'ordinary comment must never be stored' };
  const c = { ...tweet('102', '101'), inReplyTo: { tweetId: '101', userId: '88' } };
  const resolved = await resolveAuthorRoot(c, { lookup: async id => id === '101' ? question : a, fetchTweet: async () => { throw new Error('network'); } });
  assert.equal(resolved.root.id, '100');
  assert.deepEqual(resolved.chain.map(t => t.id), ['100', '102']);
  assert.equal(JSON.stringify(resolved.relationshipNodes).includes('ordinary comment'), false);
  assert.deepEqual(orderAuthorTweets(a, [c], resolved.relationshipNodes).map(t => t.id), ['100', '102']);
  assert.throws(() => orderAuthorTweets(a, [c]), /unverified/);
  assert.throws(() => orderAuthorTweets(a, [c], [question]), /comment content/);
  const corrupt = relationshipNode(question); corrupt.inReplyTo.userId = '77';
  assert.throws(() => orderAuthorTweets(a, [c], [corrupt]), /identity/);
});

test('SSR candidates cross a verified foreign bridge and single-level quote media stays separate', async () => {
  const question = { ...tweet('101', '100'), author: { id: '88' } }, child = { ...tweet('102', '101'), inReplyTo: { tweetId: '101', userId: '88' } };
  const comparison = { ...tweet('103'), quotedTweetId: '100' };
  const html = 'entry_id:"conversationthread-102-tweet-102",screen_name:"author";entry_id:"conversationthread-103-tweet-103",screen_name:"author"';
  const result = await walkAuthorReplyThread({ rootTweet: tweet('100'), sourceUrl: 'x', fetchPage: async () => ({ status: 200, html }), fetchTweet: async id => id === '102' ? child : comparison, resolveCandidateParents: async () => ({ chain: [child], relationshipNodes: [relationshipNode(question)] }) });
  assert.deepEqual(result.replies.map(t => t.id), ['102']);
  assert.deepEqual(result.relatedPosts.map(t => t.id), ['103']);
  assert.equal(result.pagesVisited.includes('101'), false);
  assert.equal(result.pagesVisited.includes('103'), false);
});

test('Prompt labels contain type only and preserve copied text and repair metadata', async () => {
  const root = await fixture(), prior = await formal(root, source('100'));
  const s = await json(prior.job.sourcePath); s.rootTweet.text = 'image\nvideo'; await save(prior.job.sourcePath, s);
  const a = { ...prior.analysis, posts: [{ id: '100', showSourceLink: true, segments: [{ kind: 'prompt', text: 'image\n', promptType: 'image', model: 'GPT Image 2.5' }, { kind: 'prompt', text: 'video', promptType: 'video', model: 'Seedance 2.5' }] }] };
  const job = { ...prior.job, sourceHash: hash(await fs.readFile(prior.job.sourcePath)) };
  const rendered = await renderCase(job, a, root);
  assert.ok(rendered.markdown.includes('**图片生成 Prompt**'));
  assert.ok(rendered.markdown.includes('**视频生成 Prompt**'));
  assert.equal(rendered.markdown.includes('Seedance 2.5'), false);
  assert.equal(rendered.markdown.includes('GPT Image 2.5'), false);
  assert.deepEqual(repairAnalysisTemplate(s, a, a.title).posts, a.posts);
  a.posts[0].segments[0].promptType = 'guess'; await assert.rejects(renderCase(job, a, root), /Prompt type/);
});

test('related image validates ownership, renders provenance and does not become a captured member', async () => {
  const root = await fixture(), s = source('100');
  s.relatedPosts = [{ ...tweet('103'), quotedTweetId: '100' }];
  s.mediaFiles = [{ tweetId: '103', type: 'photo', localPath: 'media/comparison.jpg', bytes: 5, status: 'downloaded', remoteUrl: 'https://pbs.twimg.com/media/example.jpg' }];
  const prior = await formal(root, s);
  const a = { ...prior.analysis, mediaNotes: [{ tweetId: '103', text: 'Nano Banana 2.1 对比图。' }] };
  const rendered = await renderCase(prior.job, a, root);
  assert.ok(rendered.markdown.includes('![[comparison.jpg]]'));
  assert.ok(rendered.markdown.includes('https://x.com/author/status/103'));
  assert.deepEqual(await memberCases(root, '103'), []);
  const lost = structuredClone(s); lost.relatedPosts = [];
  assert.ok(repairRegressions(s, lost).some(reason => reason.includes('103')));
  const changed = structuredClone(s); changed.relatedPosts[0].quotedTweetId = '555';
  assert.throws(() => validateRelatedPosts(changed), /quote/);
  const foreign = structuredClone(s); foreign.relatedPosts[0].author = { id: '88' };
  assert.throws(() => validateRelatedPosts(foreign), /author/);
});

test('approved reading-layer adoption pins hashes, stages safely and retires a missing visible note', async () => {
  const root = await fixture(), initial = source('100');
  initial.mediaFiles = [{ tweetId: '100', type: 'video', localPath: 'media/approved.mp4', remoteUrl: 'https://video.twimg.com/approved.mp4', bytes: 5, status: 'downloaded' }];
  const current = await formal(root, initial), old = await formal(root, source('102'));
  await fs.appendFile(current.job.notePath, '\n已确认的人工整理\n');
  const archivedOldNote = path.join(root, '.runtime', 'approved-old.md'); await fs.rename(old.job.notePath, archivedOldNote);
  const caseDir = path.join(root, '.runtime', 'approved-case'); await fs.mkdir(caseDir);
  const merged = source('100', [tweet('102', '100')]);
  merged.mediaFiles = initial.mediaFiles;
  await fs.mkdir(path.join(caseDir, 'media'));
  await fs.copyFile(path.join(current.dir, 'media', 'approved.mp4'), path.join(caseDir, 'media', 'approved.mp4'));
  merged.authorReplies[0].text = old.analysis.posts[0].segments[0].text;
  const sourcePath = path.join(caseDir, 'source.json'), analysisPath = path.join(caseDir, 'analysis.json');
  await save(sourcePath, merged);
  const analysis = repairAnalysisTemplate(merged, current.analysis, current.analysis.title); analysis.aliases = ['案例 102']; await save(analysisPath, analysis);
  const manifest = { expectedSourceHash: current.job.sourceHash, expectedNoteHash: hash(await fs.readFile(current.job.notePath)), sourcePath: path.relative(root, sourcePath), stagedSourceHash: hash(await fs.readFile(sourcePath)), analysisPath: path.relative(root, analysisPath), analysisHash: hash(await fs.readFile(analysisPath)), retireCases: [{ tweetId: '102', sourceHash: old.job.sourceHash, notePath: path.relative(root, archivedOldNote), noteHash: hash(await fs.readFile(archivedOldNote)) }] };
  const manifestPath = path.join(root, '.runtime', 'review.json'); await save(manifestPath, manifest);
  assert.equal((await adoptReviewedCase(root, '100', manifestPath, { dryRun: true })).status, 'review_adoption_preview');
  const before = await fs.readFile(current.job.notePath);
  await adoptReviewedCase(root, '100', manifestPath); assert.deepEqual(await fs.readFile(current.job.notePath), before);
  await validate('100', root); await finalize('100', root);
  assert.equal(await exists(old.dir), false);
  assert.equal((await prepare('https://x.com/author/status/102', root, () => { throw new Error('network'); })).caseId, '100');
  assert.equal((await finalize('102', root)).notePath, current.job.notePath);
  assert.equal((await json(path.join(root, '.runtime', '102', 'job.json'))).status, 'delegated');
  await assert.rejects(adoptReviewedCase(root, '100', manifestPath), /hash changed/);
});

test('repair refuses a personally edited baseline before any network attempt', async () => {
  const root = await fixture(), current = await formal(root, source('100'));
  await fs.appendFile(current.job.notePath, '\n个人补充必须保留\n');
  const before = await fs.readFile(current.job.notePath);
  const result = await repairPrepare('https://x.com/author/status/100', root, () => { throw new Error('Network must not be called'); });
  assert.equal(result.status, 'action_required'); assert.equal(result.networkUsed, false);
  assert.deepEqual(await fs.readFile(current.job.notePath), before);
  assert.equal((await json(path.join(root, '.runtime', '100', 'job.json'))).status, 'note_ready');
});

test('an explicit reply seed survives an SSR page that omits it', async () => {
  const result = await walkAuthorReplyThread({ rootTweet: tweet('100'), sourceUrl: 'x', seedReplies: [tweet('101', '100')], fetchPage: async () => ({ status: 200, html: 'no replies' }), fetchTweet: async () => { throw new Error('No exact request expected'); } });
  assert.deepEqual(result.replies.map((t) => t.id), ['101']);
});

test('SSR grandchild joins only through a verified missing-parent chain and obeys the reply limit', async () => {
  const html = 'entry_id:"conversationthread-102-tweet-102",screen_name:"author";entry_id:"conversationthread-103-tweet-103",screen_name:"author"';
  let requests = 0;
  const result = await walkAuthorReplyThread({ rootTweet: tweet('100'), sourceUrl: 'x', maxReplies: 2,
    fetchPage: async () => ({ status: 200, html }), fetchTweet: async (id) => { requests++; return tweet(id, '101'); },
    resolveCandidateParents: async (child) => [tweet('101', '100'), child],
  });
  assert.deepEqual(result.replies.map((t) => t.id), ['101', '102']);
  assert.equal(requests, 1); assert.equal(result.terminatedReason, 'reply-limit');
});

test('captured reply resolves read-only; overlapping legacy cases stop rather than choosing one', async () => {
  const root = await fixture(); await formal(root, source('100', [tweet('101', '100')]));
  const result = await prepare('https://x.com/author/status/101', root, () => { throw new Error('network'); });
  assert.equal(result.status, 'existing_case_found'); assert.equal(result.caseId, '100'); assert.equal(result.networkUsed, false);
  const older = source('101'); older.rootTweet = tweet('101', '100'); await formal(root, older);
  assert.equal((await prepare('https://x.com/author/status/101', root)).status, 'action_required');
});

test('captured member with conflicting unfinished staging stops locally without collection', async () => {
  const root = await fixture(); await formal(root, source('100', [tweet('101', '100')]));
  const stage = path.join(root, 'notes', 'x', '00-待整理', '101'); await fs.mkdir(stage); await save(path.join(stage, 'source.json'), source('101'));
  const result = await prepare('https://x.com/author/status/101', root, () => { throw new Error('network'); });
  assert.equal(result.status, 'action_required'); assert.equal(result.networkUsed, false);
});

test('new normalized root cannot publish over an overlapping legacy reply case', async () => {
  const root = await fixture(), older = source('101'); older.rootTweet = tweet('101', '100'); await formal(root, older);
  const fresh = source('100', [tweet('101', '100')]); fresh.caseIdentity = { mode: 'thread' };
  const result = await prepare('https://x.com/author/status/100', root, async () => { const stage = path.join(root, 'notes', 'x', '00-待整理', '100'); await fs.mkdir(stage); await save(path.join(stage, 'source.json'), fresh); return { status: 0 }; });
  assert.equal(result.status, 'action_required'); assert.deepEqual(result.cases, ['101']);
  assert.equal(await exists(path.join(root, 'notes', 'x', '_case-data', '100')), false);
});

test('standalone exception wins over membership in a broader thread', async () => {
  const root = await fixture(); await formal(root, source('100', [tweet('101', '100')]));
  const older = source('101'); older.rootTweet = tweet('101', '100'); older.caseIdentity = { mode: 'standalone' }; await formal(root, older);
  assert.equal((await prepare('https://x.com/author/status/101', root)).caseId, '101');
});

test('supplied missing reply stages a supplement without changing the existing note; finalize resolves all members', async () => {
  const root = await fixture(), prior = await formal(root, source('100', [tweet('101', '100')]));
  const original = await fs.readFile(prior.job.notePath);
  const fresh = source('100', [tweet('101', '100'), tweet('102', '100')]);
  fresh.caseIdentity = { mode: 'thread', inputTweetId: '102', caseId: '100' };
  fresh.acquisition = { baseSnapshot: { sourceHash: prior.job.sourceHash } };
  const result = await prepare('https://x.com/author/status/102', root, async () => {
    const dir = path.join(root, 'notes', 'x', '00-待整理', '102'); await fs.mkdir(dir); await save(path.join(dir, 'source.json'), fresh); return { status: 0 };
  });
  assert.equal(result.tweetId, '100'); assert.equal(result.operation, 'supplement'); assert.deepEqual(await fs.readFile(prior.job.notePath), original);
  await validate('100', root); assert.equal((await finalize('100', root)).status, 'note_ready');
  assert.equal((await prepare('https://x.com/author/status/102', root)).caseId, '100');
});

test('reply-first creation uses the canonical job and preserves an input receipt', async () => {
  const root = await fixture(), fresh = source('100', [tweet('101', '100')]); fresh.caseIdentity = { mode: 'thread' };
  const result = await prepare('https://x.com/author/status/101', root, async () => { const dir = path.join(root, 'notes', 'x', '00-待整理', '101'); await fs.mkdir(dir); await save(path.join(dir, 'source.json'), fresh); return { status: 0 }; });
  assert.equal(result.tweetId, '100', JSON.stringify(result)); assert.equal((await json(path.join(root, '.runtime', '101', 'job.json'))).caseId, '100');
  const a = await json(result.analysisPath); a.title = '新案例'; a.summary = '摘要'; a.points = ['一', '二', '三']; await save(result.analysisPath, a);
  await validate('100', root); await finalize('100', root);
  assert.equal((await prepare('https://x.com/author/status/101', root)).caseId, '100');
});

test('merge archives old note/data only after validation and preserves basename links with aliases', async () => {
  const root = await fixture(); const current = await formal(root, source('100', [tweet('101', '100')]));
  const oldSource = source('101'); oldSource.rootTweet = tweet('101', '100'); const old = await formal(root, oldSource);
  const bytes = await fs.readFile(old.job.notePath);
  assert.equal((await mergeThreadCases(root, '100', '101', { dryRun: true })).status, 'merge_preview');
  const result = await mergeThreadCases(root, '100', '101'); assert.equal(result.networkUsed, false);
  assert.equal(await exists(old.job.notePath), true); await validate('100', root); await finalize('100', root);
  assert.equal(await exists(old.job.notePath), false); assert.equal(await exists(old.dir), false);
  assert.equal((await memberCases(root, '101'))[0].caseId, '100');
  const job = await json(path.join(root, '.runtime', '100', 'job.json'));
  assert.deepEqual(await fs.readFile(path.join(job.retireCases[0].archiveDir, path.basename(old.job.notePath))), bytes);
  assert.match(await fs.readFile(current.job.notePath, 'utf8'), /aliases:/);
});

test('merge refuses personal edits, path-qualified backlinks and changed retiring snapshots', async () => {
  const root = await fixture(); await formal(root, source('100', [tweet('101', '100')]));
  const oldSource = source('101'); oldSource.rootTweet = tweet('101', '100'); const old = await formal(root, oldSource);
  const original = await fs.readFile(old.job.notePath, 'utf8'); await fs.appendFile(old.job.notePath, '\n个人笔记');
  await assert.rejects(mergeThreadCases(root, '100', '101'), /personal edits/);
  await fs.writeFile(old.job.notePath, original);
  const reference = path.join(root, 'vault', 'reference.md'); await fs.writeFile(reference, '[[X案例库/00-待整理/案例 101]]');
  await assert.rejects(mergeThreadCases(root, '100', '101'), /backlinks/);
  await fs.writeFile(reference, '[[案例 101]]');
  await mergeThreadCases(root, '100', '101'); await validate('100', root); await fs.appendFile(old.job.notePath, '改动');
  await assert.rejects(finalize('100', root), /Retiring case changed/); assert.equal(await exists(old.dir), true);
});

test('merge retains distinct media with colliding basenames and verifies their bytes after retirement', async () => {
  const root = await fixture();
  const a = source('100', [tweet('101', '100')]), b = source('101'); b.rootTweet = tweet('101', '100');
  a.mediaFiles = [{ tweetId: '100', type: 'video', remoteUrl: 'https://video.twimg.com/a.mp4', localPath: 'media/same.mp4', status: 'downloaded', bytes: 5 }];
  b.mediaFiles = [{ tweetId: '101', type: 'video', remoteUrl: 'https://video.twimg.com/b.mp4', localPath: 'media/same.mp4', status: 'downloaded', bytes: 5 }];
  const retiredPath = path.join(root, 'notes', 'x', '_case-data', '101');
  const current = await formal(root, a, '主案例', [{ dataDir: retiredPath }]);
  await formal(root, b, '旧案例', [{ dataDir: current.dir }]);
  await mergeThreadCases(root, '100', '101'); await validate('100', root); await finalize('100', root);
  const published = await json(current.job.sourcePath);
  assert.equal(published.mediaFiles.length, 2); assert.equal(new Set(published.mediaFiles.map((m) => m.localPath)).size, 2);
  for (const media of published.mediaFiles) assert.equal(hash(await fs.readFile(path.join(current.dir, media.localPath))), media.contentHash);
});

test('a user-edited formal asset after merge prepare blocks publication before any replacement', async () => {
  const root = await fixture(), s = source('100', [tweet('101', '100')]);
  s.mediaFiles = [{ tweetId: '100', type: 'video', remoteUrl: 'https://video.twimg.com/a.mp4', localPath: 'media/a.mp4', status: 'downloaded', bytes: 5 }];
  const current = await formal(root, s), older = source('101'); older.rootTweet = tweet('101', '100'); await formal(root, older);
  await mergeThreadCases(root, '100', '101'); await validate('100', root);
  const media = path.join(current.dir, 'media', 'a.mp4'); await fs.writeFile(media, 'edited');
  await assert.rejects(finalize('100', root), /Formal asset changed/);
  assert.equal(await fs.readFile(media, 'utf8'), 'edited'); assert.equal(hash(await fs.readFile(current.job.sourcePath)), current.job.sourceHash);
});

test('new-case recovery completes a journaled directory move without network or a second source snapshot', async () => {
  const root = await fixture(), fresh = source('100');
  const result = await prepare('https://x.com/author/status/100', root, async () => { const dir = path.join(root, 'notes', 'x', '00-待整理', '100'); await fs.mkdir(dir); await save(path.join(dir, 'source.json'), fresh); return { status: 0 }; });
  const a = await json(result.analysisPath); a.title = '恢复案例'; a.summary = '摘要'; a.points = ['一', '二', '三']; await save(result.analysisPath, a);
  await validate('100', root);
  const job = await json(result.jobPath), rendered = await renderCase(job, a, root);
  await fs.writeFile(path.join(job.caseDir, 'case.md'), rendered.markdown);
  const dataDir = path.join(root, 'notes', 'x', '_case-data', '100'), notePath = path.join(root, 'notes', 'x', '00-待整理', '恢复案例.md');
  await save(path.join(root, '.runtime', '100', 'create-publication.json'), { state: 'publishing', tweetId: '100', stagingDir: job.caseDir, stagingMarkdown: 'case.md', dataDir, sourcePath: path.join(dataDir, 'source.json'), notePath, sourceHash: job.sourceHash, noteHash: hash(rendered.markdown) });
  await fs.mkdir(path.dirname(dataDir), { recursive: true }); await fs.rename(job.caseDir, dataDir);
  assert.equal((await recoverPublication('100', root)).status, 'note_ready');
  assert.equal(hash(await fs.readFile(notePath)), hash(rendered.markdown));
  assert.equal((await prepare('https://x.com/author/status/100', root)).networkUsed, false);
});

test('explicit interrupted-publication recovery restores old files and never recollects', async () => {
  const root = await fixture(), current = await formal(root, source('100', [tweet('101', '100')]));
  const older = source('101'); older.rootTweet = tweet('101', '100'); await formal(root, older);
  await mergeThreadCases(root, '100', '101'); await validate('100', root);
  const job = await json(path.join(root, '.runtime', '100', 'job.json')), a = await json(path.join(root, '.runtime', '100', 'analysis.json'));
  const rendered = await renderCase(job, a, root);
  await save(path.join(job.repairDir, 'publication.json'), { state: 'publishing', newNoteHash: hash(rendered.markdown), assets: [], createdMedia: [], createdDocuments: [] });
  await fs.copyFile(job.sourcePath, job.targetSourcePath); await fs.writeFile(job.targetNotePath, rendered.markdown);
  assert.equal((await recoverPublication('100', root)).status, 'publication_rolled_back');
  assert.equal(hash(await fs.readFile(current.job.notePath)), job.targetNoteHash);
  assert.equal((await recoverPublication('100', root)).alreadyRecovered, true);
});

test('project command lock blocks concurrent writers and archives its release evidence', async () => {
  const root = await fixture(); let release; const gate = new Promise((resolve) => { release = resolve; }); let started; const ready = new Promise((resolve) => { started = resolve; });
  const first = withWorkflowLock(root, async () => { started(); await gate; return 'done'; }); await ready;
  assert.equal((await withWorkflowLock(root, async () => 'wrong')).status, 'action_required'); release(); assert.equal(await first, 'done');
  assert.equal(await exists(path.join(root, '.runtime', 'command-lock.json')), false);
});

test('Batch charges identity network work even when it returns an existing canonical case', async () => {
  const root = await fixture(); await formal(root, source('100', [tweet('101', '100')]));
  await initBatchFromText('https://x.com/author/status/102\nhttps://x.com/author/status/103', { root, batchId: 'identity', now: 1000 });
  await nextBatchItem('identity', { root, now: 1000, onboardingFn: async () => ({ status: 'ready' }), prepareFn: async () => ({ status: 'existing_case_found', tweetId: '100', caseId: '100', networkUsed: true }) });
  const state = await batchStatus('identity', root); assert.equal(state.items[0].caseId, '100'); assert.equal(state.wave.started, 1);
  assert.equal((await nextBatchItem('identity', { root, now: 1001 })).status, 'cooldown');
});

test('Batch records canonical completion while keeping the original input ID', async () => {
  const root = await fixture();
  await initBatchFromText('https://x.com/author/status/101', { root, batchId: 'canonical', now: 1000 });
  await nextBatchItem('canonical', { root, now: 1000, onboardingFn: async () => ({ status: 'ready' }), prepareFn: async () => { await formal(root, source('100', [tweet('101', '100')])); return { status: 'materials_ready', tweetId: '100', caseId: '100', networkUsed: true }; } });
  await recordBatchItem('canonical', '101', { root, now: 2000 });
  const state = await batchStatus('canonical', root); assert.equal(state.items[0].tweetId, '101'); assert.equal(state.items[0].caseId, '100'); assert.equal(state.items[0].status, 'note_ready');
});
