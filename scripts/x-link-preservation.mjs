const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const TWITTER_MEDIA_HOSTS = new Set(['pbs.twimg.com', 'video.twimg.com']);

function parseHttpUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function safeHttpUrl(value) {
  return parseHttpUrl(value)?.toString() ?? null;
}

function safeTwitterMediaUrl(value) {
  const url = parseHttpUrl(value);
  if (!url || url.protocol !== 'https:' || url.port || !TWITTER_MEDIA_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url.toString();
}

function escapeMarkdownText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/([\`*_{}\[\]<>#!|~$%^=>])/g, '\\$1');
}

function escapeLabel(value) {
  return escapeMarkdownText(value);
}

function escapeTarget(value) {
  return String(value).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validRange(text, token, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null;
  if (text.slice(start, end) !== token) return null;
  return { start, end };
}

function explicitRange(text, token, item) {
  const candidates = [];
  if (Array.isArray(item?.indices) && item.indices.length >= 2) {
    candidates.push([Number(item.indices[0]), Number(item.indices[1])]);
  }
  if (Number.isInteger(item?.start) && Number.isInteger(item?.end)) {
    candidates.push([item.start, item.end]);
  }
  if (Number.isInteger(item?.fromIndex) && Number.isInteger(item?.toIndex)) {
    candidates.push([item.fromIndex, item.toIndex], [item.fromIndex, item.toIndex + 1]);
  }
  if (Number.isInteger(item?.offset) && Number.isInteger(item?.length)) {
    candidates.push([item.offset, item.offset + item.length]);
  }
  for (const [start, end] of candidates) {
    const range = validRange(text, token, start, end);
    if (range) return range;
  }
  return null;
}

function withRange(entity, range) {
  return range ? { ...entity, start: range.start, end: range.end } : entity;
}

function dedupeEntities(entities) {
  const seen = new Set();
  return entities.filter((item) => {
    if (!item?.token || !item?.target) return false;
    const key = [
      item.type,
      item.token,
      item.label || '',
      item.target,
      Number.isInteger(item.start) ? item.start : '',
      Number.isInteger(item.end) ? item.end : '',
    ].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeTweetLinkEntities(rawTweet, parsedTweet, preferNoteTweet = false) {
  const note = rawTweet?.note_tweet?.note_tweet_results?.result ?? null;
  const noteEntities = note?.entity_set ?? note?.entities ?? {};
  const legacyEntities = rawTweet?.legacy?.entities ?? {};
  const source = preferNoteTweet ? noteEntities : legacyEntities;
  const text = String(preferNoteTweet ? note?.text ?? parsedTweet?.text ?? '' : rawTweet?.legacy?.full_text ?? parsedTweet?.text ?? '');

  const urls = asArray(source?.urls).length ? asArray(source.urls) : asArray(parsedTweet?.urls);
  const mentions = [
    ...asArray(source?.user_mentions),
    ...asArray(source?.mentions),
  ];

  const entities = [];

  for (const item of urls) {
    const token = item?.url;
    const target = safeHttpUrl(item?.expanded_url ?? item?.expandedUrl ?? item?.url);
    if (!token || !target) continue;
    const entity = {
      type: 'url',
      token,
      label: item?.display_url ?? item?.displayUrl ?? token,
      target,
    };
    entities.push(withRange(entity, explicitRange(text, token, item)));
  }

  for (const item of mentions) {
    const username = item?.screen_name ?? item?.username ?? item?.text;
    if (!username) continue;
    const clean = String(username).replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) continue;
    const token = '@' + clean;
    const entity = {
      type: 'mention',
      token,
      label: token,
      target: 'https://x.com/' + clean,
    };
    entities.push(withRange(entity, explicitRange(text, token, item)));
  }

  return dedupeEntities(entities);
}

function mentionBoundaryOk(text, start, end) {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
}

function findFallbackOccurrence(text, entity, startAt, occupied) {
  const token = entity.token;
  let cursor = startAt;
  while (cursor <= text.length - token.length) {
    const start = text.indexOf(token, cursor);
    if (start < 0) return null;
    const end = start + token.length;
    const overlaps = occupied.some((span) => start < span.end && end > span.start);
    const boundaryOk = entity.type !== 'mention' || mentionBoundaryOk(text, start, end);
    if (!overlaps && boundaryOk) return { start, end };
    cursor = start + Math.max(1, token.length);
  }
  return null;
}

function replacementSpans(text, entities) {
  const spans = [];
  const fallbackCursor = new Map();

  for (const entity of entities || []) {
    const target = safeHttpUrl(entity?.target);
    const token = entity?.token;
    if (!target || !token || typeof token !== 'string') continue;

    let range = validRange(text, token, entity.start, entity.end);
    if (range && entity.type === 'mention' && !mentionBoundaryOk(text, range.start, range.end)) range = null;

    if (!range) {
      const key = [entity.type || '', token, target].join('\u0000');
      range = findFallbackOccurrence(text, entity, fallbackCursor.get(key) || 0, spans);
      if (range) fallbackCursor.set(key, range.end);
    }
    if (!range) continue;

    spans.push({
      start: range.start,
      end: range.end,
      markdown: '[' + escapeLabel(entity.label || token) + '](' + escapeTarget(target) + ')',
    });
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted = [];
  let end = -1;
  for (const span of spans) {
    if (span.start < end) continue;
    accepted.push(span);
    end = span.end;
  }
  return accepted;
}

export function linkifyProse(text, entities = []) {
  const value = String(text ?? '');
  const spans = replacementSpans(value, entities);
  if (!spans.length) return escapeMarkdownText(value);

  let output = '';
  let cursor = 0;
  for (const span of spans) {
    output += escapeMarkdownText(value.slice(cursor, span.start)) + span.markdown;
    cursor = span.end;
  }
  return output + escapeMarkdownText(value.slice(cursor));
}

function entityMapEntry(entityMap, key) {
  const entry = Array.isArray(entityMap)
    ? entityMap[Number(key)] ?? null
    : entityMap && typeof entityMap === 'object'
      ? entityMap[key] ?? entityMap[String(key)] ?? null
      : null;
  if (entry?.value && typeof entry.value === 'object') return entry.value;
  return entry;
}

function atomicEntity(block, entityMap) {
  if (String(block?.type || '').toLowerCase() !== 'atomic') return null;
  const range = asArray(block?.entityRanges)[0];
  if (!range) return { entityKey: null, entityType: 'UNKNOWN', data: {} };
  const entity = entityMapEntry(entityMap, range.key);
  if (!entity) return { entityKey: String(range.key), entityType: 'UNKNOWN', data: {} };
  return {
    entityKey: String(range.key),
    entityType: String(entity.type || 'UNKNOWN').toUpperCase(),
    data: entity.data && typeof entity.data === 'object' ? entity.data : {},
  };
}

function explicitMarkdownFilename(blocks, index) {
  const patterns = [
    /文件名(?:使用|为|是|：|:)?\s*([^\s<>:"/\\|?*]+\.md)\b/i,
    /filename(?:\s+is)?\s*[:：]?\s*([^\s<>:"/\\|?*]+\.md)\b/i,
  ];
  for (let i = index - 1; i >= Math.max(0, index - 4); i--) {
    const text = String(blocks[i]?.text || '').trim();
    if (!text) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
  }
  return null;
}

export function unwrapMarkdownDocument(rawMarkdown) {
  const value = String(rawMarkdown ?? '');
  const opening = value.match(/^```(?:markdown|md)[^\S\r\n]*(?:\r\n|\n)/i);
  const closing = value.match(/(?:\r\n|\n)```[^\S\r\n]*$/);
  if (!opening || !closing || closing.index == null || closing.index < opening[0].length) {
    return { content: value, unwrapped: false };
  }
  const newline = closing[0].startsWith('\r\n') ? '\r\n' : '\n';
  return {
    content: value.slice(opening[0].length, closing.index + newline.length),
    unwrapped: true,
  };
}

function blockTokenFromRange(text, range) {
  const offset = Number(range?.offset);
  const length = Number(range?.length);
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0) return null;
  const token = text.slice(offset, offset + length);
  return token || null;
}

function normalizeArticleBlockLinks(block, entityMap) {
  const text = String(block?.text ?? '');
  const entities = [];
  const data = block?.data && typeof block.data === 'object' ? block.data : {};

  for (const item of asArray(data.mentions)) {
    const username = String(item?.text ?? item?.username ?? '').replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) continue;
    const token = '@' + username;
    const entity = { type: 'mention', token, label: token, target: 'https://x.com/' + username };
    const range = explicitRange(text, token, item);
    if (!range && !text.includes(token)) continue;
    entities.push(withRange(entity, range));
  }

  for (const item of asArray(data.links)) {
    const target = safeHttpUrl(item?.url ?? item?.href ?? item?.expandedUrl ?? item?.expanded_url);
    if (!target) continue;
    let token = item?.text ?? item?.displayText ?? item?.display_url ?? null;
    if (!token && Number.isInteger(item?.fromIndex) && Number.isInteger(item?.toIndex)) {
      token = text.slice(item.fromIndex, item.toIndex);
    }
    if (!token || !text.includes(token)) continue;
    const entity = { type: 'url', token, label: item?.displayText ?? item?.display_url ?? token, target };
    entities.push(withRange(entity, explicitRange(text, token, item)));
  }

  for (const range of asArray(block?.entityRanges)) {
    const entity = entityMapEntry(entityMap, range?.key);
    if (!entity) continue;
    const type = String(entity?.type ?? '').toUpperCase();
    const data = entity?.data && typeof entity.data === 'object' ? entity.data : {};
    const token = blockTokenFromRange(text, range);
    if (!token) continue;
    const verifiedRange = validRange(text, token, Number(range.offset), Number(range.offset) + Number(range.length));

    if (type === 'LINK') {
      const target = safeHttpUrl(data.url ?? data.href ?? data.expandedUrl ?? data.expanded_url);
      if (target) entities.push(withRange({ type: 'url', token, label: token, target }, verifiedRange));
    } else if (type === 'MENTION') {
      const username = String(data.screen_name ?? data.username ?? token).replace(/^@/, '');
      if (/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        entities.push(withRange({ type: 'mention', token, label: token, target: 'https://x.com/' + username }, verifiedRange));
      }
    }
  }

  return dedupeEntities(entities);
}

function normalizeArticleMedia(article) {
  const media = [];
  let unsupportedMediaCount = 0;
  const cover = article?.cover_media?.media_info;
  const rawCoverUrl = cover?.original_img_url;
  if (rawCoverUrl) {
    const coverUrl = safeTwitterMediaUrl(rawCoverUrl);
    if (coverUrl) {
      media.push({
        type: 'photo',
        url: coverUrl,
        articleRole: 'cover',
        mediaId: article?.cover_media?.media_id ?? null,
      });
    } else {
      unsupportedMediaCount += 1;
    }
  }

  for (const item of asArray(article?.media_entities)) {
    const info = item?.media_info ?? item?.mediaInfo ?? item;
    const rawImageUrl = info?.original_img_url ?? info?.originalImgUrl ?? item?.url;
    const imageUrl = safeTwitterMediaUrl(rawImageUrl);
    if (imageUrl) {
      media.push({
        type: 'photo',
        url: imageUrl,
        articleRole: 'inline',
        mediaId: item?.media_id ?? item?.mediaId ?? null,
      });
    } else if (rawImageUrl || item) {
      unsupportedMediaCount += 1;
    }
  }

  return { media, unsupportedMediaCount };
}

export function normalizeFxArticlePayload(payload, expected) {
  if (!payload || Number(payload.code) !== 200 || !payload.tweet) throw new Error('FxTwitter returned no usable Tweet payload.');
  const tweet = payload.tweet;
  if (String(tweet.id) !== String(expected.tweetId)) throw new Error('FxTwitter Tweet ID mismatch.');
  const article = tweet.article;
  if (!article || typeof article !== 'object') throw new Error('FxTwitter payload does not contain Article content.');
  if (expected.articleId && String(article.id) !== String(expected.articleId)) throw new Error('FxTwitter Article ID mismatch.');

  const entityMap = article?.content?.entityMap ?? {};
  const rawBlocks = asArray(article?.content?.blocks);
  const documents = [];
  let unsupportedAtomicCount = 0;
  const blocks = rawBlocks.map((block, index) => {
    const atomic = atomicEntity(block, entityMap);
    let atomicRef = null;
    if (atomic?.entityType === 'MARKDOWN' && typeof atomic.data.markdown === 'string' && atomic.data.markdown.trim()) {
      const documentIndex = documents.length;
      documents.push({
        type: 'markdown',
        entityKey: atomic.entityKey,
        sourceFilename: explicitMarkdownFilename(rawBlocks, index),
        rawMarkdown: atomic.data.markdown,
      });
      atomicRef = { type: 'MARKDOWN', entityKey: atomic.entityKey, documentIndex };
    } else if (atomic?.entityType === 'MEDIA') {
      atomicRef = { type: 'MEDIA', entityKey: atomic.entityKey };
    } else if (atomic) {
      unsupportedAtomicCount += 1;
      atomicRef = { type: 'UNSUPPORTED', entityKey: atomic.entityKey, entityType: atomic.entityType };
    }
    return {
      type: typeof block?.type === 'string' ? block.type : 'unstyled',
      text: String(block?.text ?? ''),
      links: normalizeArticleBlockLinks(block, entityMap),
      ...(atomicRef ? { atomic: atomicRef } : {}),
    };
  });

  const { media, unsupportedMediaCount } = normalizeArticleMedia(article);
  return {
    status: 'available',
    provider: 'fxtwitter',
    id: String(article.id),
    title: String(article.title ?? ''),
    previewText: String(article.preview_text ?? ''),
    sourceUrl: safeHttpUrl(expected.sourceUrl) ?? ('https://x.com/i/article/' + article.id),
    blocks,
    media,
    documents,
    unsupportedMediaCount,
    unsupportedAtomicCount,
  };
}

export function renderArticleBlocks(article, options = {}) {
  if (!article || article.status !== 'available') return '';

  const lines = [];
  const title = article.title?.trim();
  const sourceUrl = safeHttpUrl(article.sourceUrl);
  if (title) {
    const titleText = escapeLabel(title);
    lines.push('**X Article｜' + (sourceUrl ? '[' + titleText + '](' + escapeTarget(sourceUrl) + ')' : titleText) + '**');
  }

  for (const block of article.blocks || []) {
    if (block.atomic?.type === 'MARKDOWN') {
      const document = article.documents?.[block.atomic.documentIndex] ?? null;
      const rendered = document && typeof options.renderDocument === 'function'
        ? options.renderDocument(document, block)
        : '';
      lines.push(rendered || '');
      continue;
    }
    if (block.atomic) {
      lines.push('');
      continue;
    }
    const text = linkifyProse(block.text || '', block.links || []).trimEnd();
    if (!text.trim()) {
      lines.push('');
      continue;
    }
    if (/^header-(one|two|three)$/.test(block.type)) lines.push('**' + text + '**');
    else if (block.type === 'unordered-list-item') lines.push('- ' + text);
    else if (block.type === 'ordered-list-item') lines.push('1. ' + text);
    else lines.push(text);
  }

  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join('\n');
}

export { safeHttpUrl, safeTwitterMediaUrl };
