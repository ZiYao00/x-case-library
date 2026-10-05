import fs from 'node:fs/promises';

const sourcePath = 'tests/cases/2106928507809100018/source.json';
const replyPath = 'tests/elsa-author-reply-2106928513710518539.json';

const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const reply = JSON.parse(await fs.readFile(replyPath, 'utf8'));

const safeReply = {
  id: reply.id,
  text: reply.text,
  createdAt: reply.createdAt,
  author: reply.author
    ? {
        id: reply.author.id,
        username: reply.author.username,
        name: reply.author.name,
      }
    : null,
  media: Array.isArray(reply.media) ? reply.media : [],
  urls: Array.isArray(reply.urls) ? reply.urls : [],
  inReplyTo: reply.inReplyTo || null,
  lang: reply.lang || null,
};

source.authorReplies = [safeReply];
source.acquisition.authorRepliesStatus = 'available-via-logged-out-ssr';
source.acquisition.authorRepliesDiscovery = 'logged-out-page-ssr';
source.acquisition.authorReplyExactFetch = 'TweetResultByRestId';
source.completeness.authorRepliesStatus = 'available-via-logged-out-ssr';
source.completeness.hasMoreConversation = null;
source.completeness.authorRepliesError = null;
source.completeness.note =
  'Logged-out X page SSR surfaced one original-author self-reply. That reply was then fetched exactly via Guest TweetResultByRestId. This proves author-reply capture for visible SSR replies but does not prove the page exposed every possible author reply.';

const mediaRecord = {
  tweetId: reply.id,
  type: 'photo',
  remoteUrl: 'https://pbs.twimg.com/media/HT1QOW-a0AAdZcW.jpg?name=orig',
  localPath: 'media/002_2106928513710518539_photo_1.jpg',
  bytes: 332838,
  status: 'downloaded',
};

if (!source.mediaFiles.some((m) => m.localPath === mediaRecord.localPath)) {
  source.mediaFiles.push(mediaRecord);
}

await fs.writeFile(sourcePath, JSON.stringify(source, null, 2), 'utf8');
console.log(JSON.stringify({
  authorReplyCount: source.authorReplies.length,
  mediaFiles: source.mediaFiles.length,
  authorRepliesStatus: source.acquisition.authorRepliesStatus,
}, null, 2));
