import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { enclosureOf, isCaptions, playsAsVideo } from './enclosure.ts';

const main = { url: '/uploads/2026/10/episode.mp3', type: 'audio/mpeg', length: 23456789 };

describe('enclosureOf (TASK-213)', () => {
  it('reads the whole recording the front matter describes', () => {
    assert.deepEqual(
      enclosureOf({
        enclosure: {
          ...main,
          duration: 1834,
          transcript: { url: '/uploads/2026/10/episode.vtt', type: 'text/vtt' },
          alternates: [
            {
              url: '/uploads/2026/10/episode.mp4',
              type: 'video/mp4',
              length: 98765432,
              title: 'Video',
              height: 720,
              lang: 'en',
            },
            { url: 'https://cdn.example.com/low.mp3', type: 'audio/mpeg', title: 'Low bandwidth' },
          ],
        },
      }),
      {
        ...main,
        duration: 1834,
        transcript: { url: '/uploads/2026/10/episode.vtt', type: 'text/vtt' },
        alternates: [
          {
            url: '/uploads/2026/10/episode.mp4',
            type: 'video/mp4',
            length: 98765432,
            title: 'Video',
            height: 720,
            lang: 'en',
          },
          { url: 'https://cdn.example.com/low.mp3', type: 'audio/mpeg', title: 'Low bandwidth' },
        ],
      },
    );
  });

  it('is nothing for a post that has none', () => {
    assert.equal(enclosureOf({}), undefined);
    assert.equal(enclosureOf({ enclosure: 'episode.mp3' }), undefined);
  });

  it('is nothing when the main file lacks what RSS requires', () => {
    assert.equal(enclosureOf({ enclosure: { ...main, url: undefined } }), undefined);
    assert.equal(enclosureOf({ enclosure: { ...main, type: '' } }), undefined);
    assert.equal(enclosureOf({ enclosure: { ...main, length: 0 } }), undefined);
    assert.equal(enclosureOf({ enclosure: { ...main, length: 12.5 } }), undefined);
    assert.equal(enclosureOf({ enclosure: { ...main, length: '23456789' } }), undefined);
  });

  it('takes the main file only from the media library', () => {
    assert.equal(
      enclosureOf({ enclosure: { ...main, url: 'https://cdn.example.com/episode.mp3' } }),
      undefined,
    );
    assert.equal(
      enclosureOf({ enclosure: { ...main, url: '/uploads/../data/users.json' } }),
      undefined,
    );
  });

  it('drops a bad alternate version or transcript and keeps the rest', () => {
    const enclosure = enclosureOf({
      enclosure: {
        ...main,
        duration: -3,
        transcript: { url: '/uploads/2026/10/episode.vtt', type: 'application/pdf' },
        alternates: [
          { url: 'https://cdn.example.com/a.mp4' },
          { url: 'ftp://example.com/b.mp3', type: 'audio/mpeg' },
          'not a version',
          {
            url: 'https://cdn.example.com/c.mp3',
            type: 'audio/mpeg',
            title: 'A title far longer than any player would show',
            height: 'tall',
          },
        ],
      },
    });

    assert.deepEqual(enclosure, {
      ...main,
      alternates: [{ url: 'https://cdn.example.com/c.mp3', type: 'audio/mpeg' }],
    });
  });
});

describe('playsAsVideo', () => {
  it('plays video types as video and everything else as audio', () => {
    assert.equal(playsAsVideo('video/mp4'), true);
    assert.equal(playsAsVideo('Video/WebM'), true);
    assert.equal(playsAsVideo('audio/mpeg'), false);
    assert.equal(playsAsVideo('audio/ogg'), false);
  });
});

describe('isCaptions', () => {
  it('is true for the timed formats only', () => {
    assert.equal(isCaptions({ url: '/uploads/a.vtt', type: 'text/vtt' }), true);
    assert.equal(isCaptions({ url: '/uploads/a.srt', type: 'application/x-subrip' }), true);
    assert.equal(isCaptions({ url: '/uploads/a.txt', type: 'text/plain' }), false);
    assert.equal(isCaptions({ url: 'https://example.com/a', type: 'text/html' }), false);
  });
});
