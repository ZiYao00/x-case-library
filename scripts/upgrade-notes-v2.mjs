import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('notes/x/00-待整理');

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { frontmatter: '', body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatter: '', body: text };
  return {
    frontmatter: text.slice(0, end + 5),
    body: text.slice(end + 5),
  };
}

function ensureCssClass(frontmatter, cssClass) {
  if (!frontmatter) return frontmatter;
  const escaped = cssClass.replace(/[.*+?^()|[\]\\]/g, '\\$&');
  if (new RegExp('^\\s*- ' + escaped + '\\s*$', 'm').test(frontmatter)) return frontmatter;

  if (/^cssclasses:\s*$/m.test(frontmatter)) {
    return frontmatter.replace(
      /(^cssclasses:\s*$\n(?:^[ \t]+- .+$\n?)*)/m,
      (block) => block.replace(/\n?$/, '\n') + '  - ' + cssClass + '\n',
    );
  }

  return frontmatter.replace(/\n---\n$/, '\ncssclasses:\n  - learning-page\n  - ' + cssClass + '\n---\n');
}

function parseSections(body) {
  const lines = body.split('\n');
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (current) sections.push(current);
      current = { title: match[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

function toCallout(type, title, lines) {
  const clean = trimBlankEdges(lines);
  const out = ['> [!' + type + '] ' + title];
  if (clean.length === 0) return out;
  out.push('>');
  for (const line of clean) out.push(line === '' ? '>' : '> ' + line);
  return out;
}

function promptLabel(title, index) {
  if (title === '原始 Prompt') return 'Prompt ' + (index + 1);
  const suffix = title.replace(/^Prompt\s*·\s*/, '').trim();
  return suffix ? 'Prompt ' + (index + 1) + ' · ' + suffix : 'Prompt ' + (index + 1);
}

function extractFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp('^' + key + ':\\s*["\\\']?([^"\\\'\\n]+)["\\\']?\\s*$', 'm'));
  return match ? match[1].trim() : null;
}

function addVideoFallbackLinks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const match = line.match(/^!\[\[(media\/[^\]|]+\.mp4)(?:\|[^\]]+)?\]\]$/i);
    if (!match) continue;
    const nextWindow = lines.slice(i + 1, i + 5).join('\n');
    if (nextWindow.includes('单独打开视频')) continue;
    out.push('');
    out.push('[[' + match[1] + '|▶ 单独打开视频]]');
  }
  return out;
}

function buildV2(frontmatter, body) {
  const nextFrontmatter = ensureCssClass(frontmatter, 'x-case-note');
  const parsed = parseSections(body);
  const preamble = parsed.preamble;
  const sections = parsed.sections;
  const authorHandle = extractFrontmatterValue(nextFrontmatter, 'author_handle');
  const handleLabel = authorHandle ? ' · @' + authorHandle : '';

  const authorTitles = new Set(['作者原文', '作者主帖', '作者补充']);
  const promptSections = sections.filter((s) => s.title === '原始 Prompt' || /^Prompt\s*·/.test(s.title));
  const hasAuthorReply = sections.some((s) => s.title === '作者补充');

  const output = addVideoFallbackLinks(preamble);
  let authorWritten = false;
  let promptsWritten = false;

  for (const section of sections) {
    if (authorTitles.has(section.title)) {
      if (authorWritten) continue;
      authorWritten = true;
      output.push('## 作者内容', '');
      for (const authorSection of sections.filter((s) => authorTitles.has(s.title))) {
        const isReply = authorSection.title === '作者补充';
        const title = (isReply ? '作者回复' : '作者主帖') + handleLabel;
        output.push(...toCallout(isReply ? 'x-reply' : 'x-post', title, authorSection.lines), '');
      }
      continue;
    }

    if (section.title === '原始 Prompt' || /^Prompt\s*·/.test(section.title)) {
      if (promptsWritten) continue;
      promptsWritten = true;
      output.push('## 可复制 Prompt', '');
      promptSections.forEach((promptSection, index) => {
        const label = promptLabel(promptSection.title, index);
        const source = hasAuthorReply ? '作者回复' : '作者主帖';
        const clean = trimBlankEdges(promptSection.lines);
        output.push('> [!prompt] ' + label + ' · 来源：' + source);
        output.push('> 下方代码块保留作者原始 Prompt，便于整段复制。');
        output.push('');
        output.push('````text');
        output.push(...clean);
        output.push('````');
        output.push('');
      });
      continue;
    }

    output.push('## ' + section.title);
    output.push(...addVideoFallbackLinks(section.lines));
  }

  const nextBody = output.join('\n').replace(/\n{4,}/g, '\n\n\n').trimStart();
  return nextFrontmatter + nextBody.trimEnd() + '\n';
}

const entries = await fs.readdir(root, { withFileTypes: true });
let changed = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const caseDir = path.join(root, entry.name);
  const files = await fs.readdir(caseDir);
  const mdFiles = files.filter((name) => name.toLowerCase().endsWith('.md'));

  for (const mdFile of mdFiles) {
    const filePath = path.join(caseDir, mdFile);
    const original = await fs.readFile(filePath, 'utf8');
    const parts = splitFrontmatter(original);
    const upgraded = buildV2(parts.frontmatter, parts.body);
    if (upgraded !== original) {
      await fs.writeFile(filePath, upgraded, 'utf8');
      changed++;
      console.log('Upgraded ' + path.relative(process.cwd(), filePath));
    }
  }
}

console.log('Done. Updated ' + changed + ' note(s).');
