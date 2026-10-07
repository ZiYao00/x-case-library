import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { json, save, hash, exists, renderCase, repairAnalysisTemplate, repairRegressions, safePath, inside } from './x-case-core.mjs';
import { resolveFinalizedCase } from './case-layout.mjs';
import { tweetList, sourcePosts, orderAuthorTweets, mergeRelationshipNodes, validateRelatedPosts } from './thread-identity.mjs';

async function assetBaseline(dataDir, source) {
  const files = [...(source.mediaFiles || []).filter((item) => item.status === 'downloaded'), ...sourcePosts(source).flatMap((tweet) => (tweet.article?.documents || []).filter((item) => item.status === 'written'))];
  const result = [];
  for (const item of files) {
    const file = await safePath(dataDir, path.resolve(dataDir, item.localPath));
    result.push({ relative: path.relative(dataDir, file), hash: hash(await fs.readFile(file)) });
  }
  return result;
}

export async function stageThreadSupplement(root, input, caseDir, source, target) {
  const caseId = String(source.rootTweet.id), jobDir = path.join(root, '.runtime', caseId);
  await fs.mkdir(jobDir, { recursive: true });
  const jobPath = path.join(jobDir, 'job.json');
  const oldJob = await json(jobPath).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (oldJob && oldJob.status !== 'note_ready') throw new Error('Canonical case has an unfinished job; inspect it before supplementation');
  const repairDir = path.join(jobDir, 'operations', randomUUID()), beforeDir = path.join(repairDir, 'before');
  await fs.mkdir(beforeDir, { recursive: true });
  const stageCaseDir = path.join(repairDir, 'case');
  await fs.rename(caseDir, stageCaseDir);
  const sourceBytes = await fs.readFile(target.sourcePath), noteBytes = await fs.readFile(target.notePath);
  if (source.acquisition?.baseSnapshot?.sourceHash !== hash(sourceBytes)) throw new Error('Canonical source changed during acquisition');
  const previous = await json(path.join(jobDir, 'analysis.json'));
  const priorSource = JSON.parse(sourceBytes.toString('utf8'));
  const baseline = await renderCase({ ...(oldJob || {}), tweetId: caseId, caseDir: target.dataDir, sourcePath: target.sourcePath, sourceHash: hash(sourceBytes), mode: 'repair', lockedTitle: previous.title, targetDataDir: target.dataDir }, previous, root);
  if (baseline.markdown !== noteBytes.toString('utf8')) throw new Error('Canonical note has personal edits or no reproducible baseline; refuse automatic overwrite');
  if (priorSource.caseIdentity?.mode === 'standalone') throw new Error('An explicitly standalone case cannot be supplemented as a thread');
  await fs.copyFile(target.sourcePath, path.join(beforeDir, 'source.json'));
  await fs.copyFile(target.notePath, path.join(beforeDir, path.basename(target.notePath)));
  await save(path.join(beforeDir, 'analysis.json'), previous, true);
  const stagedSource = path.join(stageCaseDir, 'source.json');
  await safePath(repairDir, stagedSource);
  const job = {
    tweetId: caseId, caseId, inputTweetId: input.tweetId, sourceUrl: source.sourceUrl,
    mode: 'repair', operation: 'supplement', status: 'materials_ready', repairDir, beforeDir,
    caseDir: stageCaseDir, sourcePath: stagedSource, sourceHash: hash(await fs.readFile(stagedSource)),
    targetDataDir: target.dataDir, targetSourcePath: target.sourcePath, targetSourceHash: hash(sourceBytes),
    targetNotePath: target.notePath, targetNoteHash: hash(noteBytes), lockedTitle: previous.title,
    targetAssets: await assetBaseline(target.dataDir, priorSource),
    networkUsed: true,
    comparison: { previousReplyCount: priorSource.authorReplies?.length || 0, freshReplyCount: source.authorReplies?.length || 0 },
  };
  await save(path.join(jobDir, 'analysis.json'), repairAnalysisTemplate(source, previous, previous.title));
  await fs.writeFile(path.join(jobDir, 'agent_handoff.md'), '# Thread supplement\n\nEdit only analysis.json. Keep the existing title. Read every source post and retain exact prose/prompt text coverage. This source combines preserved snapshots with a verified supplied reply. Validate, review preview, then finalize using the canonical tweetId. No network retry or manual source edit.\n', 'utf8');
  await save(jobPath, job);
  if (input.tweetId !== caseId) await save(path.join(root, '.runtime', input.tweetId, 'job.json'), { tweetId: input.tweetId, caseId, status: 'delegated', jobPath });
  return { status: 'materials_ready', tweetId: caseId, caseId, inputTweetId: input.tweetId, operation: 'supplement', networkUsed: true, jobDir, jobPath, sourcePath: stagedSource, analysisPath: path.join(jobDir, 'analysis.json'), handoffPath: path.join(jobDir, 'agent_handoff.md'), warnings: [], partialMedia: (source.mediaFiles || []).some((item) => item.status !== 'downloaded'), authorRepliesStatus: source.completeness?.authorRepliesStatus };
}

export async function redirectNewJob(root, input, caseDir, source) {
  const caseId = String(source.rootTweet.id);
  if (caseId === input.tweetId) return { caseDir, jobDir: path.join(root, '.runtime', caseId) };
  const jobDir = path.join(root, '.runtime', caseId), targetDir = path.join(root, 'notes', 'x', '00-待整理', caseId);
  if (await exists(jobDir) || await exists(targetDir)) throw new Error('Canonical staging/runtime already exists; do not replace it');
  await fs.rename(caseDir, targetDir);
  await fs.rename(path.join(root, '.runtime', input.tweetId), jobDir);
  await fs.mkdir(path.join(root, '.runtime', input.tweetId));
  await save(path.join(root, '.runtime', input.tweetId, 'job.json'), { tweetId: input.tweetId, caseId, status: 'delegated', jobPath: path.join(jobDir, 'job.json') });
  return { caseDir: targetDir, jobDir };
}

async function baselineCase(root, record, excluded = []) {
  const sourceBytes = await fs.readFile(record.sourcePath), noteBytes = await fs.readFile(record.notePath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const jobDir = path.join(root, '.runtime', record.tweetId);
  const job = await json(path.join(jobDir, 'job.json'));
  if (job.status !== 'note_ready') throw new Error('Case has an unfinished workflow');
  const analysis = await json(path.join(jobDir, 'analysis.json'));
  const rendered = await renderCase({ ...job, mode: 'repair', lockedTitle: analysis.title, caseDir: record.dataDir, sourcePath: record.sourcePath, sourceHash: hash(sourceBytes), targetDataDir: record.dataDir, retireCases: excluded }, analysis, root);
  if (rendered.markdown !== noteBytes.toString('utf8')) throw new Error('Case has personal edits or renderer drift; merge must not overwrite it');
  return { source, analysis, sourceHash: hash(sourceBytes), noteHash: hash(noteBytes), assets: await assetBaseline(record.dataDir, source) };
}

async function checkPathBacklinks(root, notePath) {
  const settings = await json(path.join(root, 'config', 'local.json'));
  const oldVaultPath = path.relative(settings.vault_root, path.join(settings.vault_root, settings.notes_subdir, path.relative(path.join(root, 'notes', 'x'), notePath))).replaceAll('\\', '/').replace(/\.md$/, '');
  const oldName = path.basename(notePath, '.md');
  const hits = [], visited = new Set();
  async function scan(dir) {
    const real = await fs.realpath(dir);
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (await fs.realpath(file) === await fs.realpath(path.join(root, 'notes', 'x'))) await scan(file);
      } else if (entry.isDirectory()) await scan(file);
      else if (entry.name.toLowerCase().endsWith('.md') && path.basename(file) !== path.basename(notePath)) {
        const text = await fs.readFile(file, 'utf8');
        for (const match of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
          const value = match[1].replaceAll('\\', '/').replace(/\.md$/, '');
          if (value.includes('/') && (value === oldVaultPath || value.endsWith('/' + oldName))) hits.push(file);
        }
        if (text.includes(encodeURIComponent(oldName) + '.md') || text.includes(oldVaultPath + '.md')) hits.push(file);
      }
    }
  }
  await scan(settings.vault_root);
  if (hits.length) throw new Error('Path-qualified backlinks require manual compatibility review: ' + [...new Set(hits)].join(', '));
}

export async function mergeThreadCases(root, canonicalId, retiredId, { dryRun = false } = {}) {
  if (!/^\d+$/.test(canonicalId || '') || !/^\d+$/.test(retiredId || '') || canonicalId === retiredId) throw new Error('Provide two different numeric case IDs');
  const target = await resolveFinalizedCase(root, canonicalId), retired = await resolveFinalizedCase(root, retiredId);
  if (!target || !retired || target.layoutVersion !== 2 || retired.layoutVersion !== 2) throw new Error('Merge requires two unique finalized Layout V2 cases');
  const current = await baselineCase(root, target, [retired]);
  const older = await baselineCase(root, retired, [target]);
  if (current.source.caseIdentity?.mode === 'standalone' || older.source.caseIdentity?.mode === 'standalone') throw new Error('Explicit standalone cases cannot be merged automatically');
  if (String(current.source.rootTweet.author.id) !== String(older.source.rootTweet.author.id)) throw new Error('Merge author identity mismatch');
  const tweets = new Map(tweetList(current.source).map((tweet) => [String(tweet.id), tweet]));
  for (const tweet of tweetList(older.source)) {
    const existing = tweets.get(String(tweet.id));
    if (existing) {
      if (existing.text !== tweet.text || String(existing.inReplyTo?.tweetId || '') !== String(tweet.inReplyTo?.tweetId || '')) throw new Error('Conflicting author text/parent snapshot for ' + tweet.id);
      for (const link of tweet.linkEntities || []) if (!(existing.linkEntities || []).some((item) => item.type === link.type && item.token === link.token && item.target === link.target && (link.start == null || (item.start === link.start && item.end === link.end)))) throw new Error('Merge would lose source links');
      if (tweet.article && JSON.stringify(existing.article) !== JSON.stringify(tweet.article)) throw new Error('Article snapshots differ; explicit repair/review is required before merge');
    } else tweets.set(String(tweet.id), tweet);
  }
  const relationshipNodes = mergeRelationshipNodes(current.source.relationshipNodes || [], older.source.relationshipNodes || []);
  const ordered = orderAuthorTweets(current.source.rootTweet, [...tweets.values()], relationshipNodes);
  await checkPathBacklinks(root, retired.notePath);
  const alias = path.basename(retired.notePath, '.md');
  const proposal = { status: 'merge_preview', caseId: canonicalId, retiredId, notePath: target.notePath, archiveRoot: path.join(root, '.archive', 'x-cases'), authorPostIds: ordered.map((tweet) => String(tweet.id)), alias, networkUsed: false };
  if (dryRun) return proposal;
  const jobDir = path.join(root, '.runtime', canonicalId), repairDir = path.join(jobDir, 'operations', randomUUID());
  const beforeDir = path.join(repairDir, 'before'), caseDir = path.join(repairDir, 'case');
  await fs.mkdir(beforeDir, { recursive: true }); await fs.mkdir(caseDir);
  await fs.copyFile(target.sourcePath, path.join(beforeDir, 'source.json'));
  await fs.copyFile(target.notePath, path.join(beforeDir, path.basename(target.notePath)));
  await save(path.join(beforeDir, 'analysis.json'), current.analysis, true);
  const source = structuredClone(current.source);
  source.authorReplies = ordered.slice(1);
  source.relationshipNodes = relationshipNodes;
  const related = new Map();
  for (const tweet of [...(current.source.relatedPosts || []), ...(older.source.relatedPosts || [])]) {
    if (related.has(String(tweet.id)) && JSON.stringify(related.get(String(tweet.id))) !== JSON.stringify(tweet)) throw new Error('Conflicting related post snapshots');
    related.set(String(tweet.id), tweet);
  }
  source.relatedPosts = [...related.values()].filter(tweet => !tweets.has(String(tweet.id)));
  validateRelatedPosts(source);
  source.caseIdentity = { ...(source.caseIdentity || {}), mode: 'thread', caseId: canonicalId };
  source.capturedAt = new Date().toISOString();
  source.acquisition = { ...source.acquisition, snapshots: [...(source.acquisition?.snapshots || [{ sourceHash: current.sourceHash, capturedAt: current.source.capturedAt, tweetIds: tweetList(current.source).map((tweet) => String(tweet.id)) }]), { sourceHash: older.sourceHash, capturedAt: older.source.capturedAt, tweetIds: tweetList(older.source).map((tweet) => String(tweet.id)) }] };
  const records = [];
  for (const [record, snapshot] of [[target, current.source], [retired, older.source]]) {
    for (const media of snapshot.mediaFiles || []) {
      if (media.status !== 'downloaded') throw new Error('Merge requires complete materialized media');
      const from = await safePath(record.dataDir, path.resolve(record.dataDir, media.localPath));
      const bytes = await fs.readFile(from);
      if (bytes.length !== media.bytes) throw new Error('Merge media size mismatch');
      const prior = records.find((item) => String(item.tweetId) === String(media.tweetId) && item.type === media.type && item.remoteUrl === media.remoteUrl);
      if (prior) {
        if (hash(await fs.readFile(path.join(caseDir, prior.localPath))) !== hash(bytes)) throw new Error('Same media resource has different saved bytes');
        continue;
      }
      let localPath = media.localPath;
      if (await exists(path.join(caseDir, localPath))) localPath = 'media/' + record.tweetId + '_' + path.basename(localPath);
      await fs.mkdir(path.dirname(path.join(caseDir, localPath)), { recursive: true });
      await fs.writeFile(path.join(caseDir, localPath), bytes, { flag: 'wx' });
      records.push({ ...media, localPath, contentHash: hash(bytes) });
    }
    for (const tweet of tweetList(snapshot)) for (const document of tweet.article?.documents || []) {
      if (document.status !== 'written') throw new Error('Merge requires complete documents');
      const from = await safePath(record.dataDir, path.resolve(record.dataDir, document.localPath));
      const to = path.join(caseDir, document.localPath);
      const bytes = await fs.readFile(from);
      if (await exists(to)) { if (hash(await fs.readFile(to)) !== hash(bytes)) throw new Error('Conflicting document bytes'); }
      else { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.writeFile(to, bytes, { flag: 'wx' }); }
    }
  }
  source.mediaFiles = records;
  const sourcePath = path.join(caseDir, 'source.json'); await save(sourcePath, source, true);
  const priorPosts = new Map([...(older.analysis.posts || []), ...current.analysis.posts].map((post) => [String(post.id), post]));
  const analysis = repairAnalysisTemplate(source, { ...current.analysis, posts: [...priorPosts.values()] }, current.analysis.title);
  analysis.aliases = [...new Set([...(analysis.aliases || []), alias])];
  const archiveDir = path.join(root, '.archive', 'x-cases', path.basename(repairDir), retiredId);
  const retirement = { tweetId: retiredId, dataDir: retired.dataDir, sourcePath: retired.sourcePath, notePath: retired.notePath, sourceHash: older.sourceHash, noteHash: older.noteHash, assets: older.assets, archiveDir };
  const job = { tweetId: canonicalId, caseId: canonicalId, inputTweetId: canonicalId, mode: 'repair', operation: 'merge', networkUsed: false, status: 'materials_ready', repairDir, beforeDir, caseDir, sourcePath, sourceHash: hash(await fs.readFile(sourcePath)), targetDataDir: target.dataDir, targetSourcePath: target.sourcePath, targetSourceHash: current.sourceHash, targetNotePath: target.notePath, targetNoteHash: current.noteHash, targetAssets: current.assets, lockedTitle: analysis.title, retireCases: [retirement] };
  await save(path.join(jobDir, 'analysis.json'), analysis); await save(path.join(jobDir, 'job.json'), job);
  await fs.writeFile(path.join(jobDir, 'agent_handoff.md'), '# Thread merge\n\nNo network work. Keep the canonical title. Review analysis/source and both snapshots under before/archive. Validate then finalize; retirement occurs only after publication verifies. Original Prompt must remain exact.\n', 'utf8');
  return { ...proposal, status: 'materials_ready', tweetId: canonicalId, operation: 'merge', jobPath: path.join(jobDir, 'job.json'), sourcePath, analysisPath: path.join(jobDir, 'analysis.json'), handoffPath: path.join(jobDir, 'agent_handoff.md') };
}

// Explicitly adopt an approved reading-layer review; never infer approval or erase personal edits.
export async function adoptReviewedCase(root, id, manifestFile, { dryRun = false } = {}) {
  if (!/^\d+$/.test(id || '')) throw new Error('Provide a numeric case ID');
  const manifestPath = await safePath(path.join(root, '.runtime'), path.resolve(root, manifestFile));
  const manifest = await json(manifestPath);
  const target = await resolveFinalizedCase(root, id);
  if (!target || target.layoutVersion !== 2) throw new Error('Adoption requires a unique finalized Layout V2 target');
  const sourceBytes = await fs.readFile(target.sourcePath), noteBytes = await fs.readFile(target.notePath);
  if (hash(sourceBytes) !== manifest.expectedSourceHash || hash(noteBytes) !== manifest.expectedNoteHash) throw new Error('Approved source/note hash changed; review must be renewed');
  const sourcePath = await safePath(path.join(root, '.runtime'), path.resolve(root, manifest.sourcePath));
  const analysisPath = await safePath(path.join(root, '.runtime'), path.resolve(root, manifest.analysisPath));
  const stagedBytes = await fs.readFile(sourcePath), analysisBytes = await fs.readFile(analysisPath);
  if (hash(stagedBytes) !== manifest.stagedSourceHash || hash(analysisBytes) !== manifest.analysisHash) throw new Error('Reviewed candidate changed');
  const source = JSON.parse(stagedBytes.toString('utf8')), analysis = JSON.parse(analysisBytes.toString('utf8')), previous = JSON.parse(sourceBytes.toString('utf8'));
  if (String(source.rootTweet?.id) !== id || String(source.rootTweet.author?.id) !== String(previous.rootTweet.author?.id)) throw new Error('Reviewed case identity mismatch');
  const reasons = repairRegressions(previous, source);
  if (reasons.length) throw new Error('Reviewed adoption would regress data: ' + reasons.join('; '));
  const title = (await json(path.join(root, '.runtime', id, 'analysis.json'))).title;
  if (analysis.title !== title) throw new Error('Reviewed adoption must retain the title');
  const existingJob = await json(path.join(root, '.runtime', id, 'job.json'));
  if (existingJob.status !== 'note_ready') throw new Error('Target has an unfinished operation');
  const retireCases = [];
  for (const item of manifest.retireCases || []) {
    if (!/^\d+$/.test(item.tweetId || '') || item.tweetId === id) throw new Error('Invalid retirement identity');
    const dataDir = await safePath(path.join(root, 'notes', 'x', '_case-data'), path.join(root, 'notes', 'x', '_case-data', item.tweetId));
    const oldSourcePath = path.join(dataDir, 'source.json'), oldSourceBytes = await fs.readFile(oldSourcePath);
    const oldNotePath = await safePath(root, path.resolve(root, item.notePath)), oldNoteBytes = await fs.readFile(oldNotePath);
    if (hash(oldSourceBytes) !== item.sourceHash || hash(oldNoteBytes) !== item.noteHash) throw new Error('Retiring reviewed snapshot changed');
    const oldSource = JSON.parse(oldSourceBytes.toString('utf8'));
    if (String(oldSource.rootTweet?.author?.id) !== String(source.rootTweet.author.id) || oldSource.caseIdentity?.mode === 'standalone') throw new Error('Retirement author/standalone policy mismatch');
    if (String(oldSource.rootTweet?.id) !== item.tweetId || repairRegressions(oldSource, source).length) throw new Error('Retirement would lose original case content');
    await checkPathBacklinks(root, oldNotePath);
    retireCases.push({ ...item, dataDir, sourcePath: oldSourcePath, notePath: oldNotePath, assets: await assetBaseline(dataDir, oldSource) });
  }
  const targetAssets = await assetBaseline(target.dataDir, previous);
  for (const asset of manifest.expectedAssets || []) {
    const file = await safePath(target.dataDir, path.resolve(target.dataDir, asset.relative));
    if (hash(await fs.readFile(file)) !== asset.hash) throw new Error('Approved media asset changed');
    const candidateFile = await safePath(path.dirname(sourcePath), path.resolve(path.dirname(sourcePath), asset.relative));
    if (!source.mediaFiles.some(item => item.localPath === asset.relative && item.status === 'downloaded') || hash(await fs.readFile(candidateFile)) !== asset.hash) throw new Error('Reviewed candidate must preserve approved media assets');
    if (!targetAssets.some(item => item.relative === asset.relative)) targetAssets.push(asset);
  }
  const preflight = { tweetId: id, mode: 'repair', caseDir: path.dirname(sourcePath), sourcePath, sourceHash: hash(stagedBytes), lockedTitle: title, targetDataDir: target.dataDir, retireCases };
  const rendered = await renderCase(preflight, analysis, root);
  const proposal = { status: 'review_adoption_preview', caseId: id, notePath: target.notePath, authorPostIds: tweetList(source).map(tweet => String(tweet.id)), relatedPostIds: (source.relatedPosts || []).map(tweet => String(tweet.id)), mediaCount: source.mediaFiles.length, networkUsed: false };
  if (dryRun) return proposal;
  const jobDir = path.join(root, '.runtime', id), repairDir = path.join(jobDir, 'operations', randomUUID()), beforeDir = path.join(repairDir, 'before'), caseDir = path.join(repairDir, 'case');
  await fs.mkdir(beforeDir, { recursive: true }); await fs.mkdir(caseDir);
  await fs.writeFile(path.join(beforeDir, 'source.json'), sourceBytes, { flag: 'wx' });
  await fs.writeFile(path.join(beforeDir, path.basename(target.notePath)), noteBytes, { flag: 'wx' });
  await fs.copyFile(path.join(jobDir, 'analysis.json'), path.join(beforeDir, 'analysis.json'));
  await fs.copyFile(manifestPath, path.join(repairDir, 'approved-review.json'));
  const stagedSourcePath = path.join(caseDir, 'source.json'); await fs.writeFile(stagedSourcePath, stagedBytes, { flag: 'wx' });
  for (const asset of [...source.mediaFiles.filter(item => item.status === 'downloaded'), ...sourcePosts(source).flatMap(tweet => tweet.article?.documents || []).filter(item => item.status === 'written')]) {
    const from = await safePath(path.dirname(sourcePath), path.resolve(path.dirname(sourcePath), asset.localPath));
    const to = inside(caseDir, path.resolve(caseDir, asset.localPath));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await safePath(caseDir, path.dirname(to)); await fs.copyFile(from, to);
  }
  for (const item of retireCases) item.archiveDir = path.join(root, '.archive', 'x-cases', path.basename(repairDir), item.tweetId);
  const job = { ...preflight, caseDir, sourcePath: stagedSourcePath, caseId: id, inputTweetId: id, operation: 'adopt-reviewed', status: 'materials_ready', networkUsed: false, repairDir, beforeDir, targetSourcePath: target.sourcePath, targetSourceHash: hash(sourceBytes), targetNotePath: target.notePath, targetNoteHash: hash(noteBytes), targetAssets, retireCases };
  await save(path.join(jobDir, 'analysis.json'), analysis); await save(path.join(jobDir, 'job.json'), job);
  await fs.writeFile(path.join(repairDir, 'reviewed-preview.md'), rendered.markdown, 'utf8');
  return { ...proposal, status: 'materials_ready', tweetId: id, operation: 'adopt-reviewed', sourcePath: stagedSourcePath, analysisPath: path.join(jobDir, 'analysis.json') };
}
