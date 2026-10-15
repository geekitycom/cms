import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readLine, readWork, readWorkFrontMatter } from './read.ts';

describe('the read line (TASK-233)', () => {
  it('links the work when it has a url and leaves out what it was not given', () => {
    assert.equal(
      readLine({
        status: 'reading',
        of: { name: 'A Paper', url: 'https://example.com/a?b=1&c=2' },
      }),
      '<p class="read-line"><data class="p-read-status" value="reading">Currently reading</data>: ' +
        '<span class="p-read-of h-cite"><a class="u-url" href="https://example.com/a?b=1&amp;c=2">' +
        '<cite class="p-name">A Paper</cite></a></span></p>\n',
    );
  });

  it('escapes what the author typed', () => {
    const line = readLine({
      status: 'to-read',
      of: { name: 'Tom & <Jerry>', author: 'A "B" C', uid: 'doi:"x"' },
    });

    assert.match(line, /<cite class="p-name">Tom &amp; &lt;Jerry&gt;<\/cite>/);
    assert.match(line, /<span class="p-author">A "B" C<\/span>/);
    assert.match(line, /<data class="p-uid" value="doi:&quot;x&quot;">doi:"x"<\/data>/);
  });
});

describe('a read citation’s cover (TASK-394)', () => {
  it('reads the cover off read-of, as an address or with alt text, and writes it back', () => {
    assert.deepEqual(
      readWork({
        name: 'Dune',
        photo: { url: '/uploads/2026/10/dune.jpg', alt: 'A desert under two moons' },
      }),
      {
        name: 'Dune',
        photo: { url: '/uploads/2026/10/dune.jpg', alt: 'A desert under two moons' },
      },
    );
    assert.deepEqual(readWork({ name: 'Dune', photo: 'https://covers.example/dune.jpg' }), {
      name: 'Dune',
      photo: { url: 'https://covers.example/dune.jpg' },
    });
    assert.deepEqual(readWork({ name: 'Dune', photo: 'not an address' }), { name: 'Dune' });
    assert.deepEqual(
      readWorkFrontMatter({ name: 'Dune', photo: { url: '/uploads/a.jpg', alt: undefined } }),
      { name: 'Dune', photo: { url: '/uploads/a.jpg' } },
    );
  });

  it('prints the cover as an img.u-photo inside the h-cite, with its alt text', () => {
    const line = readLine({
      status: 'finished',
      of: { name: 'Dune', photo: { url: '/uploads/a.jpg', alt: 'A "desert"' } },
    });
    assert.match(
      line,
      /<span class="p-read-of h-cite"><span class="read-cover"><img class="u-photo" src="\/uploads\/a.jpg" alt="A &quot;desert&quot;"><\/span>/,
    );
  });

  it('takes the alt text from the media library when the post gives none, and goes absolute on a base URL', () => {
    const line = readLine(
      { status: 'finished', of: { name: 'Dune', photo: { url: '/uploads/a.jpg' } } },
      {
        library: new Map([['a.jpg', { kind: 'described', text: 'A cover' }]]),
        baseUrl: 'https://site.example',
      },
    );
    assert.match(
      line,
      /<img class="u-photo" src="https:\/\/site.example\/uploads\/a.jpg" alt="A cover">/,
    );
  });

  it('leaves the cover out of the words a read is summarised with', () => {
    assert.equal(
      readLine({
        status: 'finished',
        of: { name: 'Dune', photo: { url: '/uploads/a.jpg', alt: 'Sand' } },
      }).replace(/<[^>]*>/g, ''),
      'Finished reading: Dune\n',
    );
  });
});
