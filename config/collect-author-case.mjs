import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GuestTokenManager,
  createHttpScraper,
  downloadMedia,
  GRAPHQL,
  parseTweetData,
} from 'xactions/scrapers/twitter/http';
import { walkAuthorReplyThread } from './ssr-author-replies.mjs';
import { normalizeFxArticlePayload, normalizeTweetLinkEntities, unwrapMarkdownDocument } from '../scripts/x-link-preservation.mjs';
import { parseMessage, findCases, safePath } from '../scripts/x-case-core.mjs';
import { localSources, resolveAuthorRoot, orderAuthorTweets, tweetList, sourcePosts, sameTweetSnapshot, relationshipNode, mergeRelationshipNodes, validateRelatedPosts } from '../scripts/thread-identity.mjs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log('Usage: node config/collect-author-case.mjs <x-status-url> [--output <dir>]');
  console.log('Guest-only. No account cookies. Root tweet is always collected. Author replies are best-effort.');
  process.exit(args.length === 0 ? 1 : 0);
}

let post;
try { post = parseMessage(args[0]); } catch (error) { console.error(error.message); process.exit(2); }
const { sourceUrl, username: urlUsername, tweetId } = post;
const outputFlag = args.indexOf('--output');
const explicitOutput = outputFlag >= 0 ? args[outputFlag + 1] : null;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const caseDir = path.resolve(explicitOutput || path.join(projectRoot, 'notes', 'x', '00-待整理', tweetId));
const mediaDir = path.join(caseDir, 'media');
const documentsDir = path.join(caseDir, 'documents');
const rawPath = path.join(caseDir, 'source.json');
const failurePath = path.join(caseDir, 'failure.json');
const normalizeThread = args.includes('--thread');
const standalone = args.includes('--standalone');
const candidateFlag = args.indexOf('--candidates');
const suppliedCandidates = candidateFlag < 0 ? [] : JSON.parse(await fs.readFile(await safePath(projectRoot, path.resolve(projectRoot, args[candidateFlag + 1])), 'utf8'));
if (!Array.isArray(suppliedCandidates) || suppliedCandidates.length > 40) throw new Error('Candidate list must contain at most 40 explicit status URLs');
const candidateIds = [...new Set(suppliedCandidates.map(url => parseMessage(url).tweetId))];
const refreshFlag = args.indexOf('--refresh-base');
const refreshBase = refreshFlag < 0 ? null : JSON.parse(await fs.readFile(await safePath(projectRoot, path.resolve(args[refreshFlag + 1])), 'utf8'));
const exactCache = new Map();
const failedExactCache = new Map();
const capturedSources = normalizeThread ? (await localSources(projectRoot)).filter((item) => !item.staging) : [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let exactRequests = 0;
// Includes Guest-token activation and the official media downloader. No retry wrapper.
const nativeFetch = globalThis.fetch, deadline = Date.now() + 300000;
globalThis.fetch = (url, init = {}) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Collection deadline exceeded');
  const media = /https:\/\/(?:pbs|video)\.twimg\.com\//.test(String(url));
  const budget = AbortSignal.timeout(Math.min(remaining, media ? 90000 : 30000));
  return nativeFetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, budget]) : budget });
};

if (!explicitOutput && (await findCases(projectRoot, tweetId)).length) {
  console.error('Existing case found. Use the Agent workflow to resume or open it; collection will not overwrite it.');
  process.exit(2);
}
await fs.mkdir(path.dirname(caseDir), { recursive: true });
if (!explicitOutput) await safePath(projectRoot, path.dirname(caseDir));
try { await fs.mkdir(caseDir); } catch (error) {
  if (error.code === 'EEXIST') { console.error('Output directory already exists; no overwrite or automatic retry.'); process.exit(2); }
  throw error;
}
await fs.mkdir(mediaDir);

const guest = new GuestTokenManager({ poolSize: 0 });
const apiResponses = [];
const articleSupplements = [];
let contentAuthorId = null;

const guestFetch = async (url, init = {}) => {
  const guestHeaders = await guest.getHeaders({
    method: init.method || 'GET',
    path: String(url),
    transactionId: false,
  });
  const headers = {
    ...guestHeaders,
    ...(init.headers || {}),
  };
  return globalThis.fetch(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(30000) });
};

const scraper = await createHttpScraper({
  fetch: guestFetch,
  rateLimitStrategy: 'error',
  maxRetries: 0,
  autoRefreshQueryIds: false,
  transactionId: false,
  onResponse: ({ status, remaining, resetAt }) => {
    apiResponses.push({ status, remaining, resetAt });
  },
});

const safeTweet = (tweet) => {
  if (!tweet) return null;
  return {
    id: tweet.id,
    text: tweet.text,
    createdAt: tweet.createdAt,
    author: tweet.author
      ? {
          id: tweet.author.id,
          username: tweet.author.username,
          name: tweet.author.name,
        }
      : null,
    media: Array.isArray(tweet.media) ? tweet.media : [],
    urls: Array.isArray(tweet.urls) ? tweet.urls : [],
    linkEntities: Array.isArray(tweet.linkEntities) ? tweet.linkEntities : [],
    article: tweet.article || null,
    inReplyTo: tweet.inReplyTo || null,
    lang: tweet.lang || null,
    ...(tweet.quotedTweetId ? { quotedTweetId: String(tweet.quotedTweetId) } : {}),
    ...(tweet.conversationId ? { conversationId: String(tweet.conversationId) } : {}),
  };
};

const extensionFromUrl = (url, fallback) => {
  try {
    const ext = path.extname(new URL(url).pathname);
    if (ext && ext.length <= 6) return ext;
  } catch {}
  return fallback;
};

const mediaDownloadUrl = (item) => {
  const isVideo = item?.type === 'video' || item?.type === 'animated_gif';
  if (isVideo) return item?.videoUrl || null;

  if (!item?.url) return null;

  try {
    const url = new URL(item.url);
    if (url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/')) {
      url.searchParams.set('name', 'orig');
    }
    return url.toString();
  } catch {
    return item.url;
  }
};

const sanitizeDocumentFilename = (value) => {
  let name = path.basename(String(value || 'MARKDOWN.md')).normalize('NFC');
  name = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[\[\]#^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name) name = 'MARKDOWN.md';
  if (!/\.md$/i.test(name)) name += '.md';
  if (name.length > 100) {
    const ext = path.extname(name) || '.md';
    name = name.slice(0, Math.max(1, 100 - ext.length)).replace(/[. ]+$/g, '') + ext;
  }
  return name;
};

const documentLocalName = (tweetIdValue, document, used, priorDocument = null) => {
  if (priorDocument) {
    const candidate = path.basename(priorDocument.localPath);
    if (used.has(candidate.toLowerCase())) throw new Error('Duplicate preserved Article Markdown filename: ' + candidate);
    used.add(candidate.toLowerCase());
    return { candidate, sourceFilename: priorDocument.sourceFilename || 'MARKDOWN.md' };
  }
  const sourceFilename = sanitizeDocumentFilename(document.sourceFilename || 'MARKDOWN.md');
  let candidate = `${tweetIdValue}_${sourceFilename}`;
  const key = candidate.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return { candidate, sourceFilename };
  }

  const ext = path.extname(sourceFilename) || '.md';
  const stem = sourceFilename.slice(0, -ext.length);
  const entitySuffix = String(document.entityKey || 'document').replace(/[^A-Za-z0-9_-]+/g, '_') || 'document';
  candidate = `${tweetIdValue}_${stem}_${entitySuffix}${ext}`;
  const collisionKey = candidate.toLowerCase();
  if (used.has(collisionKey)) throw new Error('Duplicate Article Markdown document identity: ' + candidate);
  used.add(collisionKey);
  return { candidate, sourceFilename };
};


async function fetchFxArticleSupplement(parsedTweet, rawArticleResult, targetTweetId) {
  const articleId = rawArticleResult?.rest_id ?? rawArticleResult?.id ?? null;
  const username = parsedTweet?.author?.username;
  const sourceUrl = articleId ? `https://x.com/i/article/${articleId}` : null;

  if (!articleId || !username) {
    return {
      status: 'unavailable',
      provider: 'fxtwitter',
      id: articleId ? String(articleId) : null,
      title: String(rawArticleResult?.title ?? ''),
      previewText: String(rawArticleResult?.preview_text ?? ''),
      sourceUrl,
      blocks: [],
      media: [],
      documents: [],
      unsupportedMediaCount: 0,
      unsupportedAtomicCount: 0,
      error: 'Article identity is incomplete.',
    };
  }

  const endpoint = `https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${targetTweetId}`;
  try {
    const response = await globalThis.fetch(endpoint, {
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        'user-agent': 'x-case-library/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    articleSupplements.push({
      tweetId: String(targetTweetId),
      articleId: String(articleId),
      provider: 'fxtwitter',
      status: response.status,
    });
    if (!response.ok) throw new Error(`FxTwitter answered HTTP ${response.status}.`);
    const payload = await response.json();
    return normalizeFxArticlePayload(payload, {
      tweetId: String(targetTweetId),
      articleId: String(articleId),
      sourceUrl,
    });
  } catch (error) {
    if (!articleSupplements.some((item) => item.tweetId === String(targetTweetId) && item.articleId === String(articleId))) {
      articleSupplements.push({
        tweetId: String(targetTweetId),
        articleId: String(articleId),
        provider: 'fxtwitter',
        status: null,
      });
    }
    return {
      status: 'unavailable',
      provider: 'fxtwitter',
      id: String(articleId),
      title: String(rawArticleResult?.title ?? ''),
      previewText: String(rawArticleResult?.preview_text ?? ''),
      sourceUrl,
      blocks: [],
      media: [],
      documents: [],
      unsupportedMediaCount: 0,
      unsupportedAtomicCount: 0,
      error: error?.message || String(error),
    };
  }
}

async function fetchTweetByIdExact(targetTweetId, metadataOnly = false) {
  if (exactCache.has(String(targetTweetId))) return exactCache.get(String(targetTweetId));
  if (failedExactCache.has(String(targetTweetId))) throw failedExactCache.get(String(targetTweetId));
  try {
  if (exactRequests >= 41) throw new Error('Exact Tweet request budget exhausted');
  exactRequests++;
  const { queryId, operationName } = GRAPHQL.TweetResultByRestId;
  const resp = await scraper.client.graphql(queryId, operationName, {
    tweetId: targetTweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  });

  const raw = resp?.data?.tweetResult?.result ?? null;
  if (!raw) throw new Error(`TweetResultByRestId returned no tweet result for ${targetTweetId}.`);

  const parsed = parseTweetData(raw);
  if (!parsed) throw new Error(`XActions could not parse TweetResultByRestId for ${targetTweetId}.`);
  if (metadataOnly || (contentAuthorId && String(parsed.author?.id) !== contentAuthorId)) {
    const result = { tweet: relationshipNode(parsed), textSource: 'relationship-metadata', noteTweetExpanded: false };
    exactCache.set(String(targetTweetId), result);
    return result;
  }
  if (raw?.legacy?.quoted_status_id_str) parsed.quotedTweetId = String(raw.legacy.quoted_status_id_str);
  if (raw?.legacy?.conversation_id_str) parsed.conversationId = String(raw.legacy.conversation_id_str);

  const noteText = raw?.note_tweet?.note_tweet_results?.result?.text ?? null;
  if (noteText) parsed.text = noteText;
  parsed.linkEntities = normalizeTweetLinkEntities(raw, parsed, Boolean(noteText));

  const rawArticleResult = raw?.article?.article_results?.result ?? null;
  if (rawArticleResult) {
    parsed.article = await fetchFxArticleSupplement(parsed, rawArticleResult, targetTweetId);
  }

  const result = {
    tweet: parsed,
    textSource: noteText ? 'note_tweet' : 'legacy.full_text',
    noteTweetExpanded: Boolean(noteText),
  };
  exactCache.set(String(targetTweetId), result);
  return result;
  } catch (error) { failedExactCache.set(String(targetTweetId), error); throw error; }
}

async function fetchRootTweet() {
  return fetchTweetByIdExact(tweetId);
}

async function fetchAuthorRepliesFromLoggedOutSsr(rootTweet, seeds = [], bridges = []) {
  const authorUsername = rootTweet?.author?.username || urlUsername;

  return walkAuthorReplyThread({
    rootTweet,
    seedReplies: seeds,
    relationshipNodes: bridges,
    resolveCandidateParents: async (reply) => {
      const resolved = await resolveAuthorRoot(reply, {
        lookup: async (id) => String(rootTweet.id) === String(id) ? rootTweet : exactCache.get(String(id))?.tweet || null,
        fetchTweet: async (id, authorId) => (await fetchTweetByIdExact(id, String(authorId) !== String(rootTweet.author.id))).tweet,
      });
      if (String(resolved.root.id) !== String(rootTweet.id)) return [];
      return { chain: resolved.chain.slice(1).map(safeTweet), relationshipNodes: resolved.relationshipNodes };
    },
    sourceUrl,
    maxPages: 40,
    maxReplies: 40,
    fetchPage: async (targetTweetId, preferredUrl) => {
      const pageUrl = preferredUrl || `https://x.com/${authorUsername}/status/${targetTweetId}`;
      const response = await globalThis.fetch(pageUrl, {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Logged-out X page answered HTTP ${response.status}.`);
      }

      return {
        status: response.status,
        html: await response.text(),
      };
    },
    fetchTweet: async (replyId) => (await fetchTweetByIdExact(replyId)).tweet,
  });
}

const mediaRecords = [];

try {
  let root = await fetchRootTweet();
  const inputTweet = safeTweet(root.tweet);
  if (String(inputTweet?.id) !== tweetId || !inputTweet?.author?.id) throw new Error('Root Tweet identity mismatch');
  contentAuthorId = String(inputTweet.author.id);
  const lookup = async (id) => {
    const matches = capturedSources.flatMap((item) => [...tweetList(item.source), ...(item.source.relationshipNodes || [])]).filter((tweet) => String(tweet.id) === String(id));
    if (matches.length > 1 && matches.some((tweet) => !sameTweetSnapshot(tweet, matches[0]))) throw new Error('Conflicting local parent snapshots');
    return matches[0] || null;
  };
  const identity = normalizeThread && !standalone
    ? await resolveAuthorRoot(inputTweet, { lookup, fetchTweet: async (id, authorId) => (await fetchTweetByIdExact(id, String(authorId) !== String(inputTweet.author.id))).tweet })
    : { root: inputTweet, chain: [inputTweet], boundary: standalone ? 'standalone' : 'input' };
  const rootTweet = identity.root;
  const canonicalId = String(rootTweet.id);
  const canonicalUrl = `https://x.com/${rootTweet.author.username}/status/${canonicalId}`;
  const bases = capturedSources.filter((item) => item.id === canonicalId);
  if (bases.length > 1) throw new Error('Ambiguous canonical source');
  const base = bases[0] || null;
  let relationshipNodes = mergeRelationshipNodes(identity.relationshipNodes || [], base?.source.relationshipNodes || [], refreshBase?.relationshipNodes || []);
  let relatedPosts = structuredClone(base?.source.relatedPosts || []);
  const suppliedReplies = [];
  const locallyKnown = capturedSources.flatMap(item => sourcePosts(item.source)).filter(tweet => String(tweet.author?.id) === String(rootTweet.author.id) && (String(tweet.conversationId || '') === canonicalId || String(tweet.quotedTweetId || '') === canonicalId)).map(tweet => String(tweet.id));
  const allCandidates = [...new Set([...candidateIds, ...locallyKnown, ...(refreshBase ? sourcePosts(refreshBase).map(tweet => String(tweet.id)) : [])])].filter(id => id !== canonicalId && !(base && sourcePosts(base.source).some(tweet => String(tweet.id) === id)));
  if (allCandidates.length > 40) throw new Error('Known candidate budget exhausted');
  if (refreshBase && (String(refreshBase.rootTweet?.id) !== canonicalId || String(refreshBase.rootTweet.author?.id) !== String(rootTweet.author.id))) throw new Error('Refresh base identity mismatch');
  const candidateFailures = [];
  for (const id of allCandidates) {
    try {
      const candidate = safeTweet((await fetchTweetByIdExact(id)).tweet);
      if (String(candidate.author?.id) !== String(rootTweet.author.id)) throw new Error('Candidate author mismatch');
      if (!candidate.inReplyTo?.tweetId && candidate.quotedTweetId) { relatedPosts.push(candidate); continue; }
      const resolved = await resolveAuthorRoot(candidate, { lookup: async (id) => id === canonicalId ? rootTweet : exactCache.get(id)?.tweet || relationshipNodes.find(node => node.id === id) || await lookup(id), fetchTweet: async (id, authorId) => (await fetchTweetByIdExact(id, String(authorId) !== String(rootTweet.author.id))).tweet });
      if (String(resolved.root.id) !== canonicalId) throw new Error('Candidate has no verified path to case root');
      relationshipNodes = mergeRelationshipNodes(relationshipNodes, resolved.relationshipNodes);
      suppliedReplies.push(...resolved.chain.slice(1));
    } catch (error) { candidateFailures.push({ tweetId: id, message: error.message }); }
  }
  if (base) {
    const records = (await findCases(projectRoot, canonicalId)).filter((record) => record.finalized);
    if (records.length !== 1 || records[0].markdown.length !== 1 || !(await fs.readFile(records[0].notePath, 'utf8')).trim()) throw new Error('Canonical case is damaged or ambiguous');
  }
  root = exactCache.get(canonicalId) || { tweet: rootTweet, textSource: 'local-snapshot', noteTweetExpanded: false };

  let authorReplies = [];
  let repliesStatus = 'not-requested';
  let hasMoreConversation = null;
  let repliesError = null;
  let authorReplyCandidateIds = [];
  let authorRepliesPageStatus = null;
  let authorRepliesPagesVisited = [];
  let authorRepliesPageStatuses = [];
  let authorRepliesTermination = null;
  let authorRepliesRejectedCandidateIds = [];

  try {
    const ssr = base ? null : await fetchAuthorRepliesFromLoggedOutSsr(rootTweet, [...identity.chain.slice(1), ...suppliedReplies], relationshipNodes);
    if (base) {
      authorReplies = orderAuthorTweets(rootTweet, [...(base.source.authorReplies || []), ...identity.chain.slice(1), ...suppliedReplies], relationshipNodes).slice(1);
      repliesStatus = base.source.completeness?.authorRepliesStatus || 'available-via-logged-out-ssr';
      hasMoreConversation = base.source.completeness?.hasMoreConversation ?? null;
      repliesError = base.source.completeness?.authorRepliesError || null;
    } else {
    authorReplies = ssr.replies.map(safeTweet);
    relationshipNodes = mergeRelationshipNodes(relationshipNodes, ssr.relationshipNodes || []);
    relatedPosts.push(...(ssr.relatedPosts || []).map(safeTweet));
    authorReplyCandidateIds = ssr.candidateIds;
    authorRepliesPageStatuses = ssr.pageStatuses;
    authorRepliesPageStatus = ssr.pageStatuses[0]?.status ?? null;
    authorRepliesPagesVisited = ssr.pagesVisited;
    authorRepliesTermination = ssr.terminatedReason;
    authorRepliesRejectedCandidateIds = ssr.rejectedCandidateIds;
    repliesStatus = ssr.status;
    if (ssr.errors.length) {
      repliesError = {
        name: 'AuthorReplyTraversalPartial',
        message: `Author-reply traversal recorded ${ssr.errors.length} error(s).`,
        details: ssr.errors,
      };
    }
    hasMoreConversation = ['page-limit', 'reply-limit'].includes(ssr.terminatedReason) ? true : null;
    }
  } catch (error) {
    if (base) throw error;
    repliesStatus = 'unavailable';
    repliesError = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
    };
  }

  const authorTweets = [rootTweet, ...authorReplies].filter(Boolean);
  // A supplied reply remains a seed even when logged-out SSR omits it.
  if (!base) {
    const combined = orderAuthorTweets(rootTweet, [...authorReplies, ...identity.chain.slice(1), ...suppliedReplies], relationshipNodes);
    authorReplies = combined.slice(1);
    authorTweets.splice(0, authorTweets.length, ...combined);
  }
  if (authorReplies.length > 40) throw new Error('Author reply budget exhausted');
  for (const candidate of relatedPosts) if (!authorTweets.some(primary => String(primary.id) === String(candidate.quotedTweetId))) candidateFailures.push({ tweetId: String(candidate.id), message: 'Related quote does not target a case member' });
  relatedPosts = [...new Map(relatedPosts.map(tweet => [String(tweet.id), tweet])).values()].filter(tweet => authorTweets.some(primary => String(primary.id) === String(tweet.quotedTweetId)) && !authorTweets.some(primary => String(primary.id) === String(tweet.id)));
  validateRelatedPosts({ rootTweet, authorReplies, relatedPosts });
  if (authorReplies.length + relatedPosts.length > 40) throw new Error('Author content and related-post budget exhausted');
  if (candidateFailures.length) { repliesStatus = 'partial-via-explicit-candidates'; repliesError = { details: candidateFailures }; }
  authorTweets.push(...relatedPosts);
  const oldIds = new Set(base ? sourcePosts(base.source).map((tweet) => String(tweet.id)) : []);
  if (base) {
    for (const record of base.source.mediaFiles || []) {
      if (record.status !== 'downloaded') throw new Error('Canonical media is incomplete; explicit repair is required');
      const from = await safePath(path.dirname(base.sourcePath), path.resolve(path.dirname(base.sourcePath), record.localPath));
      const to = path.join(caseDir, record.localPath);
      if ((await fs.stat(from)).size !== record.bytes) throw new Error('Canonical media size mismatch');
      await fs.mkdir(path.dirname(to), { recursive: true });
      const contentHash = digest(await fs.readFile(from));
      if (record.contentHash && record.contentHash !== contentHash) throw new Error('Canonical media hash mismatch');
      await fs.copyFile(from, to); mediaRecords.push({ ...structuredClone(record), contentHash });
    }
    for (const tweet of tweetList(base.source)) for (const document of tweet.article?.documents || []) {
      if (document.status !== 'written') throw new Error('Canonical document is incomplete');
      const from = await safePath(path.dirname(base.sourcePath), path.resolve(path.dirname(base.sourcePath), document.localPath));
      if (await fs.readFile(from, 'utf8') !== unwrapMarkdownDocument(document.rawMarkdown).content) throw new Error('Canonical embedded document was edited');
      const to = path.join(caseDir, document.localPath);
      await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to);
    }
  }
  const seenMedia = new Set();
  for (const record of mediaRecords) seenMedia.add(record.remoteUrl);
  const usedDocumentNames = new Set();
  let mediaIndex = Math.max(0, ...mediaRecords.map((record) => Number(path.basename(record.localPath).match(/^\d+/)?.[0] || 0)));
  let documentsDirectoryCreated = base ? await fs.access(documentsDir).then(() => true, () => false) : false;

  for (const tweet of authorTweets) {
    if (oldIds.has(String(tweet.id))) continue;
    const tweetMedia = [
      ...(tweet.media || []),
      ...((tweet.article?.status === 'available' && Array.isArray(tweet.article.media)) ? tweet.article.media : []),
    ];
    for (let i = 0; i < tweetMedia.length; i++) {
      const item = tweetMedia[i];
      const isVideo = item.type === 'video' || item.type === 'animated_gif';
      const remoteUrl = mediaDownloadUrl(item);
      if (!remoteUrl) {
        mediaRecords.push({ tweetId: tweet.id, type: item.type || null, articleRole: item.articleRole || null, remoteUrl: null, localPath: null, bytes: 0, status: 'failed', error: 'No usable media download URL' });
        continue;
      }
      if (seenMedia.has(remoteUrl)) continue;
      seenMedia.add(remoteUrl);
      mediaIndex += 1;

      const fallbackExt = isVideo ? '.mp4' : '.jpg';
      const ext = extensionFromUrl(remoteUrl, fallbackExt);
      const owner = String(tweet.id) === canonicalId ? String(tweet.id) : `${canonicalId}_${tweet.id}`;
      const priorMedia = (refreshBase?.mediaFiles || []).find(record => String(record.tweetId) === String(tweet.id) && record.remoteUrl === remoteUrl && record.status === 'downloaded');
      const localName = priorMedia ? path.basename(priorMedia.localPath) : `${String(mediaIndex).padStart(3, '0')}_${owner}_${item.type || 'media'}_${i + 1}${ext}`;
      const localPath = path.join(mediaDir, localName);

      try {
        const downloaded = await downloadMedia(remoteUrl, localPath);
        mediaRecords.push({
          tweetId: tweet.id,
          role: relatedPosts.some(post => String(post.id) === String(tweet.id)) ? 'related' : 'attachment',
          type: item.type || null,
          articleRole: item.articleRole || null,
          remoteUrl,
          localPath: path.relative(caseDir, downloaded.path).replaceAll('\\', '/'),
          bytes: downloaded.bytes,
          contentHash: digest(await fs.readFile(downloaded.path)),
          status: 'downloaded',
        });
      } catch (error) {
        mediaRecords.push({
          tweetId: tweet.id,
          type: item.type || null,
          articleRole: item.articleRole || null,
          remoteUrl,
          localPath: null,
          bytes: 0,
          status: 'failed',
          error: error?.message || String(error),
        });
      }
    }
  }

  for (const tweet of authorTweets) {
    if (oldIds.has(String(tweet.id))) continue;
    if (tweet.article?.status !== 'available') continue;
    for (const document of tweet.article.documents || []) {
      if (document.type !== 'markdown') continue;
      const priorDocument = sourcePosts(refreshBase || {}).find(previous => String(previous.id) === String(tweet.id))?.article?.documents?.find(previous => previous.status === 'written' && previous.type === document.type && previous.rawMarkdown === document.rawMarkdown && !usedDocumentNames.has(path.basename(previous.localPath).toLowerCase()));
      const { candidate, sourceFilename } = documentLocalName(tweet.id, document, usedDocumentNames, priorDocument);
      const target = path.join(documentsDir, candidate);
      try {
        if (!documentsDirectoryCreated) {
          await fs.mkdir(documentsDir);
          documentsDirectoryCreated = true;
        }
        const unwrapped = unwrapMarkdownDocument(document.rawMarkdown);
        if (!unwrapped.content.trim()) throw new Error('Article Markdown document is empty after deterministic unwrap');
        await fs.writeFile(target, unwrapped.content, { encoding: 'utf8', flag: 'wx' });
        Object.assign(document, {
          sourceFilename,
          filename: candidate,
          localPath: path.relative(caseDir, target).replaceAll('\\', '/'),
          bytes: Buffer.byteLength(unwrapped.content, 'utf8'),
          status: 'written',
          unwrapped: unwrapped.unwrapped,
        });
      } catch (error) {
        Object.assign(document, {
          sourceFilename,
          filename: candidate,
          localPath: null,
          bytes: 0,
          status: 'failed',
          error: error?.message || String(error),
        });
      }
    }
  }

  const articleTweets = authorTweets.filter((tweet) => tweet.article);
  const articleStatus = !articleTweets.length
    ? 'not-present'
    : articleTweets.every((tweet) => tweet.article?.status === 'available'
      && Number(tweet.article?.unsupportedMediaCount || 0) === 0
      && Number(tweet.article?.unsupportedAtomicCount || 0) === 0
      && (tweet.article?.documents || []).every((document) => document.status === 'written'))
      ? 'available'
      : 'partial';
  const articleDocuments = articleTweets.flatMap((tweet) => tweet.article?.documents || []);

  const source = {
    schemaVersion: 3,
    capturedAt: new Date().toISOString(),
    sourceUrl: normalizeThread ? canonicalUrl : sourceUrl,
    requestedAuthor: urlUsername,
    tweetId: canonicalId,
    caseIdentity: { mode: standalone ? 'standalone' : 'thread', inputTweetId: tweetId, caseId: canonicalId, boundary: identity.boundary, parentChain: identity.chain.map((tweet) => String(tweet.id)) },
    acquisition: {
      provider: 'xactions',
      version: '4.0.1',
      transport: 'http-guest',
      authenticatedAccountUsed: false,
      retryPolicy: 'none',
      autoRefreshQueryIds: false,
      rootTweetEndpoint: 'TweetResultByRestId',
      textSource: root.textSource,
      noteTweetExpanded: root.noteTweetExpanded,
      authorRepliesStatus: repliesStatus,
      authorRepliesDiscovery: base ? 'verified-candidates-with-preserved-snapshot' : suppliedReplies.length ? 'explicit-candidates-and-logged-out-ssr' : 'logged-out-page-ssr',
      authorReplyExactFetch: 'TweetResultByRestId',
      authorReplyCandidateIds,
      authorRepliesPageStatus,
      authorRepliesPagesVisited,
      authorRepliesPageStatuses,
      authorRepliesTermination,
      authorRepliesRejectedCandidateIds,
      articleSupplementProvider: 'fxtwitter',
      articleSupplements,
      apiResponses,
      exactRequests,
      baseSnapshot: base ? { sourcePath: path.relative(projectRoot, base.sourcePath), sourceHash: base.sourceHash, capturedAt: base.source.capturedAt } : null,
      relationshipBaseSnapshot: refreshBase?.relationshipNodes?.length ? { sourceHash: digest(await fs.readFile(args[refreshFlag + 1])), capturedAt: refreshBase.capturedAt } : null,
      snapshots: [...(base?.source.acquisition?.snapshots || (base ? [{ sourceHash: base.sourceHash, capturedAt: base.source.capturedAt, tweetIds: tweetList(base.source).map((tweet) => String(tweet.id)) }] : [])), { capturedAt: new Date().toISOString(), tweetIds: authorTweets.filter((tweet) => exactCache.has(String(tweet.id))).map((tweet) => String(tweet.id)) }],
    },
    completeness: {
      rootTweetComplete: true,
      authorRepliesStatus: repliesStatus,
      hasMoreConversation,
      authorRepliesError: repliesError,
      articleStatus,
      articleCount: articleTweets.length,
      note:
        base ? 'Preserved existing verified author snapshots and supplemented known candidates. Previous SSR discovery was not repeated; this does not prove a complete Conversation.' : repliesStatus === 'available-via-logged-out-ssr'
          ? `Captured ${authorReplies.length} original-author reply/replies by walking the logged-out SSR reply chain. This does not prove X exposed every author reply.`
          : repliesStatus === 'partial-via-logged-out-ssr'
            ? `Captured ${authorReplies.length} original-author reply/replies before logged-out SSR traversal became partial. Inspect authorRepliesError and traversal metadata.`
            : repliesStatus === 'none-visible-via-logged-out-ssr'
              ? 'No original-author reply was visible in the logged-out SSR. This does not prove that no author reply exists.'
              : 'Root tweet is complete, but logged-out SSR author-reply discovery failed.',
    },
    rootTweet,
    authorReplies,
    relationshipNodes,
    relatedPosts,
    mediaFiles: mediaRecords,
  };

  await fs.writeFile(rawPath, JSON.stringify(source, null, 2), { encoding: 'utf8', flag: 'wx' });

  console.log(JSON.stringify({
    status: 'ok',
    tweetId,
    author: rootTweet?.author?.username || urlUsername,
    textSource: root.textSource,
    authorReplyCount: authorReplies.length,
    authorRepliesStatus: repliesStatus,
    authorRepliesPagesVisited: authorRepliesPagesVisited.length,
    articleStatus,
    articleCount: articleTweets.length,
    mediaFound: mediaRecords.length,
    mediaDownloaded: mediaRecords.filter((m) => m.status === 'downloaded').length,
    documentsFound: articleDocuments.length,
    documentsWritten: articleDocuments.filter((document) => document.status === 'written').length,
    output: rawPath,
  }));
} catch (error) {
  const failure = {
    failedAt: new Date().toISOString(),
    sourceUrl,
    tweetId,
    transport: 'http-guest',
    authenticatedAccountUsed: false,
    retryPolicy: 'none',
    error: {
      name: error?.name || 'Error',
      code: error?.code || null,
      message: error?.message || String(error),
    },
    apiResponses,
    instruction: 'Guest root-tweet collection failed. Inspect before any account-session fallback.',
  };
  await fs.writeFile(failurePath, JSON.stringify(failure, null, 2), 'utf8');
  console.error(JSON.stringify({ status: 'failed', tweetId, output: failurePath, error: failure.error }));
  process.exit(1);
}
