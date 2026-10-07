import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, onboarding, prepare, repairPrepare, validate, loadJob, renderCase, save, exists, hash, json, safePath, inside } from './x-case-core.mjs';
import { finalizeDir } from './finalize-case.mjs';
import { resolveFinalizedCase } from './case-layout.mjs';
import { mergeThreadCases, adoptReviewedCase } from './thread-update.mjs';
import { withWorkflowLock, recoverCommandLock } from './workflow-lock.mjs';
import { memberCases } from './thread-identity.mjs';

async function restoreRepairBackups(job, createdMedia = [], createdDocuments = [], root = projectRoot) {
  const targetDataDir = job.targetDataDir || job.targetCaseDir;
  for (const name of createdMedia) {
    const candidate = path.join(targetDataDir, 'media', path.basename(name));
    if (await exists(candidate)) {
      const archive = path.join(job.repairDir, 'rolled-back-created', 'media');
      await fs.mkdir(archive, { recursive: true }); await fs.rename(candidate, path.join(archive, path.basename(name)));
    }
  }
  for (const name of createdDocuments) {
    const candidate = path.join(targetDataDir, 'documents', path.basename(name));
    if (await exists(candidate)) {
      const archive = path.join(job.repairDir, 'rolled-back-created', 'documents');
      await fs.mkdir(archive, { recursive: true }); await fs.rename(candidate, path.join(archive, path.basename(name)));
    }
  }
  const sourceBackup = path.join(job.beforeDir, 'source.json');
  const noteBackup = path.join(job.beforeDir, path.basename(job.targetNotePath));
  if (await exists(sourceBackup)) await fs.copyFile(sourceBackup, job.targetSourcePath);
  if (await exists(noteBackup)) await fs.copyFile(noteBackup, job.targetNotePath);
  for (const folder of ['media', 'documents']) {
    const backupDir = path.join(job.beforeDir, folder);
    if (!await exists(backupDir)) continue;
    const targetDir = path.join(targetDataDir, folder);
    await fs.mkdir(targetDir, { recursive: true });
    for (const entry of await fs.readdir(backupDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      await fs.copyFile(path.join(backupDir, entry.name), path.join(targetDir, entry.name));
    }
  }
  for (const item of job.retireCases || []) {
    const archivedNote = path.join(item.archiveDir, path.basename(item.notePath));
    const archivedData = path.join(item.archiveDir, 'data');
    if (await exists(archivedNote)) {
      if (await exists(item.notePath)) throw new Error('Retired note was recreated; recovery refused');
      await fs.rename(archivedNote, item.notePath);
    }
    if (await exists(archivedData)) {
      if (await exists(item.dataDir)) throw new Error('Retired data was recreated; recovery refused');
      await fs.rename(archivedData, item.dataDir);
    }
    const receiptBackup = path.join(job.beforeDir, item.tweetId + '-job.json');
    if (await exists(receiptBackup)) await fs.copyFile(receiptBackup, path.join(root, '.runtime', item.tweetId, 'job.json'));
  }
}

async function delegateRetiredCases(job, id, root) {
  for (const item of job.retireCases || []) {
    const jobDir = path.join(root, '.runtime', item.tweetId);
    await fs.mkdir(jobDir, { recursive: true });
    await save(path.join(jobDir, 'job.json'), { tweetId: item.tweetId, caseId: id, status: 'delegated', jobPath: path.join(root, '.runtime', id, 'job.json') });
  }
}

async function writeJournal(file, value) {
  const temporary = file + '.next';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temporary, file);
}

export async function recoverPublication(id, root = projectRoot, seen = new Set()) {
  if (!/^\d+$/.test(id || '')) throw new Error('Provide a numeric case ID');
  if (seen.has(id)) throw new Error('Recovery delegation cycle');
  seen.add(id);
  const rawJobDir = path.join(root, '.runtime', id), rawJob = await json(path.join(rawJobDir, 'job.json'));
  if (rawJob.status === 'delegated') {
    if (!/^\d+$/.test(rawJob.caseId || '') || rawJob.caseId === id) throw new Error('Invalid recovery receipt');
    return recoverPublication(rawJob.caseId, root, seen);
  }
  if (rawJob.mode !== 'repair' && rawJob.status !== 'note_ready') {
    const journalPath = path.join(rawJobDir, 'create-publication.json'), plan = await json(journalPath);
    for (const candidate of [plan.dataDir, plan.notePath, plan.stagingDir, plan.sourcePath]) inside(path.join(root, 'notes', 'x'), candidate);
    if (path.resolve(plan.sourcePath) !== path.join(plan.dataDir, 'source.json') || path.basename(plan.stagingMarkdown) !== plan.stagingMarkdown) throw new Error('Invalid new-case journal paths');
    if (String(plan.tweetId) !== id || plan.sourceHash !== rawJob.sourceHash) throw new Error('New-case recovery identity/hash mismatch');
    if (plan.state === 'rolled_back' || (await exists(plan.stagingDir) && !await exists(plan.dataDir))) {
      await fs.rename(journalPath, path.join(rawJobDir, 'create-publication-reviewed-' + Date.now() + '.json'));
      return { status: 'staging_preserved', actions: ['Staging is intact. Review preview before a new explicit finalize; no network is started.'] };
    }
    if (await exists(plan.stagingDir) || !await exists(plan.dataDir)) throw new Error('Ambiguous new-case recovery paths');
    await safePath(path.join(root, 'notes', 'x'), plan.dataDir);
    if (hash(await fs.readFile(plan.sourcePath)) !== plan.sourceHash) throw new Error('New-case source changed during interrupted publication');
    const completed = { ...rawJob, caseDir: plan.dataDir, dataDir: plan.dataDir, sourcePath: plan.sourcePath, notePath: plan.notePath, status: 'note_ready' };
    const rendered = await renderCase(completed, await json(path.join(rawJobDir, 'analysis.json')), root);
    if (hash(rendered.markdown) !== plan.noteHash) throw new Error('New-case recovery no longer reproduces the validated note');
    if (!await exists(plan.notePath)) {
      const stagedNote = path.join(plan.dataDir, plan.stagingMarkdown);
      if (hash(await fs.readFile(stagedNote)) !== plan.noteHash) throw new Error('New-case note changed during interrupted publication');
      await fs.rename(stagedNote, plan.notePath);
    }
    if (hash(await fs.readFile(plan.notePath)) !== plan.noteHash) throw new Error('New-case target note was modified; recovery refused');
    const resolved = await resolveFinalizedCase(root, id);
    if (!resolved) throw new Error('Recovered case is not uniquely readable');
    await save(path.join(rawJobDir, 'job.json'), completed);
    await writeJournal(journalPath, { ...plan, state: 'complete' });
    return { status: 'note_ready', recovered: true, notePath: plan.notePath };
  }
  const loaded = await loadJob(id, root), job = loaded.job;
  if (job.status === 'note_ready') return { status: 'note_ready', alreadyCompleted: true, notePath: job.notePath };
  if (job.mode !== 'repair') throw new Error('Inspect unfinished new-case staging before recovery; no network is started');
  const file = path.join(job.repairDir, 'publication.json');
  const journal = JSON.parse(await fs.readFile(file, 'utf8'));
  if (journal.state === 'rolled_back') return { status: 'publication_rolled_back', alreadyRecovered: true };
  if (journal.state === 'complete') {
    if (hash(await fs.readFile(job.targetSourcePath)) !== job.sourceHash || hash(await fs.readFile(job.targetNotePath)) !== journal.newNoteHash) throw new Error('Completed publication changed; recovery refused');
    const completed = { ...job, status: 'note_ready', mode: 'repair-complete', sourcePath: job.targetSourcePath, caseDir: job.targetDataDir || job.targetCaseDir, notePath: job.targetNotePath };
    if (hash((await renderCase(completed, loaded.analysis, root)).markdown) !== journal.newNoteHash) throw new Error('Completed publication assets/analysis no longer validate');
    await save(path.join(loaded.jobDir, 'job.json'), completed);
    await delegateRetiredCases(job, id, root);
    return { status: 'note_ready', recovered: true, notePath: job.targetNotePath };
  }
  const currentSource = hash(await fs.readFile(job.targetSourcePath)), currentNote = hash(await fs.readFile(job.targetNotePath));
  if (![job.targetSourceHash, job.sourceHash].includes(currentSource) || ![job.targetNoteHash, journal.newNoteHash].includes(currentNote)) throw new Error('Publication has unknown/user-modified bytes; recovery requires inspection');
  for (const asset of journal.assets) {
    const file = path.join(job.targetDataDir || job.targetCaseDir, asset.relative);
    if (await exists(file)) {
      const actual = hash(await fs.readFile(file));
      if (actual !== asset.newHash && actual !== asset.oldHash) throw new Error('Publication asset was modified; recovery refused');
    }
  }
  await restoreRepairBackups(job, journal.createdMedia, journal.createdDocuments, root);
  await writeJournal(file, { ...journal, state: 'rolled_back' });
  await save(path.join(loaded.jobDir, 'job.json'), { ...job, status: 'recovery_required' });
  return { status: 'publication_rolled_back', actions: ['Old formal case restored. Inspect this operation before preparing a new update; no automatic retry.'] };
}

async function finalizeRepair(loaded, id, root) {
  const { job, analysis, jobDir } = loaded;
  if (job.status !== 'validated') throw new Error('Run validate before finalizing a repair');
  const environment = await onboarding(root);
  if (environment.status !== 'ready') return environment;

  const rendered = await renderCase(job, analysis, root);
  const currentSourceBytes = await fs.readFile(job.targetSourcePath);
  const currentNoteBytes = await fs.readFile(job.targetNotePath);
  if (hash(currentSourceBytes) !== job.targetSourceHash) throw new Error('Formal source.json changed after repair prepare; refuse to overwrite');
  if (hash(currentNoteBytes) !== job.targetNoteHash) throw new Error('Formal Markdown changed after repair prepare; refuse to overwrite');

  const stagedSourceBytes = await fs.readFile(job.sourcePath);
  if (hash(stagedSourceBytes) !== job.sourceHash) throw new Error('Repair source changed after prepare');
  const freshSource = JSON.parse(stagedSourceBytes.toString('utf8'));

  const targetDataDir = job.targetDataDir || job.targetCaseDir;
  for (const asset of job.targetAssets || []) {
    const file = await safePath(targetDataDir, path.resolve(targetDataDir, asset.relative));
    if (hash(await fs.readFile(file)) !== asset.hash) throw new Error('Formal asset changed after update prepare; refuse to overwrite');
  }
  const stageMediaDir = path.join(job.caseDir, 'media');
  const targetMediaDir = path.join(targetDataDir, 'media');
  const beforeMediaDir = path.join(job.beforeDir, 'media');
  const stageDocumentsDir = path.join(job.caseDir, 'documents');
  const targetDocumentsDir = path.join(targetDataDir, 'documents');
  const beforeDocumentsDir = path.join(job.beforeDir, 'documents');
  const copiedMedia = [];
  const createdMedia = [];
  const copiedDocuments = [];
  const createdDocuments = [];
  const journalPath = path.join(job.repairDir, 'publication.json');
  if (await exists(journalPath)) throw new Error('Publication journal already exists; use explicit recover before another finalize');
  const assets = [];
  for (const folder of ['media', 'documents']) {
    const stage = path.join(job.caseDir, folder);
    if (!await exists(stage)) continue;
    for (const entry of await fs.readdir(stage, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error('Publication assets must be files');
      const relative = folder + '/' + entry.name, target = path.join(targetDataDir, relative);
      const oldHash = await exists(target) ? hash(await fs.readFile(target)) : null;
      assets.push({ relative, oldHash, newHash: hash(await fs.readFile(path.join(stage, entry.name))) });
      if (!oldHash) (folder === 'media' ? createdMedia : createdDocuments).push(entry.name);
    }
  }
  for (const item of job.retireCases || []) {
    if (hash(await fs.readFile(item.sourcePath)) !== item.sourceHash || hash(await fs.readFile(item.notePath)) !== item.noteHash) throw new Error('Retiring case changed after merge prepare');
    const receiptPath = path.join(root, '.runtime', item.tweetId, 'job.json');
    if (await exists(receiptPath)) await fs.copyFile(receiptPath, path.join(job.beforeDir, item.tweetId + '-job.json'));
    for (const asset of item.assets || []) if (hash(await fs.readFile(await safePath(item.dataDir, path.resolve(item.dataDir, asset.relative)))) !== asset.hash) throw new Error('Retiring asset changed after merge prepare');
  }
  const journal = { state: 'publishing', newNoteHash: hash(rendered.markdown), createdMedia, createdDocuments, assets };
  await writeJournal(journalPath, journal);

  try {
    await fs.mkdir(targetMediaDir, { recursive: true });
    if (await exists(stageMediaDir)) {
      for (const entry of await fs.readdir(stageMediaDir, { withFileTypes: true })) {
        if (!entry.isFile()) throw new Error('Repair media staging must contain files only');
        const sourceFile = path.join(stageMediaDir, entry.name);
        const targetFile = path.join(targetMediaDir, entry.name);
        const expected = assets.find((asset) => asset.relative === 'media/' + entry.name).oldHash;
        if ((await exists(targetFile) ? hash(await fs.readFile(targetFile)) : null) !== expected) throw new Error('Formal media changed during publication');
        if (await exists(targetFile)) {
          await fs.mkdir(beforeMediaDir, { recursive: true });
          const backupFile = path.join(beforeMediaDir, entry.name);
          if (!await exists(backupFile)) await fs.copyFile(targetFile, backupFile);
        }
        await fs.copyFile(sourceFile, targetFile);
        copiedMedia.push(entry.name);
      }
    }

    if (await exists(stageDocumentsDir)) {
      await fs.mkdir(targetDocumentsDir, { recursive: true });
      for (const entry of await fs.readdir(stageDocumentsDir, { withFileTypes: true })) {
        if (!entry.isFile()) throw new Error('Repair document staging must contain files only');
        const sourceFile = path.join(stageDocumentsDir, entry.name);
        const targetFile = path.join(targetDocumentsDir, entry.name);
        const expected = assets.find((asset) => asset.relative === 'documents/' + entry.name).oldHash;
        if ((await exists(targetFile) ? hash(await fs.readFile(targetFile)) : null) !== expected) throw new Error('Formal document changed during publication');
        if (await exists(targetFile)) {
          await fs.mkdir(beforeDocumentsDir, { recursive: true });
          const backupFile = path.join(beforeDocumentsDir, entry.name);
          if (!await exists(backupFile)) await fs.copyFile(targetFile, backupFile);
        }
        await fs.copyFile(sourceFile, targetFile);
        copiedDocuments.push(entry.name);
      }
    }

    if (hash(await fs.readFile(job.targetSourcePath)) !== job.targetSourceHash || hash(await fs.readFile(job.targetNotePath)) !== job.targetNoteHash) throw new Error('Formal case changed while copying assets; refuse replacement');
    await fs.writeFile(job.targetSourcePath, stagedSourceBytes);
    await fs.writeFile(job.targetNotePath, rendered.markdown, 'utf8');

    const completedJob = {
      ...job,
      mode: 'repair-complete',
      status: 'note_ready',
      caseDir: job.targetDataDir || job.targetCaseDir,
      sourcePath: job.targetSourcePath,
      sourceHash: hash(stagedSourceBytes),
      notePath: job.targetNotePath,
      repairedAt: new Date().toISOString(),
    };
    const verified = await renderCase({ ...completedJob, mode: 'repair' }, analysis, root);
    if (verified.markdown !== rendered.markdown) throw new Error('Repair verification rendered different Markdown after replacement');
    for (const item of job.retireCases || []) {
      if (hash(await fs.readFile(item.sourcePath)) !== item.sourceHash || hash(await fs.readFile(item.notePath)) !== item.noteHash) throw new Error('Retiring case changed during publication');
      for (const asset of item.assets || []) if (hash(await fs.readFile(await safePath(item.dataDir, path.resolve(item.dataDir, asset.relative)))) !== asset.hash) throw new Error('Retiring asset changed during publication');
      await fs.mkdir(item.archiveDir, { recursive: true });
      await fs.writeFile(path.join(item.archiveDir, 'retirement.json'), JSON.stringify({ ...item, canonicalId: id }, null, 2), { encoding: 'utf8', flag: 'wx' });
      await fs.rename(item.dataDir, path.join(item.archiveDir, 'data'));
      await fs.rename(item.notePath, path.join(item.archiveDir, path.basename(item.notePath)));
    }
    const published = await renderCase(completedJob, analysis, root);
    if (published.markdown !== rendered.markdown) throw new Error('Published case failed final media/link verification');

    const result = {
      status: 'note_ready',
      tweetId: id,
      repaired: true,
      notePath: job.targetNotePath,
      caseDir: job.targetDataDir || job.targetCaseDir,
      repairDir: job.repairDir,
      capture: rendered.capture,
      previousReplyCount: job.comparison?.previousReplyCount ?? null,
      authorReplyCount: (freshSource.authorReplies || []).length,
      copiedMedia,
      copiedDocuments,
      warnings: environment.warnings,
    };
    await save(path.join(job.repairDir, 'result.json'), result);
    await writeJournal(journalPath, { ...journal, state: 'complete' });
    await save(path.join(jobDir, 'job.json'), completedJob);
    await delegateRetiredCases(job, id, root);
    return result;
  } catch (error) {
    const sourceHash = hash(await fs.readFile(job.targetSourcePath)), noteHash = hash(await fs.readFile(job.targetNotePath));
    let assetsKnown = true;
    for (const asset of assets) {
      const file = path.join(targetDataDir, asset.relative);
      if (await exists(file) && ![asset.oldHash, asset.newHash].includes(hash(await fs.readFile(file)))) assetsKnown = false;
    }
    if (assetsKnown && [job.targetSourceHash, job.sourceHash].includes(sourceHash) && [job.targetNoteHash, journal.newNoteHash].includes(noteHash)) {
      await restoreRepairBackups(job, createdMedia, createdDocuments, root);
      await writeJournal(journalPath, { ...journal, state: 'rolled_back' });
      await save(path.join(jobDir, 'job.json'), { ...job, status: 'recovery_required' });
    }
    throw error;
  }
}

export async function finalize(id, root = projectRoot) {
  const memberships = await memberCases(root, id);
  if (memberships.length > 1) throw new Error('Overlapping case membership; inspect before finalize');
  if (memberships.length === 1 && memberships[0].caseId !== id) return finalize(memberships[0].caseId, root);
  const jobPath = path.join(root, '.runtime', id, 'job.json');
  if (!await exists(jobPath)) {
    const resolved = await resolveFinalizedCase(root, id);
    if (resolved) {
      return { status: 'note_ready', tweetId: id, notePath: resolved.notePath, caseDir: resolved.dataDir, alreadyCompleted: true, recoveredByTweetId: true };
    }
  }
  const loaded = await loadJob(id, root);
  id = loaded.job.tweetId;
  if (loaded.job.status === 'note_ready') {
    let notePath = loaded.job.notePath;
    let dataDir = loaded.job.dataDir || loaded.job.caseDir;
    if (!notePath || !await exists(notePath)) {
      const resolved = await resolveFinalizedCase(root, id);
      if (!resolved) throw new Error('Published note is missing');
      notePath = resolved.notePath;
      dataDir = resolved.dataDir;
      await save(path.join(loaded.jobDir, 'job.json'), {
        ...loaded.job,
        layoutVersion: resolved.layoutVersion,
        caseDir: dataDir,
        dataDir,
        sourcePath: resolved.sourcePath,
        notePath,
      });
    }
    return { status: 'note_ready', tweetId: id, notePath, caseDir: dataDir, repaired: loaded.job.mode === 'repair-complete', alreadyCompleted: true };
  }
  if (loaded.job.mode === 'repair') return finalizeRepair(loaded, id, root);

  const environment = await onboarding(root);
  if (environment.status !== 'ready') return environment;
  const rendered = await renderCase(loaded.job, loaded.analysis, root);
  const notePath = path.join(loaded.job.caseDir, 'case.md');
  const entries = (await fs.readdir(loaded.job.caseDir)).filter((name) => name.endsWith('.md'));
  if (entries.length && (entries.length !== 1 || entries[0] !== 'case.md' || await fs.readFile(notePath, 'utf8') !== rendered.markdown)) throw new Error('Existing Markdown differs; refuse to overwrite');
  if (!entries.length) await fs.writeFile(notePath, rendered.markdown, { encoding: 'utf8', flag: 'wx' });
  const result = await finalizeDir(loaded.job.caseDir, path.join(root, 'notes', 'x', '00-待整理'), { projectRoot: root, journalPath: path.join(loaded.jobDir, 'create-publication.json') });
  await save(path.join(loaded.jobDir, 'job.json'), { ...loaded.job, ...result, dataDir: result.dataDir, sourcePath: result.sourcePath, status: 'note_ready' });
  return { status: 'note_ready', ...result, capture: rendered.capture, warnings: environment.warnings };
}

export async function main(args) {
  const [command, ...rest] = args;
  if (['prepare', 'repair'].includes(command)) {
    const options = {}, message = rest.shift();
    while (rest.length) {
      const flag = rest.shift();
      if (flag === '--standalone' && command === 'prepare' && !options.standalone) options.standalone = true;
      else if (flag === '--candidates' && !options.candidates && rest.length) options.candidates = rest.shift();
      else throw new Error('Unknown or duplicate workflow option');
    }
    if (typeof message !== 'string') throw new Error('Provide one post URL');
    return command === 'prepare' ? prepare(message, projectRoot, undefined, options) : repairPrepare(message, projectRoot, undefined, options);
  }
  if (command === 'onboarding' && !rest.length) return onboarding();
  if (command === 'validate' && rest.length === 1) return validate(rest[0]);
  if (command === 'finalize' && rest.length === 1) return finalize(rest[0]);
  if (command === 'merge' && (rest.length === 2 || (rest.length === 3 && rest[2] === '--dry-run'))) return mergeThreadCases(projectRoot, rest[0], rest[1], { dryRun: rest.includes('--dry-run') });
  if (command === 'adopt-reviewed' && rest.length === 3 && ['--dry-run', '--apply'].includes(rest[2])) return adoptReviewedCase(projectRoot, rest[0], rest[1], { dryRun: rest[2] === '--dry-run' });
  if (command === 'recover' && rest.length === 1) return recoverPublication(rest[0]);
  if (command === 'recover-lock' && rest.length === 1) return recoverCommandLock(projectRoot, rest[0]);
  return { status: 'action_required', actions: ['Usage: onboarding | prepare "<one post URL>" [--standalone] [--candidates <JSON>] | repair "<one existing post URL>" [--candidates <JSON>] | validate <case-id> | finalize <case-id> | merge <canonical-id> <old-id> [--dry-run] | adopt-reviewed <case-id> <manifest> --dry-run|--apply | recover <case-id> | recover-lock <inspected-token>'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const result = args[0] === 'onboarding' || args[0] === 'recover-lock' || args.includes('--dry-run') ? await main(args) : await withWorkflowLock(projectRoot, () => main(args));
    console.log(JSON.stringify(result, null, 2));
    if (['failed', 'action_required'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: process.argv[2] === 'validate' || process.argv[2] === 'finalize' ? 'validation_failed' : 'failed', message: error.message }));
    process.exitCode = 1;
  }
}
