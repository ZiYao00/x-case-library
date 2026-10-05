import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, onboarding, prepare, validate, loadJob, renderCase, save, exists } from './x-case-core.mjs';
import { finalizeDir } from './finalize-case.mjs';

export async function finalize(id, root = projectRoot) {
  const loaded = await loadJob(id, root);
  if (loaded.job.status === 'note_ready') {
    if (!await exists(loaded.job.notePath)) throw new Error('Published note is missing');
    return { status: 'note_ready', tweetId: id, notePath: loaded.job.notePath, alreadyCompleted: true };
  }
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
  if (command === 'validate' && rest.length === 1) return validate(rest[0]);
  if (command === 'finalize' && rest.length === 1) return finalize(rest[0]);
  return { status: 'action_required', actions: ['Usage: node scripts/run-x-case.mjs onboarding | prepare "<message with one post URL>" | validate <tweet-id> | finalize <tweet-id>'] };
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
