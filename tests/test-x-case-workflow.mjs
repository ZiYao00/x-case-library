import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectRoot, parseMessage, onboarding, prepare, repairPrepare, repairRegressions, validate, json, save, hash, renderCase, exists } from '../scripts/x-case-core.mjs';
import { finalize } from '../scripts/run-x-case.mjs';
import { finalizeDir } from '../scripts/finalize-case.mjs';

// Keep isolated evidence under Git-ignored .runtime; never delete user files or access X.
test('repair preserves Article attachment contents when corrected entity keys move them', () => {
  const old = { rootTweet: { id: '123', text: 'article', article: {
    id: '456', status: 'available',
    blocks: [{ links: [{ type: 'url', token: ' ', target: 'https://x.com/author' }] }],
    documents: [{ type: 'markdown', entityKey: '0', rawMarkdown: '场景 Prompt' }, { type: 'markdown', entityKey: '4', rawMarkdown: '角色 Prompt' }],
  } } };
  const fresh = structuredClone(old);
  fresh.rootTweet.article.blocks = [{ links: [] }];
  fresh.rootTweet.article.documents = [{ type: 'markdown', entityKey: '2', rawMarkdown: '角色 Prompt' }, { type: 'markdown', entityKey: '4', rawMarkdown: '场景 Prompt' }];
  assert.deepEqual(repairRegressions(old, fresh), []);
  const changed = structuredClone(fresh);
  changed.rootTweet.article.documents[1].rawMarkdown = '改写场景 Prompt';
  assert.ok(repairRegressions(old, changed).some(reason => reason.includes('document')));
  const duplicates = structuredClone(fresh);
  duplicates.rootTweet.article.documents = [fresh.rootTweet.article.documents[1], fresh.rootTweet.article.documents[1]];
  assert.ok(repairRegressions(old, duplicates).some(reason => reason.includes('document')));
  old.rootTweet.article.blocks[0].links[0].token = '真实链接';
  assert.ok(repairRegressions(old, fresh).some(reason => reason.includes('link metadata')));
});

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

test('render linkifies prose and Article source links but never rewrites Prompt text', async () => {
  const f = await fixture();
  const job = await json(f.result.jobPath);
  const tco = 'https:' + '//t.co/site';
  const xProfile = 'https:' + '//x.com/karpathy';
  const website = 'https:' + '//example.com/';
  const openRouter = 'https:' + '//openrouter.ai/';
  const prose = 'A video by @karpathy: ' + tco + '\n\n';
  const prompt = 'Create a scene with ' + tco + ' unchanged.';
  f.source.rootTweet.text = prose + prompt;
  f.source.rootTweet.linkEntities = [
    { type: 'mention', token: '@karpathy', label: '@karpathy', target: xProfile },
    { type: 'url', token: tco, label: 'example.com', target: website },
  ];
  f.source.rootTweet.article = {
    status: 'available',
    provider: 'fxtwitter',
    id: '456',
    title: '推荐清单',
    sourceUrl: 'https:' + '//x.com/i/article/456',
    blocks: [{
      type: 'unstyled',
      text: '推荐 @karpathy 和 OpenRouter',
      links: [
        { type: 'mention', token: '@karpathy', label: '@karpathy', target: xProfile },
        { type: 'url', token: 'OpenRouter', label: 'OpenRouter', target: openRouter },
      ],
    }],
    media: [],
    unsupportedMediaCount: 0,
  };
  f.source.completeness.articleStatus = 'available';
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath));

  const analysis = structuredClone(f.analysis);
  analysis.posts[0].segments = [
    { kind: 'prose', text: prose, translation: '一个由该作者提供的视频示例。' },
    { kind: 'prompt', text: prompt },
  ];
  const rendered = await renderCase(job, analysis, f.root);

  assert.ok(rendered.markdown.includes('[@karpathy](' + xProfile + ')'));
  assert.ok(rendered.markdown.includes('[example.com](' + website + ')'));
  assert.ok(rendered.markdown.includes('[OpenRouter](' + openRouter + ')'));
  assert.ok(rendered.markdown.includes('> ' + prompt));
  assert.ok(!rendered.markdown.includes('> Create a scene with [example.com]'));
});



test('derived title summary and points render as safe plain text', async () => {
  const f = await fixture('153456789');
  const job = await json(f.result.jobPath);
  const analysis = structuredClone(f.analysis);
  analysis.title = '标题 <img src=x> [[Local]]';
  analysis.summary = '摘要 ![](https://example.com/p.png) <script>alert(1)</script>';
  analysis.points = [
    '不要解析 [[Vault Link]]。',
    '不要加载 ![](https://example.com/pixel.png)。',
    '不要执行 <img src="https://example.com/x.png">。',
  ];
  const rendered = await renderCase(job, analysis, f.root);
  assert.ok(!rendered.markdown.includes('# 标题 <img'));
  assert.ok(rendered.markdown.includes('# 标题 \\<img src\\=x\\> \\[\\[Local\\]\\]'));
  assert.ok(!rendered.markdown.includes('摘要 ![]('));
  assert.ok(rendered.markdown.includes('摘要 \\!\\[\\](https://example.com/p.png)'));
  assert.ok(rendered.markdown.includes('不要解析 \\[\\[Vault Link\\]\\]。'));
  assert.ok(rendered.markdown.includes('不要执行 \\<img'));
});

test('source count check renders as one warning line without changing capture', async () => {
  const f = await fixture('133456789');
  const job = await json(f.result.jobPath);
  const analysis = structuredClone(f.analysis);
  analysis.sourceCheck = '原文称“12 个提示词”，实际公开内容为 11 条。';
  const rendered = await renderCase(job, analysis, f.root);
  assert.equal(rendered.capture, '待确认');
  const lines = rendered.markdown.match(/^> \[!warning\] 来源核对｜.*$/gm) || [];
  assert.deepEqual(lines, ['> [!warning] 来源核对｜原文称“12 个提示词”，实际公开内容为 11 条。']);
  assert.ok(rendered.markdown.indexOf(lines[0]) > rendered.markdown.indexOf('## 原文'));
  assert.ok(rendered.markdown.indexOf(lines[0]) < rendered.markdown.indexOf('## 一句话看懂'));

  const invalid = structuredClone(analysis);
  invalid.sourceCheck = '第一行\n第二行';
  await assert.rejects(renderCase(job, invalid, f.root), /sourceCheck/);
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

test('unavailable or unsupported Article data marks the note partial without changing source text', async () => {
  const f = await fixture();
  const job = await json(f.result.jobPath);
  f.source.rootTweet.article = {
    status: 'unavailable',
    provider: 'fxtwitter',
    id: '456',
    title: 'Article',
    sourceUrl: 'https:' + '//x.com/i/article/456',
    blocks: [],
    media: [],
    unsupportedMediaCount: 0,
    error: 'fixture unavailable',
  };
  f.source.completeness.articleStatus = 'partial';
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath));
  const rendered = await renderCase(job, f.analysis, f.root);
  assert.equal(rendered.capture, '部分');
  assert.ok(rendered.markdown.includes('A video example.'));

  f.source.rootTweet.article = {
    status: 'available',
    provider: 'fxtwitter',
    id: '456',
    title: 'Article',
    sourceUrl: 'https:' + '//x.com/i/article/456',
    blocks: [{ type: 'atomic', text: ' ', links: [], atomic: { type: 'UNSUPPORTED', entityKey: '0', entityType: 'EMBED' } }],
    documents: [],
    media: [],
    unsupportedMediaCount: 0,
    unsupportedAtomicCount: 1,
  };
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath));
  const unsupported = await renderCase(job, f.analysis, f.root);
  assert.equal(unsupported.capture, '部分');
  assert.ok(unsupported.markdown.includes('A video example.'));
});

test('partial author-reply traversal marks the note partial even when media is complete', async () => {
  const f = await fixture();
  const job = await json(f.result.jobPath);
  f.source.completeness.authorRepliesStatus = 'partial-via-logged-out-ssr';
  f.source.completeness.authorRepliesError = { name: 'AuthorReplyTraversalPartial', message: 'fixture' };
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



test('finalized and unfinished duplicate state returns action_required without network access', async () => {
  const f = await fixture('163456789');
  await finalize(f.id, f.root);
  const stale = path.join(f.root, 'notes', 'x', '00-待整理', f.id);
  await fs.mkdir(stale, { recursive: true });
  await save(path.join(stale, 'source.json'), f.source);
  let requests = 0;
  const result = await prepare(f.source.sourceUrl, f.root, () => { requests++; return { status: 0 }; });
  assert.equal(result.status, 'action_required');
  assert.equal(requests, 0);
  assert.ok(result.actions.some((item) => item.includes('coexist')));
});

test('broken finalized case returns action_required without network access', async () => {
  const f = await fixture('143456789');
  const done = await finalize(f.id, f.root);
  const archived = done.notePath + '.archived';
  await fs.rename(done.notePath, archived);
  let requests = 0;
  const result = await prepare(f.source.sourceUrl, f.root, () => { requests++; return { status: 0 }; });
  assert.equal(result.status, 'action_required');
  assert.equal(requests, 0);
  assert.ok(result.actions.some((item) => item.includes('exactly one Markdown')));
  const repairResult = await repairPrepare(f.source.sourceUrl, f.root, () => { requests++; return { status: 0 }; });
  assert.equal(repairResult.status, 'action_required');
  assert.equal(requests, 0);
  assert.ok(repairResult.actions.some((item) => item.includes('exactly one Markdown')));
});

test('existing staging Markdown and title collisions cannot be overwritten', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.caseDir, 'user.md'), '用户已有草稿');
  await assert.rejects(finalize(f.id, f.root), /refuse to overwrite/);
  assert.equal(await fs.readFile(path.join(f.caseDir, 'user.md'), 'utf8'), '用户已有草稿');
  const other = await fixture('987654321');
  await fs.writeFile(path.join(other.root, 'notes', 'x', '00-待整理', other.analysis.title + '.md'), 'collision');
  await fs.writeFile(path.join(other.root, 'notes', 'x', '00-待整理', other.analysis.title + ' · ' + other.id + '.md'), 'collision');
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


test('repair accepts link span enrichment for legacy source metadata', async () => {
  const f = await fixture('333456789');
  const job = await json(f.result.jobPath);
  const profile = 'https:' + '//x.com/author';
  f.source.rootTweet.linkEntities = [
    { type: 'mention', token: '@author', label: '@author', target: profile },
  ];
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath));
  await save(f.result.jobPath, job);
  await finalize(f.id, f.root);

  const fresh = structuredClone(f.source);
  fresh.rootTweet.linkEntities = [
    { type: 'mention', token: '@author', label: '@author', target: profile, start: 0, end: 7 },
  ];

  const prepared = await repairPrepare(f.source.sourceUrl, f.root, async (_url, outputDir) => {
    await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
    await save(path.join(outputDir, 'source.json'), fresh);
    await fs.writeFile(path.join(outputDir, 'media', f.id + '.jpg'), 'test');
    return { status: 0 };
  });
  assert.equal(prepared.status, 'repair_materials_ready');
  assert.deepEqual(prepared.comparison.regressionReasons, []);
});

test('repair blocks regression of previously captured link and X Article metadata', async () => {
  const f = await fixture('323456789');
  const job = await json(f.result.jobPath);
  const profile = 'https:' + '//x.com/karpathy';

  f.source.rootTweet.linkEntities = [
    { type: 'mention', token: '@karpathy', label: '@karpathy', target: profile },
  ];
  f.source.rootTweet.article = {
    status: 'available',
    provider: 'fxtwitter',
    id: '456',
    title: '推荐清单',
    sourceUrl: 'https:' + '//x.com/i/article/456',
    blocks: [{
      type: 'unstyled',
      text: '@karpathy：示例',
      links: [{ type: 'mention', token: '@karpathy', label: '@karpathy', target: profile }],
    }],
    media: [],
    unsupportedMediaCount: 0,
  };
  f.source.completeness.articleStatus = 'available';
  await save(job.sourcePath, f.source);
  job.sourceHash = hash(await fs.readFile(job.sourcePath));
  await save(f.result.jobPath, job);
  const done = await finalize(f.id, f.root);
  const formalSourcePath = path.join(done.caseDir, 'source.json');
  const formalHash = hash(await fs.readFile(formalSourcePath));

  const fresh = structuredClone(f.source);
  fresh.rootTweet.linkEntities = [];
  fresh.rootTweet.article = {
    ...fresh.rootTweet.article,
    status: 'unavailable',
    blocks: [],
    error: 'fixture supplement outage',
  };
  fresh.completeness.articleStatus = 'partial';

  const blocked = await repairPrepare(f.source.sourceUrl, f.root, async (_url, outputDir) => {
    await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
    await save(path.join(outputDir, 'source.json'), fresh);
    await fs.writeFile(path.join(outputDir, 'media', f.id + '.jpg'), 'test');
    return { status: 0 };
  });

  assert.equal(blocked.status, 'action_required');
  assert.ok(blocked.actions.some((item) => item.includes('link metadata')));
  assert.ok(blocked.actions.some((item) => item.includes('previously available X Article')));
  assert.equal(hash(await fs.readFile(formalSourcePath)), formalHash, 'blocked repair must preserve the formal source');
});

test('explicit repair stages safely, upgrades the finalized case only after validate/finalize, and keeps rollback evidence', async () => {
  const f = await fixture('223456789');
  const done = await finalize(f.id, f.root);
  const formalSourcePath = path.join(done.caseDir, 'source.json');
  const beforeSourceHash = hash(await fs.readFile(formalSourcePath));
  const beforeNoteHash = hash(await fs.readFile(done.notePath));

  const reply = {
    id: '2234567891',
    text: '1/ 新增作者回复\n\n提示词：\n\n生成一个测试场景。',
    author: { id: '99', username: 'author', name: '作者' },
    createdAt: '2026-10-05T00:00:01Z',
    media: [],
    urls: [],
    inReplyTo: { tweetId: f.id, userId: '99', username: 'author' },
    lang: 'zh',
  };
  const fresh = structuredClone(f.source);
  fresh.authorReplies = [reply];
  fresh.completeness.authorRepliesStatus = 'available-via-logged-out-ssr';
  const documentName = f.id + '_SKILL.md';
  fresh.rootTweet.article = {
    status: 'available',
    provider: 'fxtwitter',
    id: '456',
    title: 'Skill',
    sourceUrl: 'https:' + '//x.com/i/article/456',
    blocks: [{ type: 'atomic', text: ' ', links: [], atomic: { type: 'MARKDOWN', entityKey: '0', documentIndex: 0 } }],
    documents: [{
      type: 'markdown', entityKey: '0', sourceFilename: 'SKILL.md', rawMarkdown: '```markdown\n# Skill\n```',
      filename: documentName, localPath: 'documents/' + documentName, bytes: 8, status: 'written', unwrapped: true,
    }],
    media: [],
    unsupportedMediaCount: 0,
    unsupportedAtomicCount: 0,
  };
  fresh.completeness.articleStatus = 'available';

  let requests = 0;
  const prepared = await repairPrepare(f.source.sourceUrl, f.root, async (url, outputDir) => {
    assert.equal(url, f.source.sourceUrl);
    assert.notEqual(path.resolve(outputDir), path.resolve(done.caseDir));
    requests++;
    await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'documents'), { recursive: true });
    await save(path.join(outputDir, 'source.json'), fresh);
    await fs.writeFile(path.join(outputDir, 'media', f.id + '.jpg'), 'test');
    await fs.writeFile(path.join(outputDir, 'documents', documentName), '# Skill\n');
    return { status: 0 };
  });

  assert.equal(prepared.status, 'repair_materials_ready');
  assert.equal(prepared.comparison.previousReplyCount, 0);
  assert.equal(prepared.comparison.freshReplyCount, 1);
  assert.equal(hash(await fs.readFile(formalSourcePath)), beforeSourceHash, 'repair prepare must not touch formal source');
  assert.equal(hash(await fs.readFile(done.notePath)), beforeNoteHash, 'repair prepare must not touch formal Markdown');

  const analysis = await json(prepared.analysisPath);
  assert.equal(analysis.title, f.analysis.title);
  assert.equal(analysis.posts.length, 2);
  analysis.summary = '作者原案例新增了一条作者回复，repair 应在确认后更新正式笔记。';
  analysis.points = ['保留原始主帖。', '纳入新增作者回复。', '只在 finalize 后替换正式案例。'];
  analysis.posts[1].segments = [{ kind: 'prose', text: reply.text, translation: '' }];
  await save(prepared.analysisPath, analysis);

  const validated = await validate(f.id, f.root);
  assert.equal(validated.status, 'validated');
  assert.equal(validated.mode, 'repair');
  assert.equal(hash(await fs.readFile(formalSourcePath)), beforeSourceHash, 'validate must not touch formal source');

  const repaired = await finalize(f.id, f.root);
  assert.equal(repaired.status, 'note_ready');
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.previousReplyCount, 0);
  assert.equal(repaired.authorReplyCount, 1);
  assert.deepEqual(repaired.copiedDocuments, [documentName]);
  assert.equal(requests, 1);

  const formalSource = await json(formalSourcePath);
  assert.equal(formalSource.authorReplies.length, 1);
  assert.equal(formalSource.authorReplies[0].id, reply.id);
  assert.equal(formalSource.rootTweet.article.documents[0].localPath, 'documents/' + documentName);
  assert.equal(await fs.readFile(path.join(done.caseDir, 'documents', documentName), 'utf8'), '# Skill\n');
  const repairedNote = await fs.readFile(done.notePath, 'utf8');
  assert.ok(repairedNote.includes('新增作者回复'));
  assert.ok(repairedNote.includes('打开附件：SKILL.md'));
  assert.ok(repairedNote.includes('X案例库/_case-data/' + f.id + '/documents/' + documentName));
  const backupSource = await json(path.join(prepared.repairDir, 'before', 'source.json'));
  assert.equal(backupSource.authorReplies.length, 0);
  assert.equal((await finalize(f.id, f.root)).alreadyCompleted, true);

  const regressed = structuredClone(f.source);
  const blocked = await repairPrepare(f.source.sourceUrl, f.root, async (_url, outputDir) => {
    requests++;
    await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
    await save(path.join(outputDir, 'source.json'), regressed);
    await fs.writeFile(path.join(outputDir, 'media', f.id + '.jpg'), 'test');
    return { status: 0 };
  });
  assert.equal(blocked.status, 'action_required');
  assert.ok(blocked.actions.some((item) => item.includes('missing previously captured author Tweet') || item.includes('fewer author replies')));
  assert.equal((await json(formalSourcePath)).authorReplies.length, 1, 'blocked repair must not downgrade formal source');
  assert.equal(requests, 2);
});


test('repair rollback removes media and documents created by the failed repair attempt', async () => {
  const f = await fixture('233456789');
  const done = await finalize(f.id, f.root);
  const formalSourcePath = path.join(done.caseDir, 'source.json');
  const beforeSourceHash = hash(await fs.readFile(formalSourcePath));
  const beforeNoteHash = hash(await fs.readFile(done.notePath));
  const newName = 'new-repair-media.jpg';
  const documentName = f.id + '_SKILL.md';

  const fresh = structuredClone(f.source);
  fresh.mediaFiles.push({
    tweetId: f.id,
    localPath: 'media/' + newName,
    status: 'downloaded',
    bytes: 3,
  });
  fresh.rootTweet.article = {
    status: 'available',
    provider: 'fxtwitter',
    id: '456',
    title: 'Skill',
    sourceUrl: 'https:' + '//x.com/i/article/456',
    blocks: [{ type: 'atomic', text: ' ', links: [], atomic: { type: 'MARKDOWN', entityKey: '0', documentIndex: 0 } }],
    documents: [{
      type: 'markdown', entityKey: '0', sourceFilename: 'SKILL.md', rawMarkdown: '```markdown\n# Skill\n```',
      filename: documentName, localPath: 'documents/' + documentName, bytes: 8, status: 'written', unwrapped: true,
    }],
    media: [],
    unsupportedMediaCount: 0,
    unsupportedAtomicCount: 0,
  };
  fresh.completeness.articleStatus = 'available';

  const prepared = await repairPrepare(f.source.sourceUrl, f.root, async (_url, outputDir) => {
    await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'documents'), { recursive: true });
    await save(path.join(outputDir, 'source.json'), fresh);
    await fs.writeFile(path.join(outputDir, 'media', f.id + '.jpg'), 'test');
    await fs.writeFile(path.join(outputDir, 'media', newName), 'new');
    await fs.writeFile(path.join(outputDir, 'documents', documentName), '# Skill\n');
    return { status: 0 };
  });
  assert.equal(prepared.status, 'repair_materials_ready');

  await validate(f.id, f.root);
  await fs.mkdir(path.join(prepared.repairDir, 'result.json'));
  await assert.rejects(finalize(f.id, f.root));

  assert.equal(hash(await fs.readFile(formalSourcePath)), beforeSourceHash);
  assert.equal(hash(await fs.readFile(done.notePath)), beforeNoteHash);
  assert.equal(await exists(path.join(done.caseDir, 'media', newName)), false);
  assert.equal(await exists(path.join(done.caseDir, 'documents', documentName)), false);
  assert.equal(await fs.readFile(path.join(done.caseDir, 'media', f.id + '.jpg'), 'utf8'), 'test');
});
