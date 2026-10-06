import fs from 'node:fs/promises';
import path from 'node:path';

export const notesRoot = (root) => path.join(root, 'notes', 'x');
export const inboxRoot = (root) => path.join(notesRoot(root), '00-待整理');
export const dataRoot = (root) => path.join(notesRoot(root), '_case-data');

export async function exists(file) {
  try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function filesBelow(root, options = {}) {
  const files = [];
  if (!await exists(root)) return files;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (options.skip?.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected link inside case data: ' + full);
    if (entry.isDirectory()) files.push(...await filesBelow(full, options));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function extractTweetIdFromSourceUrl(markdown) {
  const match = String(markdown).match(/^source:\s*(.+)$/m);
  if (!match) return null;
  const raw = match[1].trim().replace(/^['"]|['"]$/g, '');
  try {
    const url = new URL(raw);
    const id = url.pathname.match(/\/(?:status|i\/web\/status|i\/status)\/(\d+)/)?.[1];
    return id || null;
  } catch {
    return null;
  }
}

export async function findMarkdownForTweet(root, tweetId) {
  const base = notesRoot(root);
  const files = await filesBelow(base, { skip: new Set(['_case-data']) });
  const matches = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.md')) continue;
    const text = await fs.readFile(file, 'utf8');
    if (extractTweetIdFromSourceUrl(text) === String(tweetId)) matches.push(file);
  }
  return matches;
}

export async function findCaseRecords(root, tweetId) {
  const id = String(tweetId);
  const base = notesRoot(root);
  const records = [];
  if (!await exists(base)) return records;

  for (const file of await filesBelow(base)) {
    if (path.basename(file) !== 'source.json') continue;
    const source = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    if (String(source.rootTweet?.id || source.tweetId || '') !== id) continue;

    const dir = path.dirname(file);
    const relative = path.relative(base, dir);
    const parts = relative.split(path.sep);
    const isV2 = parts[0] === '_case-data' && parts[1] === id && parts.length === 2;
    const isStaging = path.dirname(dir) === inboxRoot(root) && path.basename(dir) === id;
    let markdown = [];

    if (isV2) {
      markdown = await findMarkdownForTweet(root, id);
    } else {
      markdown = (await fs.readdir(dir))
        .filter((name) => name.toLowerCase().endsWith('.md'))
        .map((name) => path.join(dir, name));
    }

    records.push({
      tweetId: id,
      layoutVersion: isV2 ? 2 : 1,
      staging: isStaging,
      finalized: !isStaging,
      dir,
      dataDir: dir,
      sourcePath: file,
      markdown,
      notePath: markdown.length === 1 ? markdown[0] : null,
    });
  }

  return records;
}

export async function resolveFinalizedCase(root, tweetId) {
  const records = await findCaseRecords(root, tweetId);
  const finalized = records.filter((item) => item.finalized);
  if (finalized.length !== 1 || finalized[0].markdown.length !== 1) return null;
  return finalized[0];
}
