import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('notes/x/00-待整理');

function splitDoc(text) {
  const end = text.indexOf('\n---\n', 4);
  return { fm: text.slice(0, end + 5), body: text.slice(end + 5) };
}

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

function trim(lines = []) {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function scalar(text, key) {
  const m = text.match(new RegExp('^' + key + ':\\s*["\\\']?([^"\\\'\\n]+)["\\\']?\\s*$', 'm'));
  return m ? m[1].trim() : null;
}

function stripQuote(line) {
  if (line === '>') return '';
  return line.startsWith('> ') ? line.slice(2) : line;
}

function parseCards(lines = []) {
  const cards = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^> \[!(x-post|x-reply)\]\s*(.*)$/);
    if (m) {
      if (current) cards.push(current);
      current = { type: m[1], title: m[2].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(stripQuote(line));
  }
  if (current) cards.push(current);
  return cards;
}

function parsePrompts(lines = []) {
  const prompts = [];
  let label = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lm = line.match(/^\*\*(.+)\*\*$/);
    if (lm) { label = lm[1].trim(); continue; }
    if (line === '````prompt') {
      const body = [];
      i++;
      while (i < lines.length && lines[i] !== '````') { body.push(lines[i]); i++; }
      prompts.push({ label, body });
      label = '';
    }
  }
  return prompts;
}

function targetOf(label) {
  const reply = String(label || '').match(/回复\s*(\d+)/);
  if (reply) return { type: 'reply', index: Number(reply[1]) };
  return { type: 'post', index: 0 };
}

function quoteLine(line) {
  return line ? '> ' + line : '>';
}

function buildThread(cards, prompts) {
  const out = [];
  let replyNo = 0;
  for (const card of cards) {
    const isReply = card.type === 'x-reply';
    if (isReply) replyNo++;
    const title = isReply ? '回复 ' + replyNo : '主帖';
    out.push('> [!' + card.type + '] ' + title);

    const cleanBody = trim(card.body);
    if (cleanBody.length) {
      out.push('>');
      for (const line of cleanBody) out.push(quoteLine(line));
    }

    const attached = prompts.filter((p) => {
      const t = targetOf(p.label);
      return isReply ? t.type === 'reply' && t.index === replyNo : t.type === 'post';
    });

    for (const prompt of attached) {
      out.push('>');
      out.push('> ````prompt');
      for (const line of prompt.body) out.push(quoteLine(line));
      out.push('> ````');
    }
    out.push('');
  }
  return out;
}

function buildBody(fm, body) {
  const sections = sectionMap(body);
  const title = scalar(fm, 'title') || 'Untitled';
  const media = trim(sections.get('媒体') || []);
  const cards = parseCards(sections.get('原文') || []);
  const prompts = parsePrompts(sections.get('Prompt') || []);
  const oneLine = trim(sections.get('一句话看懂') || []);
  const points = trim(sections.get('复刻要点') || []);

  const out = ['# ' + title, '', '## 媒体', '', ...media, '', '## 原文', '', ...buildThread(cards, prompts), '## 一句话看懂', '', ...oneLine, '', '## 复刻要点', '', ...points];
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
  const original = await fs.readFile(mdPath, 'utf8');
  const parts = splitDoc(original);
  if (!parts.body.includes('\n## Prompt\n')) continue;
  const next = parts.fm + buildBody(parts.fm, parts.body);
  if (next !== original) {
    await fs.writeFile(mdPath, next, 'utf8');
    console.log('Upgraded ' + path.relative(process.cwd(), mdPath));
    changed++;
  }
}
console.log('Done. Updated ' + changed + ' note(s).');
