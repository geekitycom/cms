import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { responsiveImages } from './markup.ts';
import type { ImageRecord } from './variants.ts';

/** A landscape photograph with a WebP and a PNG at two widths each. */
const PHOTO: ImageRecord = {
  source: '2026/09/photo.png',
  width: 1000,
  height: 500,
  format: 'png',
  sourceModified: 1,
  variants: [
    { width: 320, height: 160, format: 'webp', file: '320.webp' },
    { width: 1000, height: 500, format: 'webp', file: '1000.webp' },
    { width: 320, height: 160, format: 'png', file: '320.png' },
    { width: 1000, height: 500, format: 'png', file: '1000.png' },
  ],
};

/** A lookup that knows about {@link PHOTO} and nothing else. */
function known(source: string): ImageRecord | undefined {
  return source === PHOTO.source ? PHOTO : undefined;
}

describe('responsiveImages', () => {
  it('offers WebP first and leaves the original as the fallback', () => {
    const html = responsiveImages(
      '<p><img src="/uploads/2026/09/photo.png" alt="A photo"></p>\n',
      known,
    );

    assert.equal(
      html,
      '<p><picture>' +
        '<source type="image/webp" srcset="/uploads/_/2026/09/photo.png/320.webp 320w, /uploads/_/2026/09/photo.png/1000.webp 1000w" sizes="100vw">' +
        '<img src="/uploads/2026/09/photo.png" alt="A photo"' +
        ' srcset="/uploads/_/2026/09/photo.png/320.png 320w, /uploads/_/2026/09/photo.png/1000.png 1000w"' +
        ' sizes="100vw" width="1000" height="500" loading="lazy">' +
        '</picture></p>\n',
    );
  });

  it('leaves an image from somewhere else alone', () => {
    const html = '<p><img src="https://example.com/photo.png" alt="Elsewhere"></p>\n';

    assert.equal(responsiveImages(html, known), html);
  });

  it('leaves an upload nothing has been derived from alone', () => {
    const html = '<p><img src="/uploads/2026/09/other.png" alt="Untouched"></p>\n';

    assert.equal(responsiveImages(html, known), html);
  });

  it('leaves a derived file alone, so a rewrite cannot rewrite itself', () => {
    const html = '<p><img src="/uploads/_/2026/09/photo.png/320.webp" alt="Already"></p>\n';

    assert.equal(responsiveImages(html, known), html);
  });

  it('keeps every attribute the author wrote, including a title', () => {
    const html = responsiveImages(
      '<img src="/uploads/2026/09/photo.png" alt="A photo" title="Taken in September" class="wide">',
      known,
    );

    assert.match(html, /alt="A photo"/);
    assert.match(html, /title="Taken in September"/);
    assert.match(html, /class="wide"/);
  });

  it('does not argue with dimensions the author set themselves', () => {
    const html = responsiveImages(
      '<img src="/uploads/2026/09/photo.png" alt="A photo" width="200" height="100" loading="eager">',
      known,
    );

    assert.match(html, /width="200"/);
    assert.match(html, /height="100"/);
    assert.match(html, /loading="eager"/);
    assert.doesNotMatch(html, /width="1000"/);
  });

  it('rewrites every image in a document, not only the first', () => {
    const html = responsiveImages(
      '<img src="/uploads/2026/09/photo.png" alt="One">\n<img src="/uploads/2026/09/photo.png" alt="Two">',
      known,
    );

    assert.equal(html.match(/<picture>/g)?.length, 2);
  });

  it('reads a percent-encoded path and writes the variant URLs back encoded', () => {
    const spaced: ImageRecord = {
      ...PHOTO,
      source: '2026/09/a photo.png',
      variants: [{ width: 320, height: 160, format: 'webp', file: '320.webp' }],
    };

    const html = responsiveImages(
      '<img src="/uploads/2026/09/a%20photo.png" alt="Spaced">',
      (source) => (source === spaced.source ? spaced : undefined),
    );

    assert.match(html, /srcset="\/uploads\/_\/2026\/09\/a%20photo\.png\/320\.webp 320w"/);
  });

  it('offers nothing but the original when the site derives only its own format', () => {
    const onlyPng: ImageRecord = {
      ...PHOTO,
      variants: [{ width: 320, height: 160, format: 'png', file: '320.png' }],
    };

    const html = responsiveImages(
      '<img src="/uploads/2026/09/photo.png" alt="A photo">',
      () => onlyPng,
    );

    assert.doesNotMatch(html, /<source/);
    assert.match(html, /<picture><img/);
  });

  it('leaves html with no images at all untouched', () => {
    const html = '<p>Words, and <a href="/uploads/2026/09/photo.png">a link to a photo</a>.</p>\n';

    assert.equal(responsiveImages(html, known), html);
  });
});
