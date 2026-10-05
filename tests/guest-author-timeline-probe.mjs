import { Scraper } from 'xactions/client';

const username = 'Noor_ul_ain43';
const targetId = '2106679751566094429';
const scraper = new Scraper();

const items = [];
for await (const tweet of scraper.getTweetsAndReplies(username, 20)) {
  items.push(tweet);
}

const compact = items.map((t) => ({
  id: t.id,
  text: t.text,
  createdAt: t.createdAt,
  username: t.username ?? t.author?.username ?? null,
  inReplyToStatusId: t.inReplyToStatusId ?? t.inReplyTo?.tweetId ?? null,
  inReplyToUsername: t.inReplyToUsername ?? t.inReplyTo?.username ?? null,
  media: t.media ?? t.photos ?? t.videos ?? null,
}));

const target = compact.find((t) => String(t.id) === targetId) || null;

console.log(JSON.stringify({
  count: compact.length,
  foundTarget: Boolean(target),
  target,
  items: compact,
}, null, 2));
