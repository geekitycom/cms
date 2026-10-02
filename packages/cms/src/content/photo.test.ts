import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { photoAlt, photoFrontMatter, photosOf } from './photo.ts';

describe('photosOf', () => {
  it('reads each photo with its alt text, in the order the front matter lists them', () => {
    assert.deepEqual(
      photosOf({
        photo: [
          { url: '/uploads/2026/10/beach.jpg', alt: 'Waves at dusk' },
          { url: 'https://cdn.example/dog.jpg' },
        ],
      }),
      [
        { url: '/uploads/2026/10/beach.jpg', alt: 'Waves at dusk' },
        { url: 'https://cdn.example/dog.jpg' },
      ],
    );
  });

  it('reads a bare address, and a single photo that is not in a list', () => {
    assert.deepEqual(photosOf({ photo: ['/uploads/a.jpg'] }), [{ url: '/uploads/a.jpg' }]);
    assert.deepEqual(photosOf({ photo: '/uploads/a.jpg' }), [{ url: '/uploads/a.jpg' }]);
    assert.deepEqual(photosOf({ photo: { url: '/uploads/a.jpg', alt: 'A' } }), [
      { url: '/uploads/a.jpg', alt: 'A' },
    ]);
  });

  it('drops an entry whose address is neither an upload nor a web address', () => {
    assert.deepEqual(
      photosOf({
        photo: ['beach.jpg', { url: '/uploads/../secret' }, { alt: 'no url' }, 7, '/uploads/b.jpg'],
      }),
      [{ url: '/uploads/b.jpg' }],
    );
  });

  it('is empty for a post without the key', () => {
    assert.deepEqual(photosOf({}), []);
  });
});

describe('photoFrontMatter', () => {
  it('writes each photo as url and alt, leaving out an alt nobody gave', () => {
    assert.deepEqual(
      photoFrontMatter([{ url: '/uploads/a.jpg', alt: 'A' }, { url: '/uploads/b.jpg' }]),
      [{ url: '/uploads/a.jpg', alt: 'A' }, { url: '/uploads/b.jpg' }],
    );
  });
});

describe('photoAlt (AC #7)', () => {
  const library = new Map([
    ['2026/10/beach.jpg', { kind: 'described' as const, text: 'Waves at dusk' }],
    ['2026/10/rule.png', { kind: 'decorative' as const }],
  ]);

  it('is the photo’s own alt text when it has one', () => {
    assert.equal(
      photoAlt({ url: '/uploads/2026/10/beach.jpg', alt: 'Our beach' }, library),
      'Our beach',
    );
  });

  it('is the media library’s alt text for an upload the post does not describe', () => {
    assert.equal(photoAlt({ url: '/uploads/2026/10/beach.jpg' }, library), 'Waves at dusk');
  });

  it('is empty for a decorative upload, and undefined when nobody described it', () => {
    assert.equal(photoAlt({ url: '/uploads/2026/10/rule.png' }, library), '');
    assert.equal(photoAlt({ url: '/uploads/2026/10/other.jpg' }, library), undefined);
    assert.equal(photoAlt({ url: 'https://cdn.example/dog.jpg' }, library), undefined);
  });
});
