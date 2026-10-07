import fs from 'node:fs/promises';
import path from 'node:path';
import { findCaseRecords } from './case-layout.mjs';
import { createHash } from 'node:crypto';

export const MAX_PARENT_HOPS = 8;
export const tweetList = (source) => [source.rootTweet, ...(source.authorReplies || [])].filter(Boolean);
export const sourcePosts = (source) => [...tweetList(source), ...(source.relatedPosts || [])];
export function relationshipNode(tweet) {
  return { id: String(tweet.id), author: { id: String(tweet.author?.id || '') }, inReplyTo: tweet.inReplyTo?.tweetId ? { tweetId: String(tweet.inReplyTo.tweetId), userId: String(tweet.inReplyTo.userId || '') } : null };
}
export function mergeRelationshipNodes(...groups) {
  const nodes = new Map();
  for (const node of groups.flat()) {
    if (!/^\d+$/.test(node.id || '') || !/^\d+$/.test(node.author?.id || '') || !/^\d+$/.test(node.inReplyTo?.tweetId || '') || !/^\d+$/.test(node.inReplyTo?.userId || '')
      || Object.keys(node).some(key => !['id', 'author', 'inReplyTo'].includes(key)) || Object.keys(node.author).some(key => key !== 'id') || Object.keys(node.inReplyTo).some(key => !['tweetId', 'userId'].includes(key))) throw new Error('Invalid relationship metadata; comment content is forbidden');
    if (nodes.has(node.id) && JSON.stringify(nodes.get(node.id)) !== JSON.stringify(node)) throw new Error('Conflicting relationship metadata');
    nodes.set(node.id, node);
  }
  return [...nodes.values()];
}
export function validateRelatedPosts(source) {
  const primary = new Map(tweetList(source).map(tweet => [String(tweet.id), tweet]));
  const seen = new Set(primary.keys()), authorId = String(source.rootTweet.author?.id || '');
  for (const tweet of source.relatedPosts || []) {
    if (!/^\d+$/.test(tweet.id || '') || seen.has(String(tweet.id)) || String(tweet.author?.id || '') !== authorId) throw new Error('Invalid related post author/identity');
    const target = String(tweet.quotedTweetId || '');
    if (!primary.has(target)) throw new Error('Related post must directly quote a verified case member');
    seen.add(String(tweet.id));
  }
}
export function sameTweetSnapshot(a, b) {
  return String(a.id) === String(b.id) && a.text === b.text
    && String(a.author?.id || '') === String(b.author?.id || '')
    && String(a.inReplyTo?.tweetId || '') === String(b.inReplyTo?.tweetId || '')
    && JSON.stringify(a.linkEntities || []) === JSON.stringify(b.linkEntities || [])
    && JSON.stringify(a.article || null) === JSON.stringify(b.article || null)
    && String(a.quotedTweetId || '') === String(b.quotedTweetId || '');
}

// Parent edges, never similarity, mentions or conversation membership, establish ownership.
export function orderAuthorTweets(rootTweet, tweets, relationshipNodes = []) {
  const rootId = String(rootTweet.id), authorId = String(rootTweet.author?.id || '');
  if (!authorId) throw new Error('Missing numeric author identity');
  const map = new Map([[rootId, rootTweet]]);
  for (const tweet of tweets) {
    const id = String(tweet.id);
    if (!/^\d+$/.test(id) || String(tweet.author?.id || '') !== authorId) throw new Error('Thread author/ID mismatch');
    if (map.has(id) && !sameTweetSnapshot(map.get(id), tweet)) throw new Error('Conflicting snapshots for Tweet ' + id);
    if (map.has(id)) continue;
    map.set(id, tweet);
  }
  const pending = [...map.values()].filter((tweet) => String(tweet.id) !== rootId);
  const bridges = new Map(mergeRelationshipNodes(relationshipNodes).map(node => [node.id, node]));
  for (const id of bridges.keys()) if (map.has(id)) throw new Error('Relationship node overlaps author content');
  const connected = (tweet, accepted) => {
    const seen = new Set([String(tweet.id)]);
    let current = tweet;
    for (let hops = 0; current.inReplyTo?.tweetId; hops++) {
      if (hops >= MAX_PARENT_HOPS) throw new Error('Relationship chain exceeds the 8-hop limit');
      const parentId = String(current.inReplyTo.tweetId);
      if (seen.has(parentId)) throw new Error('Relationship cycle');
      seen.add(parentId);
      const parent = map.get(parentId) || bridges.get(parentId);
      if (!parent) return false;
      if (current.inReplyTo.userId && String(current.inReplyTo.userId) !== String(parent.author?.id)) throw new Error('Parent author identity mismatch');
      if (accepted.has(parentId)) return true;
      if (!bridges.has(parentId)) return false;
      current = parent;
    }
    return false;
  };
  const accepted = new Set([rootId]), ordered = [rootTweet];
  while (pending.length) {
    const children = pending.filter((tweet) => connected(tweet, accepted));
    if (!children.length) throw new Error('Thread has an unverified parent edge or cycle');
    children.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
    for (const child of children) {
      accepted.add(String(child.id)); ordered.push(child);
      pending.splice(pending.indexOf(child), 1);
    }
  }
  return ordered;
}

export async function localSources(root) {
  const sources = [];
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected link in case data');
      if (entry.isDirectory()) await visit(file);
      else if (entry.name === 'source.json') {
        const bytes = await fs.readFile(file);
        const source = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        const id = String(source.rootTweet?.id || source.tweetId || '');
        const staging = path.dirname(path.dirname(file)) === path.join(root, 'notes', 'x', '00-待整理') && /^\d+$/.test(path.basename(path.dirname(file)));
        sources.push({ source, sourcePath: file, sourceHash: createHash('sha256').update(bytes).digest('hex'), staging, id });
      }
    }
  }
  await visit(path.join(root, 'notes', 'x'));
  return sources;
}

export async function memberCases(root, tweetId) {
  const matches = [];
  for (const item of await localSources(root)) {
    if (item.staging || !tweetList(item.source).some((tweet) => String(tweet.id) === String(tweetId))) continue;
    const standalone = item.source.caseIdentity?.mode === 'standalone';
    if (standalone && item.id !== String(tweetId)) continue;
    const records = await findCaseRecords(root, item.id);
    matches.push(...records.filter((record) => record.sourcePath === item.sourcePath).map((record) => ({ ...record, caseId: item.id, standalone })));
  }
  const explicit = matches.filter((record) => record.standalone && record.caseId === String(tweetId));
  return explicit.length ? explicit : matches;
}

export async function resolveAuthorRoot(input, { lookup, fetchTweet, maxHops = MAX_PARENT_HOPS }) {
  const authorId = String(input.author?.id || '');
  if (!authorId) throw new Error('Missing input author identity');
  const walked = [input], seen = new Set([String(input.id)]);
  let root = input, rootIndex = 0;
  let current = input;
  for (let hops = 0; current.inReplyTo?.tweetId; hops++) {
    const parentId = String(current.inReplyTo.tweetId);
    const parentAuthor = String(current.inReplyTo.userId || '');
    if (!parentAuthor) throw new Error('Parent author identity is unknown; cannot normalize this reply');
    if (hops >= maxHops) throw new Error('Parent chain exceeds the 8-hop limit');
    if (seen.has(parentId)) throw new Error('Parent chain cycle');
    let parent = await lookup(parentId);
    if (!parent) parent = await fetchTweet(parentId, parentAuthor);
    if (String(parent?.id) !== parentId || String(parent.author?.id || '') !== parentAuthor) throw new Error('Parent identity mismatch');
    seen.add(parentId); walked.push(parent); current = parent;
    if (String(parent.author.id) === authorId) { root = parent; rootIndex = walked.length - 1; }
  }
  const connected = walked.slice(0, rootIndex + 1).reverse();
  return { root, chain: connected.filter(tweet => String(tweet.author.id) === authorId), relationshipNodes: connected.filter(tweet => String(tweet.author.id) !== authorId).map(relationshipNode), boundary: String(current.author?.id) === authorId ? 'no-parent' : 'different-author' };
}
