import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linkifyProse,
  normalizeFxArticlePayload,
  normalizeTweetLinkEntities,
  renderArticleBlocks,
} from '../scripts/x-link-preservation.mjs';

test('tweet URL and mention entities become Markdown links without using source indices', () => {
  const raw = {
    legacy: {
      entities: {
        urls: [{
          url: 'https://t.co/abc',
          expanded_url: 'https://example.com/tool?a=1',
          display_url: 'example.com/tool',
          indices: [99, 120],
        }],
        user_mentions: [{ screen_name: 'karpathy', indices: [1, 10] }],
      },
    },
  };
  const parsed = { urls: [] };
  const entities = normalizeTweetLinkEntities(raw, parsed, false);
  const text = '🚀 推荐 @karpathy，也看看 https://t.co/abc';
  assert.equal(
    linkifyProse(text, entities),
    '🚀 推荐 [@karpathy](https://x.com/karpathy)，也看看 [example.com/tool](https://example.com/tool?a=1)',
  );
});

test('only http/https targets are linkified', () => {
  const text = '官网和危险链接';
  const rendered = linkifyProse(text, [
    { type: 'url', token: '官网', label: '官网', target: 'https://example.com/' },
    { type: 'url', token: '危险链接', label: '危险链接', target: 'javascript:alert(1)' },
  ]);
  assert.equal(rendered, '[官网](https://example.com/)和危险链接');
});

test('FxTwitter Article mentions and website links normalize to the same Markdown format', () => {
  const payload = {
    code: 200,
    tweet: {
      id: '123',
      article: {
        id: '456',
        title: '推荐清单',
        preview_text: '预览',
        cover_media: {
          media_id: 'cover',
          media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' },
        },
        media_entities: [],
        content: {
          entityMap: [{
            type: 'LINK',
            data: { url: 'https://example.com/docs' },
          }],
          blocks: [
            {
              type: 'unstyled',
              text: '🚀 推荐 @karpathy 和 OpenRouter',
              data: {
                mentions: [{ fromIndex: 5, toIndex: 14, text: 'karpathy' }],
                links: [{ text: 'OpenRouter', url: 'https://openrouter.ai/' }],
              },
              entityRanges: [],
            },
            {
              type: 'unstyled',
              text: '💡 官网 Example',
              data: {},
              entityRanges: [{ offset: 6, length: 7, key: 0 }],
            },
          ],
        },
      },
    },
  };

  const article = normalizeFxArticlePayload(payload, {
    tweetId: '123',
    articleId: '456',
    sourceUrl: 'https://x.com/i/article/456',
  });

  assert.equal(article.status, 'available');
  assert.equal(article.media.length, 1);
  assert.equal(article.media[0].articleRole, 'cover');
  assert.deepEqual(article.blocks[0].links.map((item) => item.target), [
    'https://x.com/karpathy',
    'https://openrouter.ai/',
  ]);

  const markdown = renderArticleBlocks(article);
  assert.match(markdown, /\[@karpathy\]\(https:\/\/x\.com\/karpathy\)/);
  assert.match(markdown, /\[OpenRouter\]\(https:\/\/openrouter\.ai\/\)/);
  assert.match(markdown, /\[Example\]\(https:\/\/example\.com\/docs\)/);
});

test('FxTwitter identity mismatch is rejected', () => {
  assert.throws(() => normalizeFxArticlePayload({
    code: 200,
    tweet: { id: '999', article: { id: '456', content: { blocks: [] } } },
  }, { tweetId: '123', articleId: '456' }), /Tweet ID mismatch/);
});
