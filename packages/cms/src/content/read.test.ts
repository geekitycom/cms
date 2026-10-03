import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readLine } from './read.ts';

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
    assert.match(line, /<span class="p-author">A &quot;B&quot; C<\/span>/);
    assert.match(line, /<data class="p-uid" value="doi:&quot;x&quot;">doi:&quot;x&quot;<\/data>/);
  });
});
