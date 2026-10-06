import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handlesIn, renderMarkdown } from './markdown.ts';

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

    assert.match(html, /<pre tabindex="0"><code class="language-js">/);
    assert.match(html, /const x = 1;/);
  });

  it('leaves a fenced block with no language unclassed', () => {
    const html = renderMarkdown('```\nplain\n```\n');

    assert.match(html, /<pre tabindex="0"><code>plain/);
  });

  it('leaves an unknown language classed and unhighlighted (TASK-86)', () => {
    const html = renderMarkdown('```nosuchlanguage\n<< not code >>\n```\n');

    assert.match(html, /<pre tabindex="0"><code class="language-nosuchlanguage">/);
    assert.match(html, /&lt;&lt; not code &gt;&gt;/);
    assert.doesNotMatch(html, /hljs/, 'the renderer highlighted something');
  });

  it('gives an indented code block a tabindex too (TASK-86)', () => {
    const html = renderMarkdown('    indented\n');

    assert.match(html, /<pre tabindex="0"><code>indented/);
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

describe('autolinks', () => {
  it('links a bare http or https URL', () => {
    const html = renderMarkdown('See https://example.com/a-post and http://example.org.\n');

    assert.match(
      html,
      /<a href="https:\/\/example\.com\/a-post">https:\/\/example\.com\/a-post<\/a>/,
    );
    assert.match(html, /<a href="http:\/\/example\.org">http:\/\/example\.org<\/a>\./);
  });

  it('leaves a name without a scheme, a protocol-relative URL and an address as text', () => {
    const html = renderMarkdown(
      'Edit file.md on example.com, see //example.net, or write to bob@example.com.\n',
    );

    assert.doesNotMatch(html, /<a /);
  });

  it('leaves a URL in a code span alone', () => {
    assert.doesNotMatch(renderMarkdown('Run `curl https://example.com`.\n'), /<a /);
  });
});

describe('fediverse handles', () => {
  const directory = (handle: string) =>
    handle === 'alice@social.example'
      ? {
          profile: 'https://social.example/@alice',
          actor: 'https://social.example/users/alice',
          inbox: 'https://social.example/users/alice/inbox',
        }
      : undefined;

  it('links a handle the directory knows to its profile as an h-card', () => {
    const html = renderMarkdown('Thanks @alice@social.example!\n', directory);

    assert.equal(
      html,
      '<p>Thanks <a class="u-category h-card" href="https://social.example/@alice">@alice@social.example</a>!</p>\n',
    );
  });

  it('matches a handle whatever its case, and keeps it as written', () => {
    const html = renderMarkdown('Hi @Alice@Social.Example.\n', directory);

    assert.match(
      html,
      /<a class="u-category h-card" href="https:\/\/social\.example\/@alice">@Alice@Social\.Example<\/a>\./,
    );
  });

  it('leaves a handle the directory does not know as text', () => {
    assert.equal(
      renderMarkdown('Hi @bob@nowhere.example.\n', directory),
      '<p>Hi @bob@nowhere.example.</p>\n',
    );
  });

  it('leaves a handle in a code span, inside a link or inside a word alone', () => {
    const html = renderMarkdown(
      '`@alice@social.example` [@alice@social.example](https://elsewhere.example/) me@alice@social.example\n',
      directory,
    );

    assert.doesNotMatch(html, /h-card/);
  });

  it('lists the handles a body names, outside code, once each', () => {
    assert.deepEqual(
      handlesIn(
        'Hi @alice@social.example and @Bob@Nowhere.example, again @alice@social.example.\n\n`@carol@code.example`\n',
      ),
      ['alice@social.example', 'bob@nowhere.example'],
    );
  });
});
