import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function withWorkflowLock(root, action) {
  const runtime = path.join(root, '.runtime');
  await fs.mkdir(runtime, { recursive: true });
  const file = path.join(runtime, 'command-lock.json');
  const lock = { token: randomUUID(), pid: process.pid, startedAt: new Date().toISOString() };
  try { await fs.writeFile(file, JSON.stringify(lock), { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'action_required', actions: ['Project command lock exists. Inspect .runtime/command-lock.json; do not expire or remove it automatically.'] }; throw error; }
  try { return await action(); }
  finally {
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    if (current.token !== lock.token) throw new Error('Command lock ownership changed');
    const history = path.join(runtime, 'locks');
    await fs.mkdir(history, { recursive: true });
    await fs.rename(file, path.join(history, lock.token + '.json'));
  }
}

export async function recoverCommandLock(root, token) {
  const file = path.join(root, '.runtime', 'command-lock.json');
  const lock = JSON.parse(await fs.readFile(file, 'utf8'));
  if (lock.token !== token) throw new Error('Provide the inspected lock token');
  try { process.kill(lock.pid, 0); throw new Error('Lock process is still running; recovery refused'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  const history = path.join(root, '.runtime', 'locks');
  await fs.mkdir(history, { recursive: true });
  await fs.rename(file, path.join(history, lock.token + '-recovered.json'));
  return { status: 'lock_recovered', actions: ['Inspect unfinished case publication before any new acquisition; lock recovery never retries network work.'] };
}
