import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot } from './case-layout.mjs';
import { createHash } from 'node:crypto';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(projectRoot, 'notes/x/00-待整理');
const requested = process.argv.slice(2);

function parseTitle(markdown) {
  const match = markdown.match(/^title:\s*(.+)$/m);
  if (!match) throw new Error('Missing frontmatter title');
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch {}
  }
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

function sanitizeName(input) {
  let name = String(input)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!name) name = 'Untitled';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) name = '_' + name;
  if (name.length > 120) name = name.slice(0, 120).replace(/[. ]+$/g, '');
  return name;
}

async function readTweetId(dir) {
  const source = JSON.parse(await fs.readFile(path.join(dir, 'source.json'), 'utf8'));
  return String(source?.rootTweet?.id || source?.tweetId || path.basename(dir));
}

async function accessExists(target) {
  try { await fs.access(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function finalizeDir(dir, inbox = root, options = {}) {
  if (path.dirname(path.resolve(dir)) !== path.resolve(inbox)) throw new Error('Case must be directly inside inbox');
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Case directory must not be a link');

  const entries = await fs.readdir(dir);
  const mdFiles = entries.filter((name) => name.toLowerCase().endsWith('.md'));
  if (mdFiles.length !== 1) throw new Error('Expected exactly one Markdown file in ' + dir);

  const oldMd = mdFiles[0];
  const markdown = await fs.readFile(path.join(dir, oldMd), 'utf8');
  const title = sanitizeName(parseTitle(markdown));
  const tweetId = await readTweetId(dir);
  const project = options.projectRoot || path.resolve(inbox, '..', '..', '..');
  const targetDataRoot = options.dataRoot || dataRoot(project);

  let targetName = title;
  let notePath = path.join(inbox, targetName + '.md');
  if (await accessExists(notePath)) {
    targetName = title + ' · ' + tweetId;
    notePath = path.join(inbox, targetName + '.md');
  }
  if (await accessExists(notePath)) throw new Error('Target Markdown already exists: ' + notePath);

  const dataDir = path.join(targetDataRoot, tweetId);
  if (await accessExists(dataDir)) throw new Error('Target case data already exists: ' + dataDir);
  const result = { tweetId, title, folder: targetName, markdown: targetName + '.md', layoutVersion: 2, dataDir, caseDir: dataDir, sourcePath: path.join(dataDir, 'source.json'), notePath };
  const journal = options.journalPath;
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const state = { ...result, state: 'publishing', stagingDir: dir, stagingMarkdown: oldMd, sourceHash: digest(await fs.readFile(path.join(dir, 'source.json'))), noteHash: digest(markdown) };
  async function record(value) {
    if (!journal) return;
    await fs.writeFile(journal + '.next', JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(journal + '.next', journal);
  }
  if (journal && await accessExists(journal)) throw new Error('New-case publication journal exists; inspect and run recover before another finalize');
  await record(state);

  await fs.mkdir(targetDataRoot, { recursive: true });
  let movedData = false;
  try {
    await fs.rename(dir, dataDir);
    movedData = true;
    await fs.rename(path.join(dataDir, oldMd), notePath);
    await record({ ...state, state: 'complete' });
  } catch (error) {
    if (movedData && await accessExists(dataDir) && !await accessExists(dir)) {
      if (await accessExists(notePath)) {
        await fs.rename(notePath, path.join(dataDir, oldMd));
      }
      await fs.rename(dataDir, dir);
    }
    await record({ ...state, state: 'rolled_back' });
    throw error;
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  let dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));

  if (requested.length) {
    const wanted = new Set(requested);
    dirs = dirs.filter((dir) => wanted.has(path.basename(dir)));
    for (const name of requested) {
      if (!dirs.some((dir) => path.basename(dir) === name)) throw new Error('Requested case not found: ' + name);
    }
  } else {
    dirs = dirs.filter((dir) => /^\d+$/.test(path.basename(dir)));
  }

  for (const dir of dirs) {
    console.log(JSON.stringify(await finalizeDir(dir)));
  }
}
