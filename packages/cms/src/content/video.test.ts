import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkdown } from './markdown.ts';
import { videoOf } from './video.ts';

describe('videoOf', () => {
  const youtube = (id: string, start?: number) => ({
    provider: 'youtube',
    id,
    ...(start === undefined ? {} : { start }),
  });

  for (const [url, expected] of [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL1', youtube('dQw4w9WgXcQ')],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['http://youtu.be/dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', youtube('dQw4w9WgXcQ', 42)],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s', youtube('dQw4w9WgXcQ', 3723)],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?start=90', youtube('dQw4w9WgXcQ', 90)],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://vimeo.com/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://www.vimeo.com/76979871/', { provider: 'vimeo', id: '76979871' }],
    [
      'https://vimeo.com/76979871/8d9b3a7e1c',
      { provider: 'vimeo', id: '76979871', hash: '8d9b3a7e1c' },
    ],
    ['https://vimeo.com/channels/staffpicks/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://player.vimeo.com/video/76979871', { provider: 'vimeo', id: '76979871' }],
    [
      'https://player.vimeo.com/video/76979871?h=8d9b3a7e1c',
      { provider: 'vimeo', id: '76979871', hash: '8d9b3a7e1c' },
    ],
  ] as const) {
    it(`recognises ${url}`, () => {
      assert.deepEqual(videoOf(url), expected);
    });
  }

  for (const url of [
    'https://www.youtube.com/',
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@somebody',
    'https://youtu.be/',
    'https://vimeo.com/somebody',
    'https://vimeo.com/76979871/not-a-hash',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'not a url',
  ]) {
    it(`does not recognise ${url}`, () => {
      assert.equal(videoOf(url), undefined);
    });
  }
});

describe('a video in Markdown', () => {
  it('renders a YouTube URL alone on its line as a player with a link to the video', () => {
    const html = renderMarkdown(
      'Before.\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nAfter.\n',
    );

    assert.equal(
      html,
      [
        '<p>Before.</p>',
        '<figure class="video-embed video-embed-youtube">' +
          '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" width="560" height="315"' +
          ' title="YouTube video" loading="lazy"' +
          ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"' +
          ' referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>' +
          '<figcaption><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a></figcaption>' +
          '</figure>',
        '<p>After.</p>',
        '',
      ].join('\n'),
    );
  });

  it('starts a YouTube player at the time the URL names', () => {
    assert.match(
      renderMarkdown('https://youtu.be/dQw4w9WgXcQ?t=42\n'),
      /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?start=42"/,
    );
  });

  it('renders a Vimeo URL as a player that does not track the reader', () => {
    const html = renderMarkdown('<https://vimeo.com/76979871/8d9b3a7e1c>\n');

    assert.match(html, /^<figure class="video-embed video-embed-vimeo">/);
    assert.match(
      html,
      /src="https:\/\/player\.vimeo\.com\/video\/76979871\?h=8d9b3a7e1c&amp;dnt=1"/,
    );
    assert.match(html, / title="Vimeo video"/);
    assert.match(
      html,
      /<figcaption><a href="https:\/\/vimeo\.com\/76979871\/8d9b3a7e1c">https:\/\/vimeo\.com\/76979871\/8d9b3a7e1c<\/a><\/figcaption>/,
    );
  });

  it('leaves a video URL inside a sentence a link', () => {
    assert.equal(
      renderMarkdown('Watch https://youtu.be/dQw4w9WgXcQ now.\n'),
      '<p>Watch <a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a> now.</p>\n',
    );
  });

  it('leaves a video link the author gave words of its own a link', () => {
    assert.equal(
      renderMarkdown('[the talk](https://youtu.be/dQw4w9WgXcQ)\n'),
      '<p><a href="https://youtu.be/dQw4w9WgXcQ">the talk</a></p>\n',
    );
  });

  it('leaves a video URL in a list item a link', () => {
    assert.doesNotMatch(renderMarkdown('- https://youtu.be/dQw4w9WgXcQ\n'), /<iframe/);
  });

  it('leaves a URL it does not recognise as a video a plain link', () => {
    assert.equal(
      renderMarkdown('https://www.youtube.com/playlist?list=PL1\n'),
      '<p><a href="https://www.youtube.com/playlist?list=PL1">https://www.youtube.com/playlist?list=PL1</a></p>\n',
    );
    assert.equal(
      renderMarkdown('https://example.com/watch?v=dQw4w9WgXcQ\n'),
      '<p><a href="https://example.com/watch?v=dQw4w9WgXcQ">https://example.com/watch?v=dQw4w9WgXcQ</a></p>\n',
    );
  });
});
