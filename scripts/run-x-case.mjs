import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, onboarding, prepare, repairPrepare, validate, loadJob, renderCase, save, exists, hash } from './x-case-core.mjs';
import { finalizeDir } from './finalize-case.mjs';

async function restoreRepairBackups(job) {
  const sourceBackup = path.join(job.beforeDir, 'source.json');
  const noteBackup = path.join(job.beforeDir, path.basename(job.targetNotePath));
  if (await exists(sourceBackup)) await fs.copyFile(sourceBackup, job.targetSourcePath);
  if (await exists(noteBackup)) await fs.copyFile(noteBackup, job.targetNotePath);
  const mediaBackupDir = path.join(job.beforeDir, 'media');
  if (await exists(mediaBackupDir)) {
    const targetMediaDir = path.join(job.targetCaseDir, 'media');
    await fs.mkdir(targetMediaDir, { recursive: true });
    for (const entry of await fs.readdir(mediaBackupDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      await fs.copyFile(path.join(mediaBackupDir, entry.name), path.join(targetMediaDir, entry.name));
    }
  }
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

  const stageMediaDir = path.join(job.caseDir, 'media');
  const targetMediaDir = path.join(job.targetCaseDir, 'media');
  const beforeMediaDir = path.join(job.beforeDir, 'media');
  const copiedMedia = [];

  try {
    await fs.mkdir(targetMediaDir, { recursive: true });
    if (await exists(stageMediaDir)) {
      for (const entry of await fs.readdir(stageMediaDir, { withFileTypes: true })) {
        if (!entry.isFile()) throw new Error('Repair media staging must contain files only');
        const sourceFile = path.join(stageMediaDir, entry.name);
        const targetFile = path.join(targetMediaDir, entry.name);
        if (await exists(targetFile)) {
          await fs.mkdir(beforeMediaDir, { recursive: true });
          const backupFile = path.join(beforeMediaDir, entry.name);
          if (!await exists(backupFile)) await fs.copyFile(targetFile, backupFile);
        }
        await fs.copyFile(sourceFile, targetFile);
        copiedMedia.push(entry.name);
      }
    }

    await fs.writeFile(job.targetSourcePath, stagedSourceBytes);
    await fs.writeFile(job.targetNotePath, rendered.markdown, 'utf8');

    const completedJob = {
      ...job,
      mode: 'repair-complete',
      status: 'note_ready',
      caseDir: job.targetCaseDir,
      sourcePath: job.targetSourcePath,
      sourceHash: hash(stagedSourceBytes),
      notePath: job.targetNotePath,
      repairedAt: new Date().toISOString(),
    };
    const verified = await renderCase(completedJob, analysis, root);
    if (verified.markdown !== rendered.markdown) throw new Error('Repair verification rendered different Markdown after replacement');

    const result = {
      status: 'note_ready',
      tweetId: id,
      repaired: true,
      notePath: job.targetNotePath,
      caseDir: job.targetCaseDir,
      repairDir: job.repairDir,
      capture: rendered.capture,
      previousReplyCount: job.comparison?.previousReplyCount ?? null,
      authorReplyCount: (freshSource.authorReplies || []).length,
      copiedMedia,
      warnings: environment.warnings,
    };
    await save(path.join(job.repairDir, 'result.json'), result);
    await save(path.join(jobDir, 'job.json'), completedJob);
    return result;
  } catch (error) {
    await restoreRepairBackups(job);
    throw error;
  }
}

export async function finalize(id, root = projectRoot) {
  const loaded = await loadJob(id, root);
  if (loaded.job.status === 'note_ready') {
    if (!await exists(loaded.job.notePath)) throw new Error('Published note is missing');
    return { status: 'note_ready', tweetId: id, notePath: loaded.job.notePath, repaired: loaded.job.mode === 'repair-complete', alreadyCompleted: true };
  }
  if (loaded.job.mode === 'repair') return finalizeRepair(loaded, id, root);

  const environment = await onboarding(root);
  if (environment.status !== 'ready') return environment;
  const rendered = await renderCase(loaded.job, loaded.analysis, root);
  const notePath = path.join(loaded.job.caseDir, 'case.md');
  const entries = (await fs.readdir(loaded.job.caseDir)).filter((name) => name.endsWith('.md'));
  if (entries.length && (entries.length !== 1 || entries[0] !== 'case.md' || await fs.readFile(notePath, 'utf8') !== rendered.markdown)) throw new Error('Existing Markdown differs; refuse to overwrite');
  if (!entries.length) await fs.writeFile(notePath, rendered.markdown, { encoding: 'utf8', flag: 'wx' });
  const result = await finalizeDir(loaded.job.caseDir, path.join(root, 'notes', 'x', '00-待整理'));
  await save(path.join(loaded.jobDir, 'job.json'), { ...loaded.job, ...result, sourcePath: path.join(result.caseDir, 'source.json'), status: 'note_ready' });
  return { status: 'note_ready', ...result, capture: rendered.capture, warnings: environment.warnings };
}

export async function main(args) {
  const [command, ...rest] = args;
  if (command === 'onboarding' && !rest.length) return onboarding();
  if (command === 'prepare' && rest.length === 1) return prepare(rest[0]);
  if (command === 'repair' && rest.length === 1) return repairPrepare(rest[0]);
  if (command === 'validate' && rest.length === 1) return validate(rest[0]);
  if (command === 'finalize' && rest.length === 1) return finalize(rest[0]);
  return { status: 'action_required', actions: ['Usage: node scripts/run-x-case.mjs onboarding | prepare "<message with one post URL>" | repair "<message with one existing post URL>" | validate <tweet-id> | finalize <tweet-id>'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (['failed', 'action_required'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: process.argv[2] === 'validate' || process.argv[2] === 'finalize' ? 'validation_failed' : 'failed', message: error.message }));
    process.exitCode = 1;
  }
}
