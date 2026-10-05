import {
  GuestTokenManager,
  createHttpScraper,
  GRAPHQL,
} from 'xactions/scrapers/twitter/http';

const tweetId = '2106679751566094429';
const guest = new GuestTokenManager({ poolSize: 0 });

const guestFetch = async (url, init = {}) => {
  const headers = {
    ...(await guest.getHeaders({ method: init.method || 'GET', path: String(url), transactionId: false })),
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
});

const { queryId, operationName } = GRAPHQL.TweetResultByRestId;
const resp = await scraper.client.graphql(queryId, operationName, {
  tweetId,
  withCommunity: false,
  includePromotedContent: false,
  withVoice: false,
});

const result = resp?.data?.tweetResult?.result ?? null;
const noteText = result?.note_tweet?.note_tweet_results?.result?.text ?? null;

console.log(JSON.stringify({
  ok: Boolean(result),
  restId: result?.rest_id ?? null,
  noteText,
  legacyFullText: result?.legacy?.full_text ?? null,
  hasNoteTweet: Boolean(noteText),
}, null, 2));
