import fs from 'node:fs/promises';
import path from 'node:path';
import { extractTweetIdFromSourceUrl, findCaseRecords } from './case-layout.mjs';

const projectRoot = process.cwd();
const inbox = path.resolve(projectRoot, 'notes/x/00-待整理');
const authorsRoot = path.resolve(projectRoot, 'notes/x/作者');
const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
const args = rawArgs.filter((arg) => arg !== '--dry-run');

function sanitizeName(input) {
  let name = String(input)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name) name = 'unknown-author';
  if (name.length > 80) name = name.slice(0, 80).replace(/[. ]+$/g, '');
  return name;
}

async function readAuthor(sourcePath) {
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const author = source?.rootTweet?.author;
  if (!author?.username || !author?.id) throw new Error('Missing rootTweet.author username/id in ' + sourcePath);
  return { username: author.username, id: String(author.id) };
}

async function candidates() {
  const found = [];
  for (const entry of await fs.readdir(inbox, { withFileTypes: true })) {
    const full = path.join(inbox, entry.name);
    if (entry.isDirectory()) {
      if (/^\d+$/.test(entry.name)) continue;
      const sourcePath = path.join(full, 'source.json');
      try {
        await fs.access(sourcePath);
      } catch {
        continue;
      }
      found.push({ layoutVersion: 1, name: entry.name, sourcePath, from: full, basename: entry.name });
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const markdown = await fs.readFile(full, 'utf8');
    const tweetId = extractTweetIdFromSourceUrl(markdown);
    if (!tweetId) throw new Error('Inbox Markdown is missing a valid X source URL: ' + full);
    const records = await findCaseRecords(projectRoot, tweetId);
    const matches = records.filter((item) => item.finalized && item.markdown.some((file) => path.resolve(file) === path.resolve(full)));
    if (matches.length !== 1) throw new Error('Cannot resolve exactly one case data package for ' + full);
    found.push({ layoutVersion: 2, name: path.basename(entry.name, '.md'), sourcePath: matches[0].sourcePath, from: full, basename: entry.name });
  }
  return found;
}

async function moveCase(item) {
  const author = await readAuthor(item.sourcePath);
  const authorFolder = sanitizeName(author.username);
  const destinationRoot = path.join(authorsRoot, authorFolder);
  const destination = path.join(destinationRoot, item.basename);
  const result = {
    dryRun,
    layoutVersion: item.layoutVersion,
    authorUsername: author.username,
    authorId: author.id,
    from: path.relative(process.cwd(), item.from),
    to: path.relative(process.cwd(), destination),
  };

  if (dryRun) {
    console.log(JSON.stringify(result));
    return;
  }

  await fs.mkdir(destinationRoot, { recursive: true });
  try {
    await fs.access(destination);
    throw new Error('Destination already exists: ' + destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.rename(item.from, destination);
  console.log(JSON.stringify(result));
}

const available = await candidates();
let selected = available;

if (args.includes('--all')) {
  // keep all finalized inbox cases
} else if (args.length) {
  const wanted = new Set(args.map((value) => value.replace(/\.md$/i, '')));
  selected = available.filter((item) => wanted.has(item.name));
  for (const name of wanted) {
    if (!selected.some((item) => item.name === name)) throw new Error('Requested case not found in inbox: ' + name);
  }
} else {
  console.error('Usage: node scripts/organize-by-author.mjs "<case-title>" [--dry-run] | --all [--dry-run]');
  process.exit(2);
}

for (const item of selected) await moveCase(item);
