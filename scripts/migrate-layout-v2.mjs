import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataRoot, exists, findCaseRecords } from './case-layout.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const notes = path.join(projectRoot, 'notes', 'x');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const requested = new Set(args.filter((arg) => arg !== '--apply' && arg !== '--all'));
const all = args.includes('--all');

const hashFile = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function collectLegacyCases() {
  const found = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === '_case-data') continue;
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (path.dirname(full) === path.join(notes, '00-待整理') && /^\d+$/.test(entry.name)) continue;
      const sourcePath = path.join(full, 'source.json');
      if (await exists(sourcePath)) {
        const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
        const tweetId = String(source.rootTweet?.id || source.tweetId || '');
        const markdown = (await fs.readdir(full)).filter((name) => name.toLowerCase().endsWith('.md'));
        if (!tweetId || markdown.length !== 1) throw new Error('Legacy case must have Tweet ID and exactly one Markdown: ' + full);
        found.push({ tweetId, caseDir: full, sourcePath, notePath: path.join(full, markdown[0]) });
        continue;
      }
      await walk(full);
    }
  }
  await walk(notes);
  return found;
}

function migrationTargets(item) {
  return {
    dataDir: path.join(dataRoot(projectRoot), item.tweetId),
    notePath: path.join(path.dirname(item.caseDir), path.basename(item.notePath)),
  };
}

async function preflight(item) {
  const target = migrationTargets(item);
  if (await exists(target.dataDir)) throw new Error('Target data directory already exists: ' + target.dataDir);
  if (await exists(target.notePath)) throw new Error('Target Markdown already exists: ' + target.notePath);
  const sourceHash = await hashFile(item.sourcePath);
  const noteHash = await hashFile(item.notePath);
  return { ...item, ...target, sourceHash, noteHash };
}

async function migrate(item) {
  await fs.mkdir(path.dirname(item.dataDir), { recursive: true });
  let movedData = false;
  try {
    await fs.rename(item.caseDir, item.dataDir);
    movedData = true;
    const movedNote = path.join(item.dataDir, path.basename(item.notePath));
    await fs.rename(movedNote, item.notePath);
    if (await hashFile(path.join(item.dataDir, 'source.json')) !== item.sourceHash) throw new Error('Source hash changed during migration');
    if (await hashFile(item.notePath) !== item.noteHash) throw new Error('Markdown hash changed during migration');
    const resolved = await findCaseRecords(projectRoot, item.tweetId);
    const current = resolved.filter((record) => record.layoutVersion === 2 && record.finalized);
    if (current.length !== 1 || current[0].notePath !== item.notePath) throw new Error('V2 resolver verification failed');
  } catch (error) {
    if (movedData && await exists(item.dataDir) && !await exists(item.caseDir)) {
      if (await exists(item.notePath)) await fs.rename(item.notePath, path.join(item.dataDir, path.basename(item.notePath)));
      await fs.rename(item.dataDir, item.caseDir);
    }
    throw error;
  }
}

const legacy = await collectLegacyCases();
let selected = legacy;
if (!all) {
  if (!requested.size) {
    console.error('Usage: node scripts/migrate-layout-v2.mjs --all [--apply] | <tweet-id>... [--apply]');
    process.exit(2);
  }
  selected = legacy.filter((item) => requested.has(item.tweetId));
  for (const id of requested) if (!selected.some((item) => item.tweetId === id)) throw new Error('Requested legacy case not found: ' + id);
}

const plan = [];
for (const item of selected) plan.push(await preflight(item));
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  mode: apply ? 'apply' : 'dry-run',
  cases: plan.map((item) => ({
    tweetId: item.tweetId,
    from: path.relative(projectRoot, item.caseDir),
    dataDir: path.relative(projectRoot, item.dataDir),
    notePath: path.relative(projectRoot, item.notePath),
    sourceHash: item.sourceHash,
    noteHash: item.noteHash,
    status: apply ? 'pending' : 'planned',
  })),
};
const manifestDir = path.join(projectRoot, '.runtime', 'layout-v2-migrations');
await fs.mkdir(manifestDir, { recursive: true });
const manifestPath = path.join(manifestDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

if (apply) {
  for (let i = 0; i < plan.length; i++) {
    await migrate(plan[i]);
    manifest.cases[i].status = 'migrated';
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
}

console.log(JSON.stringify({ status: apply ? 'migrated' : 'dry_run', count: plan.length, manifestPath, cases: manifest.cases }, null, 2));
