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
