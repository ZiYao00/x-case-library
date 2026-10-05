import { GuestTokenManager, createHttpScraper } from 'xactions/scrapers/twitter/http';

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

try {
  const tweet = await scraper.scrapeTweetById(tweetId);
  console.log(JSON.stringify({ ok: true, tweet }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    name: error?.name || 'Error',
    message: error?.message || String(error),
  }, null, 2));
  process.exit(1);
}
