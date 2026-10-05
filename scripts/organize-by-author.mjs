import fs from 'node:fs/promises';
import path from 'node:path';

const inbox = path.resolve('notes/x/00-待整理');
const authorsRoot = path.resolve('notes/x/作者');
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

async function caseAuthor(dir) {
  const source = JSON.parse(await fs.readFile(path.join(dir, 'source.json'), 'utf8'));
  const author = source?.rootTweet?.author;
  if (!author?.username || !author?.id) {
    throw new Error('Missing rootTweet.author username/id in ' + dir);
  }
  return { username: author.username, id: String(author.id) };
}

async function moveCase(dir) {
  const author = await caseAuthor(dir);
  const authorFolder = sanitizeName(author.username);
  const destinationRoot = path.join(authorsRoot, authorFolder);
  const destination = path.join(destinationRoot, path.basename(dir));

  const result = {
    dryRun,
    authorUsername: author.username,
    authorId: author.id,
    from: path.relative(process.cwd(), dir),
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

  await fs.rename(dir, destination);
  console.log(JSON.stringify(result));
}

const entries = await fs.readdir(inbox, { withFileTypes: true });
let dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(inbox, e.name));

if (args.includes('--all')) {
  // keep all finalized cases
} else if (args.length) {
  const wanted = new Set(args);
  dirs = dirs.filter((dir) => wanted.has(path.basename(dir)));
} else {
  console.error('Usage: node scripts/organize-by-author.mjs "<case-folder>" [--dry-run] | --all [--dry-run]');
  process.exit(2);
}

for (const dir of dirs) {
  await moveCase(dir);
}
