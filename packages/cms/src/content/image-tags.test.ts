import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { imagesIn, parseAttributes, uploadPath } from './image-tags.ts';

describe('imagesIn', () => {
  it('lists every image with a src, in order, with the upload it points at', () => {
    const html =
      '<p><img src="/uploads/2026/09/dog.jpg" alt="A dog"> and ' +
      '<img alt="" src="https://elsewhere.example/cat.png" /> and <img alt="no source"></p>';

    assert.deepEqual(imagesIn(html), [
      { src: '/uploads/2026/09/dog.jpg', source: '2026/09/dog.jpg', alt: 'A dog' },
      { src: 'https://elsewhere.example/cat.png', source: undefined, alt: '' },
    ]);
  });

  it('tells an image with no alt attribute from one with an empty alt', () => {
    assert.deepEqual(imagesIn('<img src="/uploads/a.png">'), [
      { src: '/uploads/a.png', source: 'a.png', alt: undefined },
    ]);
  });

  it('reads past a > inside a quoted attribute', () => {
    assert.deepEqual(imagesIn(`<img alt="1 > 0" title='a > b' src="/uploads/a.png">`), [
      { src: '/uploads/a.png', source: 'a.png', alt: '1 > 0' },
    ]);
  });
});

describe('uploadPath', () => {
  it('is the path under uploads, decoded', () => {
    assert.equal(uploadPath('/uploads/2026/09/my%20dog.jpg'), '2026/09/my dog.jpg');
  });

  it('is undefined for a derived file, another site, a climb or a bad escape', () => {
    for (const src of [
      '/uploads/_/2026/09/dog.jpg/640.webp',
      'https://elsewhere.example/uploads/dog.jpg',
      '/uploads/../secret',
      '/uploads/x%2F..%2F..%2Fsecret',
      '/uploads/%2E%2E/secret',
      '/uploads/2026//dog.jpg',
      '/uploads/',
      '/uploads/%E0%A4%A',
    ]) {
      assert.equal(uploadPath(src), undefined, src);
    }
  });
});

describe('parseAttributes', () => {
  it('reads every quoting, lower-cases names, decodes entities and keeps the first', () => {
    const parsed = parseAttributes(`SRC="/a.png" alt='Fish &amp; chips' width=10 src="/b.png"`);
    assert.deepEqual(Object.fromEntries(parsed), {
      src: '/a.png',
      alt: 'Fish & chips',
      width: '10',
    });
  });
});
