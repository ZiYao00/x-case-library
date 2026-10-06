const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function safeHttpUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return HTTP_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeTarget(value) {
  return String(value).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupeEntities(entities) {
  const seen = new Set();
  return entities.filter((item) => {
    if (!item?.token || !item?.target) return false;
    const key = [item.type, item.token, item.label || '', item.target].join('\u0000');
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
    entities.push({
      type: 'url',
      token,
      label: item?.display_url ?? item?.displayUrl ?? token,
      target,
    });
  }

  for (const item of mentions) {
    const username = item?.screen_name ?? item?.username ?? item?.text;
    if (!username) continue;
    const clean = String(username).replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) continue;
    entities.push({
      type: 'mention',
      token: '@' + clean,
      label: '@' + clean,
      target: 'https://x.com/' + clean,
    });
  }

  return dedupeEntities(entities);
}

function replacementSpans(text, entities) {
  const spans = [];
  for (const entity of entities || []) {
    const target = safeHttpUrl(entity?.target);
    const token = entity?.token;
    if (!target || !token || typeof token !== 'string') continue;

    let cursor = 0;
    while (cursor <= text.length - token.length) {
      const start = text.indexOf(token, cursor);
      if (start < 0) break;
      spans.push({
        start,
        end: start + token.length,
        markdown: '[' + escapeLabel(entity.label || token) + '](' + escapeTarget(target) + ')',
      });
      cursor = start + token.length;
    }
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
  if (!spans.length) return value;

  let output = '';
  let cursor = 0;
  for (const span of spans) {
    output += value.slice(cursor, span.start) + span.markdown;
    cursor = span.end;
  }
  return output + value.slice(cursor);
}

function entityMapEntry(entityMap, key) {
  if (Array.isArray(entityMap)) return entityMap[Number(key)] ?? null;
  if (entityMap && typeof entityMap === 'object') return entityMap[key] ?? entityMap[String(key)] ?? null;
  return null;
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
    if (!text.includes(token)) continue;
    entities.push({ type: 'mention', token, label: token, target: 'https://x.com/' + username });
  }

  for (const item of asArray(data.links)) {
    const target = safeHttpUrl(item?.url ?? item?.href ?? item?.expandedUrl ?? item?.expanded_url);
    if (!target) continue;
    let token = item?.text ?? item?.displayText ?? item?.display_url ?? null;
    if (!token && Number.isInteger(item?.fromIndex) && Number.isInteger(item?.toIndex)) {
      token = text.slice(item.fromIndex, item.toIndex);
    }
    if (!token || !text.includes(token)) continue;
    entities.push({ type: 'url', token, label: item?.displayText ?? item?.display_url ?? token, target });
  }

  for (const range of asArray(block?.entityRanges)) {
    const entity = entityMapEntry(entityMap, range?.key);
    if (!entity) continue;
    const type = String(entity?.type ?? '').toUpperCase();
    const data = entity?.data && typeof entity.data === 'object' ? entity.data : {};
    const token = blockTokenFromRange(text, range);
    if (!token) continue;

    if (type === 'LINK') {
      const target = safeHttpUrl(data.url ?? data.href ?? data.expandedUrl ?? data.expanded_url);
      if (target) entities.push({ type: 'url', token, label: token, target });
    } else if (type === 'MENTION') {
      const username = String(data.screen_name ?? data.username ?? token).replace(/^@/, '');
      if (/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        entities.push({ type: 'mention', token, label: token, target: 'https://x.com/' + username });
      }
    }
  }

  return dedupeEntities(entities);
}

function normalizeArticleMedia(article) {
  const media = [];
  const cover = article?.cover_media?.media_info;
  const coverUrl = safeHttpUrl(cover?.original_img_url);
  if (coverUrl) {
    media.push({
      type: 'photo',
      url: coverUrl,
      articleRole: 'cover',
      mediaId: article?.cover_media?.media_id ?? null,
    });
  }

  let unsupportedMediaCount = 0;
  for (const item of asArray(article?.media_entities)) {
    const info = item?.media_info ?? item?.mediaInfo ?? item;
    const imageUrl = safeHttpUrl(info?.original_img_url ?? info?.originalImgUrl ?? item?.url);
    if (imageUrl) {
      media.push({
        type: 'photo',
        url: imageUrl,
        articleRole: 'inline',
        mediaId: item?.media_id ?? item?.mediaId ?? null,
      });
    } else {
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
  const blocks = asArray(article?.content?.blocks).map((block) => ({
    type: typeof block?.type === 'string' ? block.type : 'unstyled',
    text: String(block?.text ?? ''),
    links: normalizeArticleBlockLinks(block, entityMap),
  }));

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
    unsupportedMediaCount,
  };
}

export function renderArticleBlocks(article) {
  if (!article || article.status !== 'available') return '';

  const lines = [];
  const title = article.title?.trim();
  const sourceUrl = safeHttpUrl(article.sourceUrl);
  if (title) {
    const titleText = escapeLabel(title);
    lines.push('**X Article｜' + (sourceUrl ? '[' + titleText + '](' + escapeTarget(sourceUrl) + ')' : titleText) + '**');
  }

  for (const block of article.blocks || []) {
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

export { safeHttpUrl };
