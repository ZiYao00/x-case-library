import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export async function finalizeDir(dir, inbox = root) {
  if (path.dirname(path.resolve(dir)) !== path.resolve(inbox)) throw new Error('Case must be directly inside inbox');
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Case directory must not be a link');
  const entries = await fs.readdir(dir);
  const mdFiles = entries.filter((name) => name.toLowerCase().endsWith('.md'));
  if (mdFiles.length !== 1) {
    throw new Error('Expected exactly one Markdown file in ' + dir);
  }

  const oldMd = mdFiles[0];
  const markdown = await fs.readFile(path.join(dir, oldMd), 'utf8');
  const title = sanitizeName(parseTitle(markdown));
  const tweetId = await readTweetId(dir);

  let targetName = title;
  let targetDir = path.join(inbox, targetName);

  try {
    const stat = await fs.stat(targetDir);
    if (stat.isDirectory() && path.resolve(targetDir) !== path.resolve(dir)) {
      targetName = title + ' · ' + tweetId;
      targetDir = path.join(inbox, targetName);
    }
  } catch {}

  if (path.resolve(targetDir) !== path.resolve(dir)) {
    try {
      await fs.access(targetDir);
      throw new Error('Target case already exists: ' + targetDir);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const currentMd = path.join(dir, oldMd);
  const targetMd = path.join(dir, targetName + '.md');
  if (path.resolve(currentMd) !== path.resolve(targetMd)) {
    try {
      await fs.access(targetMd);
      throw new Error('Target Markdown already exists: ' + targetMd);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.rename(currentMd, targetMd);
  }
  if (path.resolve(targetDir) !== path.resolve(dir)) await fs.rename(dir, targetDir);
  return { tweetId, title, folder: targetName, markdown: targetName + '.md', caseDir: targetDir, notePath: path.join(targetDir, targetName + '.md') };
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
