import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('notes/x/00-待整理');

function sectionMap(body) {
  const lines = body.split('\n');
  const map = new Map();
  let title = null;
  let bucket = [];
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      if (title) map.set(title, bucket);
      title = m[1].trim();
      bucket = [];
    } else if (title) bucket.push(line);
  }
  if (title) map.set(title, bucket);
  return map;
}

function scalar(text, key) {
  const m = text.match(new RegExp('^' + key + ':\\s*["\\\']?([^"\\\'\\n]+)["\\\']?\\s*$', 'm'));
  return m ? m[1].trim() : null;
}

function listUnder(text, key) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.trim() === key + ':');
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+)$/);
    if (!m) break;
    out.push(m[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

function splitDoc(text) {
  const end = text.indexOf('\n---\n', 4);
  return { fm: text.slice(0, end + 5), body: text.slice(end + 5) };
}

function captureState(source) {
  const s = source?.acquisition?.authorRepliesStatus || source?.completeness?.authorRepliesStatus || '';
  if (String(s).startsWith('available')) return '完整';
  if (String(s).startsWith('none-visible') || String(s) === 'unavailable') return '待确认';
  return '部分';
}

function yamlQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function buildFrontmatter(oldFm, source) {
  const title = scalar(oldFm, 'title') || 'Untitled';
  const sourceUrl = scalar(oldFm, 'source') || source?.sourceUrl || '';
  const author = scalar(oldFm, 'author') || source?.rootTweet?.author?.name || '';
  const publishedRaw = scalar(oldFm, 'published') || source?.rootTweet?.createdAt || '';
  const published = publishedRaw ? publishedRaw.slice(0, 10) : '';
  const model = scalar(oldFm, 'model');
  const status = scalar(oldFm, 'status') || '未复刻';
  const tags = listUnder(oldFm, 'tags');

  const lines = [
    '---',
    'title: ' + yamlQuote(title),
    'source: ' + yamlQuote(sourceUrl),
    'author: ' + yamlQuote(author),
    'published: ' + yamlQuote(published),
  ];
  if (model) lines.push('model: ' + yamlQuote(model));
  lines.push('status: ' + yamlQuote(status));
  lines.push('capture: ' + yamlQuote(captureState(source)));
  lines.push('cssclasses:', '  - learning-page', '  - x-case-note');
  lines.push('tags:');
  for (const tag of tags) lines.push('  - ' + tag);
  lines.push('---');
  return lines.join('\n') + '\n';
}

function stripQuote(line) {
  if (line === '>') return '';
  return line.startsWith('> ') ? line.slice(2) : line;
}

function parseAuthorCards(lines) {
  const cards = [];
  let current = null;
  for (const line of lines || []) {
    const m = line.match(/^> \[!(x-post|x-reply)\]\s*(.*)$/);
    if (m) {
      if (current) cards.push(current);
      current = { type: m[1], body: [] };
      continue;
    }
    if (current) current.body.push(stripQuote(line));
  }
  if (current) cards.push(current);
  return cards;
}

function trim(lines) {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function mediaEmbeds(body) {
  const seen = new Set();
  const out = [];
  const re = /!\[\[(media\/[^\]|]+\.(?:jpg|jpeg|png|webp|gif|mp4))(?:\|[^\]]+)?\]\]/gi;
  let m;
  while ((m = re.exec(body))) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function parsePrompts(lines) {
  const prompts = [];
  let label = null;
  for (let i = 0; i < (lines || []).length; i++) {
    const line = lines[i];
    const lm = line.match(/^> \[!prompt\]\s*(.+)$/);
    if (lm) { label = lm[1].trim(); continue; }
    if (/^````(?:text|prompt)\s*$/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && lines[i] !== '````') { body.push(lines[i]); i++; }
      prompts.push({ label, body });
      label = null;
    }
  }
  return prompts;
}

function compactPromptLabel(raw, index) {
  const source = raw?.includes('作者回复') ? '回复 1' : '主帖';
  const withoutSource = (raw || '').replace(/\s*·\s*来源：作者(?:主帖|回复)\s*$/, '');
  const suffix = withoutSource.replace(/^Prompt\s*\d+\s*·?\s*/, '').trim();
  return suffix ? suffix + ' · ' + source : 'Prompt ' + (index + 1) + ' · ' + source;
}

function sourceCard(type, title, bodyLines = []) {
  const out = ['> [!' + type + '] ' + title];
  const clean = trim(bodyLines);
  if (clean.length) {
    out.push('>');
    for (const line of clean) out.push(line ? '> ' + line : '>');
  }
  return out;
}

function buildBody(oldFm, body, source) {
  const sections = sectionMap(body);
  const title = scalar(oldFm, 'title') || 'Untitled';
  const cards = parseAuthorCards(sections.get('作者内容') || []);
  const prompts = parsePrompts(sections.get('可复制 Prompt') || []);
  const media = mediaEmbeds(body);
  const oneLine = trim(sections.get('一句话看懂') || []);
  const points = trim(sections.get('复刻要点') || []);

  const out = ['# ' + title, '', '## 原文', ''];
  const post = cards.find((c) => c.type === 'x-post');
  if (post) out.push(...sourceCard('x-post', '主帖', post.body), '');
  const replies = cards.filter((c) => c.type === 'x-reply');
  replies.forEach((reply, i) => {
    const promptCount = prompts.filter((p) => p.label?.includes('作者回复')).length;
    const titleText = '回复 ' + (i + 1) + (promptCount ? ' · Prompt' : '');
    out.push(...sourceCard('x-reply', titleText, []), '');
  });

  out.push('## 媒体', '');
  const videos = media.filter((p) => /\.mp4$/i.test(p));
  const images = media.filter((p) => !/\.mp4$/i.test(p));
  for (const p of videos) out.push('![[' + p + ']]', '');
  if (images.length) out.push(images.map((p) => '![[' + p + '|260]]').join(' '), '');

  out.push('## Prompt', '');
  prompts.forEach((p, i) => {
    out.push('**' + compactPromptLabel(p.label, i) + '**', '');
    out.push('````prompt', ...p.body, '````', '');
  });

  out.push('## 一句话看懂', '', ...oneLine, '');
  out.push('## 复刻要点', '', ...points, '');
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

const entries = await fs.readdir(root, { withFileTypes: true });
let changed = 0;
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(root, entry.name);
  const files = await fs.readdir(dir);
  const md = files.find((f) => f.toLowerCase().endsWith('.md'));
  if (!md) continue;
  const mdPath = path.join(dir, md);
  const sourcePath = path.join(dir, 'source.json');
  const original = await fs.readFile(mdPath, 'utf8');
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const parts = splitDoc(original);
  if (
    parts.body.includes('\n## 原文\n') &&
    parts.body.includes('\n## 媒体\n') &&
    parts.body.includes('\n## Prompt\n')
  ) {
    continue;
  }
  const next = buildFrontmatter(parts.fm, source) + buildBody(parts.fm, parts.body, source);
  if (next !== original) {
    await fs.writeFile(mdPath, next, 'utf8');
    console.log('Upgraded ' + path.relative(process.cwd(), mdPath));
    changed++;
  }
}
console.log('Done. Updated ' + changed + ' note(s).');
