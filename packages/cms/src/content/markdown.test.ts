import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkdown } from './markdown.ts';

describe('renderMarkdown', () => {
  it('renders paragraphs and inline markup', () => {
    assert.equal(renderMarkdown('A *plain* paragraph.'), '<p>A <em>plain</em> paragraph.</p>\n');
  });

  it('renders footnotes with a reference and a list item', () => {
    const html = renderMarkdown('Cited.[^src]\n\n[^src]: A source.\n');

    assert.match(html, /<sup class="footnote-ref"><a href="#fn1"/);
    assert.match(html, /<section class="footnotes">/);
    assert.match(html, /<li id="fn1" class="footnote-item">/);
    assert.match(html, /A source\./);
  });

  it('gives headings an id derived from their text', () => {
    const html = renderMarkdown('## Hello, World!\n');

    assert.match(html, /<h2 id="hello-world">Hello, World!<\/h2>/);
  });

  it('keeps heading ids unique when two headings share a title', () => {
    const html = renderMarkdown('## Notes\n\ntext\n\n## Notes\n');

    assert.match(html, /<h2 id="notes">/);
    assert.match(html, /<h2 id="notes-2">/);
  });

  it('falls back to a positional id for a heading with no ASCII text', () => {
    const html = renderMarkdown('# こんにちは\n');

    assert.match(html, /<h1 id="section-1">/);
  });

  it('tags a fenced code block with its language', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```\n');

    assert.match(html, /<pre><code class="language-js">/);
    assert.match(html, /const x = 1;/);
  });

  it('leaves a fenced block with no language unclassed', () => {
    const html = renderMarkdown('```\nplain\n```\n');

    assert.match(html, /<pre><code>plain/);
  });

  it('escapes the contents of a code block', () => {
    const html = renderMarkdown('```html\n<b>hi</b>\n```\n');

    assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  });

  it('passes raw HTML through, as Eleventy does', () => {
    const html = renderMarkdown('<div class="callout">\n\nInside *markdown*.\n\n</div>\n');

    assert.match(html, /<div class="callout">/);
    assert.match(html, /<em>markdown<\/em>/);
  });

  it('renders an empty body as an empty string', () => {
    assert.equal(renderMarkdown(''), '');
  });
});
