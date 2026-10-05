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
  let mediaIndex = 0;

  for (const tweet of authorTweets) {
    for (let i = 0; i < (tweet.media || []).length; i++) {
      const item = tweet.media[i];
      const isVideo = item.type === 'video' || item.type === 'animated_gif';
      const remoteUrl = mediaDownloadUrl(item);
      if (!remoteUrl) {
        mediaRecords.push({ tweetId: tweet.id, type: item.type || null, remoteUrl: null, localPath: null, bytes: 0, status: 'failed', error: 'No usable media download URL' });
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
          remoteUrl,
          localPath: path.relative(caseDir, downloaded.path).replaceAll('\\', '/'),
          bytes: downloaded.bytes,
          status: 'downloaded',
        });
      } catch (error) {
        mediaRecords.push({
          tweetId: tweet.id,
          type: item.type || null,
          remoteUrl,
          localPath: null,
          bytes: 0,
          status: 'failed',
          error: error?.message || String(error),
        });
      }
    }
  }

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
      apiResponses,
    },
    completeness: {
      rootTweetComplete: true,
      authorRepliesStatus: repliesStatus,
      hasMoreConversation,
      authorRepliesError: repliesError,
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
    mediaFound: mediaRecords.length,
    mediaDownloaded: mediaRecords.filter((m) => m.status === 'downloaded').length,
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
