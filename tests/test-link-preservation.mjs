import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linkifyProse,
  normalizeFxArticlePayload,
  normalizeTweetLinkEntities,
  renderArticleBlocks,
  unwrapMarkdownDocument,
} from '../scripts/x-link-preservation.mjs';

test('tweet URL and mention entities become Markdown links without using invalid source indices', () => {
  const raw = {
    legacy: {
      full_text: '🚀 推荐 @karpathy，也看看 https://t.co/abc',
      entities: {
        urls: [{
          url: 'https://t.co/abc',
          expanded_url: 'https://example.com/tool?a=1',
          display_url: 'example.com/tool',
          indices: [99, 120],
        }],
        user_mentions: [{ screen_name: 'karpathy', indices: [99, 110] }],
      },
    },
  };
  const parsed = { text: raw.legacy.full_text, urls: [] };
  const entities = normalizeTweetLinkEntities(raw, parsed, false);
  assert.equal(
    linkifyProse(parsed.text, entities),
    '🚀 推荐 [@karpathy](https://x.com/karpathy)，也看看 [example.com/tool](https://example.com/tool?a=1)',
  );
});

test('link rendering respects explicit occurrence and mention boundaries', () => {
  const text = 'OpenRouter 和 OpenRouter；@foo 与 @foobar';
  const second = text.lastIndexOf('OpenRouter');
  const rendered = linkifyProse(text, [
    { type: 'url', token: 'OpenRouter', label: 'OpenRouter', target: 'https://openrouter.ai/', start: second, end: second + 'OpenRouter'.length },
    { type: 'mention', token: '@foo', label: '@foo', target: 'https://x.com/foo' },
  ]);
  assert.equal(
    rendered,
    'OpenRouter 和 [OpenRouter](https://openrouter.ai/)；[@foo](https://x.com/foo) 与 @foobar',
  );
});

test('untrusted prose Markdown, wiki links and raw HTML are neutralized', () => {
  const text = '外部 ![](https://example.com/pixel.png) [[Local Note]] <img src="https://example.com/p.gif"> #tag ' + '$' + 'x' + '$';
  const rendered = linkifyProse(text, []);
  assert.ok(!rendered.includes('![]('));
  assert.ok(!rendered.includes('[['));
  assert.match(rendered, /\\!\\\[\\\]/);
  assert.match(rendered, /\\<img/);
  assert.match(rendered, /\\#tag/);
  assert.match(rendered, /\\\$x\\\$/);
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

test('FxTwitter Article media only accepts trusted X CDN HTTPS URLs', () => {
  const base = {
    code: 200,
    tweet: {
      id: '123',
      article: {
        id: '456',
        title: '媒体边界',
        media_entities: [],
        content: { entityMap: [], blocks: [] },
      },
    },
  };

  const blocked = structuredClone(base);
  blocked.tweet.article.cover_media = {
    media_id: 'cover',
    media_info: { original_img_url: 'http://127.0.0.1:12345/private' },
  };
  const blockedArticle = normalizeFxArticlePayload(blocked, { tweetId: '123', articleId: '456' });
  assert.equal(blockedArticle.media.length, 0);
  assert.equal(blockedArticle.unsupportedMediaCount, 1);

  const allowed = structuredClone(base);
  allowed.tweet.article.cover_media = {
    media_id: 'cover',
    media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' },
  };
  const allowedArticle = normalizeFxArticlePayload(allowed, { tweetId: '123', articleId: '456' });
  assert.equal(allowedArticle.media.length, 1);
  assert.equal(allowedArticle.unsupportedMediaCount, 0);
});

test('FxTwitter Article MARKDOWN atomic entities are preserved and unwrap deterministically', () => {
  const rawMarkdown = '```markdown\n---\nname: beauty-image-defaults\n---\n\n# Skill\n\n```text\ninner\n```\n```';
  const payload = {
    code: 200,
    tweet: {
      id: '123',
      article: {
        id: '456',
        title: 'Skill',
        media_entities: [],
        content: {
          entityMap: [
            { key: '0', value: { type: 'MARKDOWN', mutability: 'Mutable', data: { markdown: rawMarkdown } } },
          ],
          blocks: [
            { type: 'unstyled', text: '文件名使用 SKILL.md，以下保留完整内容：', data: {}, entityRanges: [] },
            { type: 'atomic', text: ' ', data: {}, entityRanges: [{ offset: 0, length: 1, key: 0 }] },
          ],
        },
      },
    },
  };

  const article = normalizeFxArticlePayload(payload, { tweetId: '123', articleId: '456' });
  assert.equal(article.documents.length, 1);
  assert.equal(article.documents[0].type, 'markdown');
  assert.equal(article.documents[0].sourceFilename, 'SKILL.md');
  assert.equal(article.documents[0].rawMarkdown, rawMarkdown);
  assert.deepEqual(article.blocks[1].atomic, { type: 'MARKDOWN', entityKey: '0', documentIndex: 0 });
  assert.equal(article.unsupportedAtomicCount, 0);

  const unwrapped = unwrapMarkdownDocument(rawMarkdown);
  assert.equal(unwrapped.unwrapped, true);
  assert.equal(unwrapped.content, '---\nname: beauty-image-defaults\n---\n\n# Skill\n\n```text\ninner\n```\n');
  const rendered = renderArticleBlocks(article, { renderDocument: () => '📄 **[[X案例库/_case-data/123/documents/123_SKILL.md|打开附件：SKILL.md]]**' });
  assert.match(rendered, /打开附件：SKILL\.md/);
});

test('unknown FxTwitter Article atomic entities are recorded instead of silently dropped', () => {
  const article = normalizeFxArticlePayload({
    code: 200,
    tweet: {
      id: '123',
      article: {
        id: '456',
        media_entities: [],
        content: {
          entityMap: [{ key: '0', value: { type: 'EMBED', data: { id: 'x' } } }],
          blocks: [{ type: 'atomic', text: ' ', data: {}, entityRanges: [{ offset: 0, length: 1, key: 0 }] }],
        },
      },
    },
  }, { tweetId: '123', articleId: '456' });
  assert.equal(article.unsupportedAtomicCount, 1);
  assert.deepEqual(article.blocks[0].atomic, { type: 'UNSUPPORTED', entityKey: '0', entityType: 'EMBED' });
});

test('FxTwitter identity mismatch is rejected', () => {
  assert.throws(() => normalizeFxArticlePayload({
    code: 200,
    tweet: { id: '999', article: { id: '456', content: { blocks: [] } } },
  }, { tweetId: '123', articleId: '456' }), /Tweet ID mismatch/);
});

test('shuffled Article entity keys preserve media and both Prompt positions', () => {
  const article = normalizeFxArticlePayload({ code: 200, tweet: { id: '123', article: {
    id: '456', media_entities: [], content: {
      entityMap: [
        { key: '4', value: { type: 'MARKDOWN', data: { markdown: '场景图片 Prompt' } } },
        { key: '1', value: { type: 'MEDIA', data: {} } },
        { key: '0', value: { type: 'MEDIA', data: {} } },
        { key: '2', value: { type: 'MARKDOWN', data: { markdown: '角色图片 Prompt' } } },
      ],
      blocks: [0, 1, 2, 4].map(key => ({ type: 'atomic', text: ' ', entityRanges: [{ offset: 0, length: 1, key }] })),
    },
  } } }, { tweetId: '123', articleId: '456' });
  assert.deepEqual(article.blocks.map(block => block.atomic.type), ['MEDIA', 'MEDIA', 'MARKDOWN', 'MARKDOWN']);
  assert.deepEqual(article.documents.map(document => [document.entityKey, document.rawMarkdown]), [['2', '角色图片 Prompt'], ['4', '场景图片 Prompt']]);
  assert.equal(article.unsupportedAtomicCount, 0);
});

test('keyed Article entity arrays never fall back to an unrelated index', () => {
  const payload = map => ({ code: 200, tweet: { id: '123', article: { id: '456', content: {
    entityMap: map, blocks: [{ type: 'unstyled', text: '官网', entityRanges: [{ offset: 0, length: 2, key: 0 }] }],
  } } } });
  const link = { type: 'LINK', data: { url: 'https://example.com/' } };
  const expected = { tweetId: '123', articleId: '456' };
  assert.deepEqual(normalizeFxArticlePayload(payload([{ key: '8', value: link }]), expected).blocks[0].links, []);
  assert.equal(normalizeFxArticlePayload(payload([link]), expected).blocks[0].links[0].target, 'https://example.com/');
  assert.equal(normalizeFxArticlePayload(payload({ 0: link }), expected).blocks[0].links[0].target, 'https://example.com/');
  assert.throws(() => normalizeFxArticlePayload(payload([{ key: '0', value: link }, { key: '0', value: link }]), expected), /Duplicate Article entity key/);
});

test('Article videos select the highest bitrate trusted MP4 regardless of variant order', () => {
  const article = normalizeFxArticlePayload({ code: 200, tweet: { id: '123', article: {
    id: '456', media_entities: [{ media_id: '789', media_info: {
      __typename: 'ApiVideo', preview_image: { original_img_url: 'https://pbs.twimg.com/video-thumb.jpg' },
      variants: [
        { bit_rate: 9000, content_type: 'video/mp4', url: 'https://example.com/unsafe.mp4' },
        { bit_rate: 100, content_type: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
        { bit_rate: 99999, content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/video.m3u8' },
        { bit_rate: 300, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
        { bit_rate: 10000, content_type: 'video/mp4', url: 'http://video.twimg.com/insecure.mp4' },
        { bit_rate: 10000, content_type: 'video/mp4', url: 'https://user:pass@video.twimg.com/credential.mp4' },
      ],
    } }], content: { entityMap: [], blocks: [] },
  } } }, { tweetId: '123', articleId: '456' });
  assert.deepEqual(article.media, [{ type: 'video', videoUrl: 'https://video.twimg.com/high.mp4', articleRole: 'inline', mediaId: '789' }]);
  assert.equal(article.unsupportedMediaCount, 0);
});

test('Article videos without a trusted MP4 stay unsupported instead of becoming thumbnail photos', () => {
  const article = normalizeFxArticlePayload({ code: 200, tweet: { id: '123', article: {
    id: '456', media_entities: [{ media_info: {
      __typename: 'ApiVideo', original_img_url: 'https://pbs.twimg.com/thumbnail.jpg',
      variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/video.m3u8' }],
    } }], content: { entityMap: [], blocks: [] },
  } } }, { tweetId: '123', articleId: '456' });
  assert.equal(article.media.length, 0);
  assert.equal(article.unsupportedMediaCount, 1);
});
