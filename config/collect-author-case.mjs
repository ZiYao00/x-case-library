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
  return globalThis.fetch(url, { ...init, headers });
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

const documentLocalName = (tweetIdValue, document, used) => {
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

async function fetchTweetByIdExact(targetTweetId) {
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

  const noteText = raw?.note_tweet?.note_tweet_results?.result?.text ?? null;
  if (noteText) parsed.text = noteText;
  parsed.linkEntities = normalizeTweetLinkEntities(raw, parsed, Boolean(noteText));

  const rawArticleResult = raw?.article?.article_results?.result ?? null;
  if (rawArticleResult) {
    parsed.article = await fetchFxArticleSupplement(parsed, rawArticleResult, targetTweetId);
  }

  return {
    tweet: parsed,
    textSource: noteText ? 'note_tweet' : 'legacy.full_text',
    noteTweetExpanded: Boolean(noteText),
  };
}

async function fetchRootTweet() {
  return fetchTweetByIdExact(tweetId);
}

async function fetchAuthorRepliesFromLoggedOutSsr(rootTweet) {
  const authorUsername = rootTweet?.author?.username || urlUsername;

  return walkAuthorReplyThread({
    rootTweet,
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
  const root = await fetchRootTweet();
  const rootTweet = safeTweet(root.tweet);
  if (String(rootTweet?.id) !== tweetId || !rootTweet?.author?.id) throw new Error('Root Tweet identity mismatch');

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
    const ssr = await fetchAuthorRepliesFromLoggedOutSsr(rootTweet);
    authorReplies = ssr.replies.map(safeTweet);
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
  } catch (error) {
    repliesStatus = 'unavailable';
    repliesError = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
    };
  }

  const authorTweets = [rootTweet, ...authorReplies].filter(Boolean);
  const seenMedia = new Set();
  const usedDocumentNames = new Set();
  let mediaIndex = 0;
  let documentsDirectoryCreated = false;

  for (const tweet of authorTweets) {
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
      const localName = `${String(mediaIndex).padStart(3, '0')}_${tweet.id}_${item.type || 'media'}_${i + 1}${ext}`;
      const localPath = path.join(mediaDir, localName);

      try {
        const downloaded = await downloadMedia(remoteUrl, localPath);
        mediaRecords.push({
          tweetId: tweet.id,
          type: item.type || null,
          articleRole: item.articleRole || null,
          remoteUrl,
          localPath: path.relative(caseDir, downloaded.path).replaceAll('\\', '/'),
          bytes: downloaded.bytes,
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
    if (tweet.article?.status !== 'available') continue;
    for (const document of tweet.article.documents || []) {
      if (document.type !== 'markdown') continue;
      const { candidate, sourceFilename } = documentLocalName(tweet.id, document, usedDocumentNames);
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
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    sourceUrl,
    requestedAuthor: urlUsername,
    tweetId,
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
      authorRepliesDiscovery: 'logged-out-page-ssr',
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
    },
    completeness: {
      rootTweetComplete: true,
      authorRepliesStatus: repliesStatus,
      hasMoreConversation,
      authorRepliesError: repliesError,
      articleStatus,
      articleCount: articleTweets.length,
      note:
        repliesStatus === 'available-via-logged-out-ssr'
          ? `Captured ${authorReplies.length} original-author reply/replies by walking the logged-out SSR reply chain. This does not prove X exposed every author reply.`
          : repliesStatus === 'partial-via-logged-out-ssr'
            ? `Captured ${authorReplies.length} original-author reply/replies before logged-out SSR traversal became partial. Inspect authorRepliesError and traversal metadata.`
            : repliesStatus === 'none-visible-via-logged-out-ssr'
              ? 'No original-author reply was visible in the logged-out SSR. This does not prove that no author reply exists.'
              : 'Root tweet is complete, but logged-out SSR author-reply discovery failed.',
    },
    rootTweet,
    authorReplies,
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
