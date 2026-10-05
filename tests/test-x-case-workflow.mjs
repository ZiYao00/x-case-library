import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectRoot, parseMessage, onboarding, prepare, validate, json, save, hash, renderCase, exists } from '../scripts/x-case-core.mjs';
import { finalize } from '../scripts/run-x-case.mjs';
import { finalizeDir } from '../scripts/finalize-case.mjs';

// Keep isolated evidence under Git-ignored .runtime; never delete user files or access X.
async function fixture(id = '123456789') {
  const root = path.join(projectRoot, '.runtime', 'offline-tests', randomUUID());
  const caseDir = path.join(root, 'notes', 'x', '00-待整理', id);
  const obsidian = path.join(root, 'vault', '.obsidian');
  await fs.mkdir(path.join(caseDir, 'media'), { recursive: true });
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'xactions'), { recursive: true });
  await fs.mkdir(path.join(obsidian, 'plugins', 'mediaviewer'), { recursive: true });
  await fs.mkdir(path.join(obsidian, 'snippets'), { recursive: true });
  await save(path.join(root, 'node_modules', 'xactions', 'package.json'), { version: '4.0.1' });
  await save(path.join(obsidian, 'community-plugins.json'), ['mediaviewer']);
  await save(path.join(obsidian, 'plugins', 'mediaviewer', 'manifest.json'), { version: '2.2.1' });
  await save(path.join(obsidian, 'appearance.json'), { enabledCssSnippets: ['learning-lab', 'x-case-note'] });
  for (const name of ['learning-lab', 'x-case-note']) await fs.writeFile(path.join(obsidian, 'snippets', name + '.css'), '/* fixture */');
  await fs.symlink(path.join(root, 'notes', 'x'), path.join(root, 'vault', 'X案例库'), 'junction');
  await save(path.join(root, 'config', 'local.json'), { notes_root: 'notes/x', vault_root: path.join(root, 'vault'), notes_subdir: 'X案例库' });
  const text = 'A video example.\n\nCreate a scene.\nUse ``` literally.';
  const source = { tweetId: id, sourceUrl: 'https://x.com/author/status/' + id,
    rootTweet: { id, text, author: { id: '99', username: 'author', name: '作者' }, createdAt: '2026-10-05T00:00:00Z' }, authorReplies: [],
    completeness: { rootTweetComplete: true, authorRepliesStatus: 'none-visible-via-logged-out-ssr' },
    mediaFiles: [{ tweetId: id, localPath: 'media/' + id + '.jpg', status: 'downloaded', bytes: 4 }] };
  await save(path.join(caseDir, 'source.json'), source);
  await fs.writeFile(path.join(caseDir, 'media', id + '.jpg'), 'test');
  const result = await prepare(source.sourceUrl, root, () => { throw new Error('Unexpected network request'); });
  assert.equal(result.status, 'materials_ready');
  const analysis = { title: '离线案例：原文保护', summary: '作者提供了一个视频生成示例。', points: ['保留作者提示词。', '复刻时可先验证单个镜头。', '来源未提供的参数需自行测试。'], tags: ['X案例'],
    posts: [{ id, segments: [{ kind: 'prose', text: 'A video example.\n\n', translation: '一个视频示例。' }, { kind: 'prompt', text: 'Create a scene.\nUse ``` literally.' }] }] };
  await save(result.analysisPath, analysis);
  return { root, id, caseDir, source, analysis, result };
}

test('exact URL hosts, status paths, aliases, share suffixes and single-post routing', () => {
  for (const link of ['https://x.com/author/status/123?utm_source=a', 'https://twitter.com/author/status/123/photo/1', 'https://www.x.com/author/status/123/video/2', 'https://x.com/i/web/status/123', 'https://x.com/i/status/123']) assert.equal(parseMessage('整理这条推文：' + link + '。').tweetId, '123');
  assert.equal(parseMessage('https://x.com/a/status/123 https://twitter.com/a/status/123').tweetId, '123');
  for (const input of ['x', 'tweet', 'https://x.com/author', 'https://x.com/search?q=test', 'https://x.com.evil.example/a/status/123', 'https://x.com/a/status/123evil', 'https://x.com/a/status/123 https://x.com/b/status/456', 'https://user@x.com/a/status/123']) assert.throws(() => parseMessage(input));
});

test('invalid prepare never invokes collector or creates jobs', async () => {
  await assert.rejects(prepare('https://x.com/search', path.join(projectRoot, '.runtime', 'unused'), () => { throw new Error('Network called'); }), /valid X/);
  assert.equal(await exists(path.join(projectRoot, '.runtime', 'unused')), false);
});

test('offline prepare resumes immutable source and preserves Agent analysis', async () => {
  const f = await fixture();
  const before = hash(await fs.readFile(path.join(f.caseDir, 'source.json')));
  const resumed = await prepare(f.source.sourceUrl, f.root, () => { throw new Error('Network called'); });
  assert.equal(resumed.status, 'materials_ready');
  assert.deepEqual(await json(resumed.analysisPath), f.analysis);
  assert.equal(hash(await fs.readFile(resumed.sourcePath)), before);
});

test('render preserves Prompt and fences embedded backticks; completeness stays uncertain', async () => {
  const f = await fixture();
  const result = await validate(f.id, f.root);
  assert.equal(result.status, 'validated');
  assert.equal(result.capture, '待确认');
  const markdown = await fs.readFile(result.previewPath, 'utf8');
  assert.ok(markdown.includes('> ````prompt\n> Create a scene.\n> Use ``` literally.\n> ````'));
  assert.ok(markdown.indexOf('## 媒体') < markdown.indexOf('## 原文'));
  assert.ok(!markdown.includes('## Prompt'));
});

test('source tampering, changed Prompt and missing prose translation are rejected', async () => {
  const f = await fixture();
  const job = await json(f.result.jobPath);
  const changed = structuredClone(f.analysis);
  changed.posts[0].segments[1].text += ' changed';
  await assert.rejects(renderCase(job, changed, f.root), /changed or omitted/);
  changed.posts[0].segments[1].text = f.analysis.posts[0].segments[1].text;
  changed.posts[0].segments[0].translation = '';
  await assert.rejects(renderCase(job, changed, f.root), /translation/);
  await fs.appendFile(job.sourcePath, ' ');
  await assert.rejects(validate(f.id, f.root), /source.json changed/);
  await assert.rejects(prepare(f.source.sourceUrl, f.root), /Source changed/);
});

test('missing downloaded media and ambiguous Vault basenames block publishing', async () => {
  const f = await fixture();
  const file = path.join(f.caseDir, 'media', f.id + '.jpg');
  await fs.rename(file, file + '.archived');
  await assert.rejects(validate(f.id, f.root), /ENOENT/);
  await fs.rename(file + '.archived', file);
  await fs.writeFile(path.join(f.root, 'vault', f.id + '.jpg'), 'duplicate');
  await assert.rejects(validate(f.id, f.root), /uniquely/);
});

test('partial acquisition can publish a partial note, never a complete one', async () => {
  const f = await fixture();
  const job = await json(f.result.jobPath);
  f.source.mediaFiles.push({ tweetId: f.id, status: 'failed', localPath: null });
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath)); // Fixture baseline only.
  const rendered = await renderCase(job, f.analysis, f.root);
  assert.equal(rendered.capture, '部分');
});

test('finalize is idempotent; duplicate links never collect; user edits remain untouched', async () => {
  const f = await fixture();
  const sourceHash = hash(await fs.readFile(f.result.sourcePath));
  const done = await finalize(f.id, f.root);
  assert.equal(done.status, 'note_ready');
  assert.equal(path.basename(done.notePath), done.folder + '.md');
  assert.equal(hash(await fs.readFile(path.join(done.caseDir, 'source.json'))), sourceHash);
  assert.equal((await finalize(f.id, f.root)).alreadyCompleted, true);
  const duplicate = await prepare(f.source.sourceUrl, f.root, () => { throw new Error('Network called'); });
  assert.equal(duplicate.status, 'existing_case_found');
  await fs.appendFile(done.notePath, '\n用户补充');
  await prepare(f.source.sourceUrl, f.root);
  assert.ok((await fs.readFile(done.notePath, 'utf8')).endsWith('用户补充'));
});

test('existing staging Markdown and title collisions cannot be overwritten', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.caseDir, 'user.md'), '用户已有草稿');
  await assert.rejects(finalize(f.id, f.root), /refuse to overwrite/);
  assert.equal(await fs.readFile(path.join(f.caseDir, 'user.md'), 'utf8'), '用户已有草稿');
  const other = await fixture('987654321');
  await fs.mkdir(path.join(other.root, 'notes', 'x', '00-待整理', other.analysis.title));
  await fs.mkdir(path.join(other.root, 'notes', 'x', '00-待整理', other.analysis.title + ' · ' + other.id));
  await assert.rejects(finalize(other.id, other.root), /already exists/);
});

test('wrong author identities, paths escaping case and missing target fail safely', async () => {
  const f = await fixture();
  const job = await json(f.result.jobPath);
  f.source.mediaFiles[0].localPath = '../outside.jpg';
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath));
  await assert.rejects(renderCase(job, f.analysis, f.root), /escapes/);
  await assert.rejects(finalizeDir(path.join(f.caseDir, 'missing')), /directly inside/);
  const cli = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'finalize-case.mjs'), '000000000000000000'], { cwd: f.root, encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Requested case not found/);
});

test('onboarding blocks broken mapping without accessing network', async () => {
  const f = await fixture();
  assert.equal((await onboarding(f.root)).status, 'ready');
  await save(path.join(f.root, 'config', 'local.json'), { notes_root: 'notes/x', vault_root: path.join(f.root, 'vault'), notes_subdir: 'missing' });
  assert.equal((await onboarding(f.root)).status, 'action_required');
});

test('failed fresh acquisition cannot automatically retry', async () => {
  const f = await fixture();
  // Archive only the isolated fixture directories, keeping all evidence within its root.
  await fs.rename(f.caseDir, path.join(f.root, 'archived-case'));
  await fs.rename(f.result.jobDir, path.join(f.root, 'archived-job'));
  let requests = 0;
  const failed = await prepare(f.source.sourceUrl, f.root, () => { requests++; return { status: 1 }; });
  assert.equal(failed.status, 'failed');
  const second = await prepare(f.source.sourceUrl, f.root, () => { requests++; return { status: 0 }; });
  assert.equal(second.status, 'action_required');
  assert.equal(requests, 1);
});

test('fresh acquisition creates handoff then reaches note_ready with a mock collector', async () => {
  const f = await fixture();
  await fs.rename(f.caseDir, path.join(f.root, 'archived-case'));
  await fs.rename(f.result.jobDir, path.join(f.root, 'archived-job'));
  let requests = 0;
  const prepared = await prepare(f.source.sourceUrl, f.root, async (url) => {
    assert.equal(url, f.source.sourceUrl);
    requests++;
    await fs.mkdir(path.join(f.caseDir, 'media'), { recursive: true });
    await save(path.join(f.caseDir, 'source.json'), f.source);
    await fs.writeFile(path.join(f.caseDir, 'media', f.id + '.jpg'), 'test');
    return { status: 0 };
  });
  assert.equal(prepared.status, 'materials_ready');
  assert.ok(await exists(prepared.handoffPath));
  await save(prepared.analysisPath, f.analysis);
  assert.equal((await finalize(f.id, f.root)).status, 'note_ready');
  assert.equal(requests, 1);
});
