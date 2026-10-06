import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, safePath } from './x-case-core.mjs';
import {
  initBatchFromText,
  batchStatus,
  nextBatchItem,
  recordBatchItem,
  resumeBatch,
} from './x-batch-core.mjs';

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function usage() {
  return {
    status: 'action_required',
    actions: [
      'Usage: node scripts/run-x-batch.mjs init <project-relative-input.txt> [--batch-id <id>] [--wave-size 1-5] | status <batch-id> | next <batch-id> | record <batch-id> <tweet-id> | resume <batch-id> [--wave-size 1-5]',
    ],
  };
}

export async function main(args) {
  const [command, ...rest] = args;

  if (command === 'init' && rest.length >= 1) {
    const inputArg = rest[0];
    const inputPath = path.resolve(projectRoot, inputArg);
    await safePath(projectRoot, inputPath);
    const text = await fs.readFile(inputPath, 'utf8');
    return initBatchFromText(text, {
      batchId: flagValue(rest, '--batch-id') || undefined,
      waveSize: flagValue(rest, '--wave-size') || undefined,
    });
  }

  if (command === 'status' && rest.length === 1) return batchStatus(rest[0]);
  if (command === 'next' && rest.length === 1) return nextBatchItem(rest[0]);
  if (command === 'record' && rest.length === 2) return recordBatchItem(rest[0], rest[1]);

  if (command === 'resume' && rest.length >= 1) {
    return resumeBatch(rest[0], {
      waveSize: flagValue(rest, '--wave-size') || undefined,
    });
  }

  return usage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (['failed', 'action_required'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    const actionRequired = error?.code === 'BATCH_ACCOUNT_SESSION_FORBIDDEN';
    console.log(JSON.stringify({
      status: actionRequired ? 'action_required' : 'failed',
      message: error.message,
      code: error.code || null,
    }, null, 2));
    process.exitCode = 1;
  }
}
