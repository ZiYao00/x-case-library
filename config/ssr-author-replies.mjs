export function extractAuthorReplyIdsFromSsr(html, authorUsername) {
  if (!html || !authorUsername) return [];

  const ids = [];
  const seen = new Set();
  const targetAuthor = authorUsername.toLowerCase();
  const re = /conversationthread-(\d+)-tweet-\1/g;

  let match;
  while ((match = re.exec(html))) {
    const tweetId = match[1];
    if (seen.has(tweetId)) continue;

    // Only consider the serialized timeline entry occurrence.
    const prefix = html.slice(Math.max(0, match.index - 48), match.index);
    if (!prefix.includes('entry_id:')) continue;

    const nextEntry = html.indexOf('entry_id:', match.index + match[0].length);
    const hardEnd = Math.min(html.length, match.index + 30000);
    const end = nextEntry > match.index ? Math.min(nextEntry, hardEnd) : hardEnd;
    const block = html.slice(match.index, end);

    const keyIndex = block.indexOf('screen_name:');
    if (keyIndex < 0) continue;

    const afterKey = block.slice(keyIndex + 'screen_name:'.length);
    const quoteStart = afterKey.indexOf('"');
    if (quoteStart < 0) continue;
    const quoteEnd = afterKey.indexOf('"', quoteStart + 1);
    if (quoteEnd < 0) continue;

    const actualAuthor = afterKey.slice(quoteStart + 1, quoteEnd);
    if (actualAuthor.toLowerCase() !== targetAuthor) continue;

    seen.add(tweetId);
    ids.push(tweetId);
  }

  return ids;
}

export async function walkAuthorReplyThread({
  rootTweet,
  sourceUrl,
  fetchPage,
  fetchTweet,
  maxPages = 40,
  maxReplies = 40,
}) {
  const rootId = String(rootTweet?.id || '');
  const authorId = String(rootTweet?.author?.id || '');
  const authorUsername = rootTweet?.author?.username || '';
  if (!rootId || !authorId || !authorUsername) throw new Error('Root Tweet author identity is required for reply traversal.');
  if (typeof fetchPage !== 'function' || typeof fetchTweet !== 'function') throw new Error('Reply traversal requires fetchPage and fetchTweet functions.');
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(maxReplies) || maxReplies < 1) throw new Error('Reply traversal limits must be positive integers.');

  const queue = [rootId];
  const visitedPages = new Set();
  const acceptedIds = new Set([rootId]);
  const candidateSeen = new Set();
  const exactCache = new Map();
  const failedExactIds = new Set();
  const candidateIds = [];
  const replies = [];
  const pageStatuses = [];
  const errors = [];
  const rejectedCandidateIds = [];
  let terminatedReason = 'exhausted';

  while (queue.length) {
    if (visitedPages.size >= maxPages) {
      terminatedReason = 'page-limit';
      break;
    }
    if (replies.length >= maxReplies) {
      terminatedReason = 'reply-limit';
      break;
    }

    const currentId = queue.shift();
    if (visitedPages.has(currentId)) continue;
    visitedPages.add(currentId);

    let page;
    try {
      page = await fetchPage(currentId, currentId === rootId ? sourceUrl : null);
      if (!page?.html) throw new Error('Logged-out page returned no HTML.');
      pageStatuses.push({ tweetId: currentId, status: page.status ?? null });
    } catch (error) {
      errors.push({ stage: 'page', tweetId: currentId, message: error?.message || String(error) });
      continue;
    }

    const discovered = extractAuthorReplyIdsFromSsr(page.html, authorUsername)
      .filter((id) => id !== currentId && id !== rootId);

    for (const candidateId of discovered) {
      if (!candidateSeen.has(candidateId)) {
        candidateSeen.add(candidateId);
        candidateIds.push(candidateId);
      }
      if (acceptedIds.has(candidateId) || failedExactIds.has(candidateId)) continue;

      let reply = exactCache.get(candidateId);
      if (!reply) {
        try {
          reply = await fetchTweet(candidateId);
          exactCache.set(candidateId, reply);
        } catch (error) {
          failedExactIds.add(candidateId);
          errors.push({ stage: 'tweet', tweetId: candidateId, parentTweetId: currentId, message: error?.message || String(error) });
          continue;
        }
      }

      const sameAuthor = reply?.author?.username?.toLowerCase() === authorUsername.toLowerCase()
        && String(reply?.author?.id || '') === authorId;
      if (!sameAuthor) {
        if (!rejectedCandidateIds.includes(candidateId)) rejectedCandidateIds.push(candidateId);
        continue;
      }

      const directChild = String(reply?.inReplyTo?.tweetId || '') === currentId;
      if (!directChild) continue;

      acceptedIds.add(candidateId);
      replies.push(reply);
      queue.push(candidateId);
      if (replies.length >= maxReplies) {
        terminatedReason = 'reply-limit';
        break;
      }
    }
  }

  const rootPageFailed = errors.some((item) => item.stage === 'page' && item.tweetId === rootId);
  const limited = terminatedReason !== 'exhausted';
  const partial = errors.length > 0 || limited;
  const status = rootPageFailed && replies.length === 0
    ? 'unavailable'
    : partial
      ? 'partial-via-logged-out-ssr'
      : replies.length
        ? 'available-via-logged-out-ssr'
        : 'none-visible-via-logged-out-ssr';

  return {
    status,
    replies,
    candidateIds,
    pageStatuses,
    pagesVisited: [...visitedPages],
    errors,
    rejectedCandidateIds,
    terminatedReason,
  };
}
