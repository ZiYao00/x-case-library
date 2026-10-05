import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { extractAuthorReplyIdsFromSsr, walkAuthorReplyThread } from '../config/ssr-author-replies.mjs';

const elsa = await fs.readFile('tests/target-elsa-status-logged-out.html', 'utf8');
const noor = await fs.readFile('tests/target-status-logged-out.html', 'utf8');

const elsaIds = extractAuthorReplyIdsFromSsr(elsa, 'ElsaSofia__AI');
const noorIds = extractAuthorReplyIdsFromSsr(noor, 'Noor_ul_ain43');
assert.deepEqual(elsaIds, ['2106928513710518539']);
assert.deepEqual(noorIds, []);

const entry = (id, author = 'author') => `entry_id:conversationthread-${id}-tweet-${id} screen_name:"${author}" `;
const pages = new Map([
  ['100', entry('101') + entry('102') + entry('999', 'ordinary_user')],
  ['101', entry('102')],
  ['102', 'entry_id:empty'],
]);
const tweets = new Map([
  ['101', { id: '101', text: 'reply 1', author: { id: '9', username: 'author' }, inReplyTo: { tweetId: '100' } }],
  ['102', { id: '102', text: 'reply 2', author: { id: '9', username: 'author' }, inReplyTo: { tweetId: '101' } }],
  ['999', { id: '999', text: 'ordinary reply', author: { id: '8', username: 'ordinary_user' }, inReplyTo: { tweetId: '100' } }],
]);

let exactFetches = 0;
const walked = await walkAuthorReplyThread({
  rootTweet: { id: '100', author: { id: '9', username: 'author' } },
  sourceUrl: 'https://x.com/author/status/100',
  fetchPage: async (id) => ({ status: 200, html: pages.get(id) || '' }),
  fetchTweet: async (id) => { exactFetches++; return tweets.get(id); },
});
assert.equal(walked.status, 'available-via-logged-out-ssr');
assert.deepEqual(walked.replies.map((item) => item.id), ['101', '102']);
assert.deepEqual(walked.pagesVisited, ['100', '101', '102']);
assert.deepEqual(walked.candidateIds, ['101', '102']);
assert.deepEqual(walked.rejectedCandidateIds, []);
assert.equal(exactFetches, 2, 'Only author candidates should be returned by SSR extraction, and descendants should be fetched once.');

const partial = await walkAuthorReplyThread({
  rootTweet: { id: '100', author: { id: '9', username: 'author' } },
  sourceUrl: 'https://x.com/author/status/100',
  fetchPage: async (id) => {
    if (id === '101') throw new Error('fixture page failure');
    return { status: 200, html: pages.get(id) || '' };
  },
  fetchTweet: async (id) => tweets.get(id),
});
assert.equal(partial.status, 'partial-via-logged-out-ssr');
assert.deepEqual(partial.replies.map((item) => item.id), ['101']);
assert.equal(partial.errors[0].stage, 'page');

const exactAttempts = new Map();
const noRetry = await walkAuthorReplyThread({
  rootTweet: { id: '100', author: { id: '9', username: 'author' } },
  sourceUrl: 'https://x.com/author/status/100',
  fetchPage: async (id) => ({ status: 200, html: pages.get(id) || '' }),
  fetchTweet: async (id) => {
    exactAttempts.set(id, (exactAttempts.get(id) || 0) + 1);
    if (id === '102') throw new Error('fixture exact fetch failure');
    return tweets.get(id);
  },
});
assert.equal(noRetry.status, 'partial-via-logged-out-ssr');
assert.deepEqual(noRetry.replies.map((item) => item.id), ['101']);
assert.equal(exactAttempts.get('102'), 1, 'A failed exact fetch must not be retried when the same candidate appears on another page.');

const limited = await walkAuthorReplyThread({
  rootTweet: { id: '100', author: { id: '9', username: 'author' } },
  sourceUrl: 'https://x.com/author/status/100',
  maxReplies: 1,
  fetchPage: async (id) => ({ status: 200, html: pages.get(id) || '' }),
  fetchTweet: async (id) => tweets.get(id),
});
assert.equal(limited.status, 'partial-via-logged-out-ssr');
assert.equal(limited.terminatedReason, 'reply-limit');
assert.deepEqual(limited.replies.map((item) => item.id), ['101']);

console.log(JSON.stringify({
  elsa: elsaIds,
  noor: noorIds,
  syntheticMultiHop: walked.replies.map((item) => item.id),
  partialStatus: partial.status,
  limitStatus: limited.status,
}, null, 2));
