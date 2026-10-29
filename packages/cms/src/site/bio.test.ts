import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bioHtml, bioText } from './bio.ts';

describe('a bio as HTML', () => {
  it('renders a link, emphasis and code', () => {
    assert.equal(
      bioHtml('Start [here](/start/), *then* `read`.'),
      '<p>Start <a href="/start/">here</a>, <em>then</em> <code>read</code>.</p>\n',
    );
  });

  it('gives every paragraph its own element', () => {
    assert.equal(bioHtml('One.\n\nTwo.'), '<p>One.</p>\n<p>Two.</p>\n');
  });

  it('makes the site’s own links absolute when it is given the base URL', () => {
    assert.equal(
      bioHtml('See [this](/start/) and [that](https://elsewhere.example/).', {
        baseUrl: 'https://blog.example/notes',
      }),
      '<p>See <a href="https://blog.example/notes/start/">this</a> and ' +
        '<a href="https://elsewhere.example/">that</a>.</p>\n',
    );
  });

  it('escapes raw HTML rather than passing it through', () => {
    assert.equal(
      bioHtml('<script>alert(1)</script> <b>bold</b>'),
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;bold&lt;/b&gt;</p>\n',
    );
  });

  it('escapes < and & in a plain bio', () => {
    assert.equal(bioHtml('Tom & Jerry, 1 < 2'), '<p>Tom &amp; Jerry, 1 &lt; 2</p>\n');
  });

  it('links no script', () => {
    assert.doesNotMatch(bioHtml('[x](javascript:alert(1))'), /href/);
  });

  it('is empty for an empty bio', () => {
    assert.equal(bioHtml('  '), '');
  });
});

describe('a bio as text', () => {
  it('drops the Markdown and keeps the words', () => {
    assert.equal(bioText('Start [here](/start/), *then* `read`.'), 'Start here, then read.');
  });

  it('keeps paragraphs apart', () => {
    assert.equal(bioText('One.\n\nTwo **more**.'), 'One.\n\nTwo more.');
  });

  it('leaves a plain bio as it was written', () => {
    for (const plain of ['Wrote the first program.', 'Tom & Jerry, 1 < 2', '<b>bold</b>']) {
      assert.equal(bioText(plain), plain);
    }
  });
});
