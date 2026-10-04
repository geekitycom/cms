/**
 * What a Micropub client's content becomes (TASK-258): HTML is cleaned and
 * written as Markdown, and Markdown keeps its text while any raw HTML in it
 * goes through the same allow-list. Each attack is checked on the page the
 * stored body renders to, since that is where it would run.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkdown } from '../content/markdown.ts';
import { normalizeBody } from '../content/writer.ts';
import { cleanMarkdown, markdownFromHtml } from './content.ts';

function fromHtml(html: string): string {
  const markdown = markdownFromHtml(html);
  assert.ok(markdown !== undefined, `converts ${html}`);
  return markdown;
}

function cleaned(markdown: string): string {
  const result = cleanMarkdown(markdown);
  assert.ok(result !== undefined, `cleans ${markdown}`);
  return result;
}

/** Fails when anything in `page` would run script or load a frame. */
function assertInert(page: string): void {
  assert.doesNotMatch(page, /<script/i, 'no script element');
  assert.doesNotMatch(
    page,
    /<(iframe|object|embed|style|svg|math|form|noscript)\b/i,
    'no active element',
  );
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i, 'no event handler');
  assert.doesNotMatch(page, /\sstyle\s*=/i, 'no inline style');
  assert.doesNotMatch(
    page,
    /(href|src)\s*=\s*["']?\s*(javascript|vbscript|data):/i,
    'no script URL',
  );
}

describe('HTML content becomes Markdown (AC #1)', () => {
  it('keeps headings, paragraphs, emphasis, links, lists, images, code and quotations', () => {
    const markdown = fromHtml(
      '<h2>Section</h2><p>Some <em>soft</em> and <strong>loud</strong> words, ' +
        '<a href="https://example.com/a" title="A page">a link</a>, <code>inline()</code> code ' +
        'and <del>gone</del> text.</p>' +
        '<ol start="3"><li>Third</li><li>Fourth<ul><li>Nested</li></ul></li></ol>' +
        '<p><img src="/media/photo.jpg" alt="A photo"></p>' +
        '<pre><code class="language-js">if (a) {\n  b();\n}</code></pre>' +
        '<blockquote><p>Quoted.</p></blockquote>',
    );

    assert.equal(
      markdown,
      [
        '## Section',
        '',
        'Some _soft_ and **loud** words, [a link](https://example.com/a "A page"), `inline()` code and ~~gone~~ text.',
        '',
        '3. Third',
        '4. Fourth',
        '   - Nested',
        '',
        '![A photo](/media/photo.jpg)',
        '',
        '```js',
        'if (a) {',
        '  b();',
        '}',
        '```',
        '',
        '> Quoted.',
      ].join('\n'),
    );
    const page = renderMarkdown(markdown);
    assert.match(page, /<h2 id="section">Section<\/h2>/);
    assert.match(page, /<em>soft<\/em> and <strong>loud<\/strong>/);
    assert.match(page, /<a href="https:\/\/example.com\/a" title="A page">a link<\/a>/);
    assert.match(page, /<ol start="3">\n<li>Third<\/li>\n<li>Fourth\n<ul>\n<li>Nested<\/li>/);
    assert.match(page, /<img src="\/media\/photo.jpg" alt="A photo">/);
    assert.match(page, /<pre tabindex="0"><code class="language-js">if \(a\) \{\n {2}b\(\);\n\}/);
    assert.match(page, /<blockquote>\n<p>Quoted.<\/p>\n<\/blockquote>/);
    assert.match(page, /<s>gone<\/s>/);
  });

  it('writes text that looks like markup as text, not as HTML', () => {
    const markdown = fromHtml(
      '<p>a &lt;script&gt;alert(1)&lt;/script&gt; b &amp;copy; c &lt; d</p>',
    );

    const page = renderMarkdown(markdown);
    assert.match(page, /a &lt;script&gt;alert\(1\)&lt;\/script&gt; b &amp;copy; c &lt; d/);
    assertInert(page);
  });
});

describe('pretty-printed HTML (AC #2)', () => {
  it('never turns an indented paragraph into a code block', () => {
    const markdown = fromHtml('<div>\n    <p>a</p>\n\n    <p>b</p>\n</div>');

    assert.equal(markdown, 'a\n\nb');
    assert.equal(renderMarkdown(markdown), '<p>a</p>\n<p>b</p>\n');
  });

  it('keeps a table, a figure and details as unindented HTML blocks', () => {
    const markdown = fromHtml(
      '<p>Before.</p>\n' +
        '<table>\n  <thead>\n    <tr><th colspan="2">Head</th></tr>\n  </thead>\n\n' +
        '  <tbody>\n    <tr>\n      <td>one</td>\n\n      <td>two</td>\n    </tr>\n  </tbody>\n</table>\n' +
        '<figure>\n    <img src="https://example.com/i.png" alt="An image">\n\n' +
        '    <figcaption>A <em>caption</em></figcaption>\n</figure>\n' +
        '<details>\n    <summary>More</summary>\n\n    <p>Hidden.</p>\n</details>\n' +
        '<p>After with <sup>1</sup> and <kbd>Ctrl</kbd>.</p>',
    );

    for (const line of markdown.split('\n')) {
      assert.doesNotMatch(line, /^\s+\S/, `"${line}" is not indented`);
    }
    const blocks = markdown.split('\n\n');
    assert.equal(blocks[0], 'Before.');
    assert.match(blocks[1] ?? '', /^<table>\n<thead>\n<tr><th colspan="2">Head<\/th><\/tr>/);
    assert.match(
      blocks[2] ?? '',
      /^<figure>\n<img src="https:\/\/example.com\/i.png" alt="An image">/,
    );
    assert.match(blocks[3] ?? '', /^<details>\n<summary>More<\/summary>/);
    assert.equal(blocks[4], 'After with <sup>1</sup> and <kbd>Ctrl</kbd>.');
    const page = renderMarkdown(markdown);
    assert.doesNotMatch(page, /<pre|<code/, 'nothing became code');
    assert.match(page, /<tr><td>one<\/td><td>two<\/td><\/tr>/);
    assert.match(page, /<figcaption>A <em>caption<\/em><\/figcaption>/);
    assert.match(page, /<p>Hidden.<\/p>/);
  });

  it('keeps the indentation of code inside a kept block', () => {
    const markdown = fromHtml(
      '<figure>\n  <pre><code>if (a) {\n    b();\n}</code></pre>\n  <figcaption>Code</figcaption>\n</figure>',
    );

    const page = renderMarkdown(markdown);
    assert.match(page, /<pre><code>if \(a\) \{(\n|&#10;) {4}b\(\);(\n|&#10;)\}<\/code><\/pre>/);
  });
});

describe('what an attacker sends as HTML content (AC #3)', () => {
  const attacks: Record<string, string> = {
    'a script element': '<p>Hi</p><script>alert(document.cookie)</script>',
    'a script in upper case': '<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>',
    'an event handler on an image': '<img src="x" onerror="alert(1)">',
    'an unquoted event handler': '<p onmouseover=alert(1)>hover</p>',
    'a javascript: link': '<a href="javascript:alert(1)">click</a>',
    'a javascript: link hidden by a tab entity': '<a href="java&#x09;script:alert(1)">click</a>',
    'a javascript: link with leading space and case': '<a href="  JaVaScRiPt:alert(1)">click</a>',
    'a javascript: link whose colon is encoded twice':
      '<a href="javascript&amp;#58;alert(1)">click</a>',
    'a javascript: link with an unterminated reference':
      '<a href="javascript&#58alert(1)">click</a>',
    'a vbscript: link': '<a href="vbscript:msgbox(1)">click</a>',
    'a data: link':
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
    'a data: image': '<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;" alt="x">',
    'a style attribute': '<p style="background:url(javascript:alert(1))">styled</p>',
    'a style element': '<style>body{display:none}</style><p>text</p>',
    'an iframe': '<iframe src="https://evil.example/"></iframe>',
    'an svg carrying a script': '<svg><script>alert(1)</script><circle r="5"/></svg>',
    'an svg with onload': '<svg/onload=alert(1)>',
    'math with a script link': '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    'an object and an embed': '<object data="evil.swf"></object><embed src="evil.swf">',
    'a form':
      '<form action="https://evil.example/"><input name="password"><button>Go</button></form>',
    'a noscript mutation':
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    'a link inside a kept table':
      '<table><tr><td><a href="javascript:alert(1)" onclick="x()">x</a></td></tr></table>',
    'a figure image with a handler':
      '<figure><img src="/a.png" onload="alert(1)"><figcaption>c</figcaption></figure>',
    'a comment hiding markup': '<!-- --><script>alert(1)</script><!-- -->',
    'a kept inline element with a handler': '<p><mark onclick="alert(1)" style="x">m</mark></p>',
  };

  for (const [name, html] of Object.entries(attacks)) {
    it(`removes ${name}`, () => {
      assertInert(renderMarkdown(fromHtml(html)));
    });
  }

  it('keeps the words of an element it unwraps, and drops a script’s source', () => {
    const markdown = fromHtml(
      '<form><p>Before <span>kept</span></p></form><script>secret()</script>',
    );

    assert.equal(markdown, 'Before kept');
  });

  it('keeps relative, http(s) and mailto links', () => {
    const markdown = fromHtml(
      '<p><a href="/2026/09/post/">a</a> <a href="https://x.example/">b</a> ' +
        '<a href="mailto:me@example.com">c</a> <a href="#notes">d</a></p>',
    );

    assert.equal(
      markdown,
      '[a](/2026/09/post/) [b](https://x.example/) [c](mailto:me@example.com) [d](#notes)',
    );
  });
});

// A browser reads `/\host` and `//host` as another site's address, and a
// feed cannot resolve `/\[` at all (TASK-260).
describe('an address that starts with two slashes, either way round', () => {
  const addresses = [
    '/\\javascript:alert(1)',
    '/\\[',
    '/\\x y',
    '//evil.example/',
    '\\\\evil.example',
    '\\/evil.example',
    '/&#92;evil.example',
    '/\t\\evil.example',
    '  //evil.example',
  ];

  function addressesIn(page: string): string[] {
    return [...page.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(([, address]) => address ?? '');
  }

  for (const address of addresses) {
    it(`is dropped from a link and an image: ${JSON.stringify(address)}`, () => {
      const html = `<p><a href="${address}">x</a> <img src="${address}" alt="i"></p>`;

      assert.deepEqual(addressesIn(renderMarkdown(fromHtml(html))), [], 'HTML content');
      assert.deepEqual(addressesIn(renderMarkdown(cleaned(`A ${html}`))), [], 'HTML in Markdown');
    });
  }

  it('leaves a root-relative path and a path relative to the page', () => {
    const html = '<p><a href="/2026/09/post/">a</a> <a href="notes/">b</a></p>';

    assert.deepEqual(addressesIn(renderMarkdown(fromHtml(html))), ['/2026/09/post/', 'notes/']);
  });
});

describe('Markdown content keeps its text (AC #6)', () => {
  it('leaves Markdown without HTML exactly as sent, edges trimmed', () => {
    const markdown =
      '# Title\n\nSome *text* with `<script>` in code, a < b, and **more**.\n\n' +
      '    indented <script>code</script>\n\n- one\n- two';

    assert.equal(cleaned(markdown), markdown);
  });

  it('leaves allowed HTML exactly as sent', () => {
    const markdown =
      '<details>\n<summary>More</summary>\n\nHidden *markdown*.\n\n</details>\n\n' +
      'H<sub>2</sub>O and <kbd>Ctrl</kbd>.';

    assert.equal(cleaned(markdown), markdown);
  });

  it('removes a script block and keeps the Markdown around it', () => {
    const markdown = cleaned('Hello *there*.\n\n<script>\nalert(1)\n</script>\n\nAnd _after_.\n');

    assert.equal(markdown, 'Hello *there*.\n\nAnd _after_.');
  });

  it('cleans an inline tag and nothing else on its line', () => {
    assert.equal(
      cleaned('Text `<img src=x onerror=alert(1)>` and <img src=x onerror=alert(1)> *more*.\n'),
      'Text `<img src=x onerror=alert(1)>` and <img src="x"> *more*.',
    );
  });

  it('cleans HTML inside a quotation, a list and a table', () => {
    const markdown = cleaned(
      '> <div onclick="steal()">quoted</div>\n\n' +
        '- item <a href="javascript:alert(1)">x</a>\n\n' +
        '| a | b |\n| - | - |\n| <b onclick="x">1</b> | <i>2</i> |\n',
    );

    assertInert(renderMarkdown(markdown));
    assert.match(markdown, /^> <div>quoted<\/div>\n/);
    assert.match(markdown, /\| <b>1<\/b> \| <i>2<\/i> \|/);
  });

  it('removes every attack the HTML path removes', () => {
    const attacks = [
      '<script>alert(1)</script>',
      'Inline <script>alert(1)</script> script.',
      '<img src=x onerror=alert(1)>',
      'An <img src=x onerror=alert(1)> image.',
      '<iframe src="https://evil.example/"></iframe>',
      '<svg><script>alert(1)</script></svg>',
      '<p style="color:red" onclick="x()">styled</p>',
      '<a href="javascript:alert(1)">x</a>',
      'A <a href="data:text/html,x">link</a>.',
      '<div>\n<a href="JaVa&#x09;script:alert(1)" onmouseover="x">x</a>\n</div>',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    ];
    for (const attack of attacks) {
      assertInert(renderMarkdown(cleaned(attack)));
    }
  });

  it('refuses a tag it cannot find in the source rather than storing it', () => {
    assert.equal(cleanMarkdown('> a <img src=x\n> onerror=alert(1)> b\n'), undefined);
  });

  it('relies on markdown-it to refuse a script URL in a Markdown link', () => {
    const markdown =
      '[x](javascript:alert(1)) ![y](javascript:alert(1)) <javascript:alert(1)> [z](data:text/html,x)';

    assert.equal(cleaned(markdown), markdown);
    assertInert(renderMarkdown(markdown));
  });
});

describe('the body the site stores is the body that was cleaned', () => {
  // The edges of a body are trimmed and its line endings made \n before it is
  // stored, so an indent that made HTML a code block, or a lone \r markdown-it
  // breaks a line on, must not survive cleaning only to change what the stored
  // body means.
  const payloads = [
    '    <script>alert(1)</script>',
    '\t<img src=x onerror=alert(1)>',
    '    <svg onload=alert(1)></svg>',
    '    <base href="javascript:x//">',
    '\r<script>alert(1)</script>',
    'a\r<script>alert(1)</script>',
    '\r<div onclick=alert(1)>x</div>',
  ];

  for (const payload of payloads) {
    it(`stores ${JSON.stringify(payload)} inert`, () => {
      const markdown = cleanMarkdown(payload);
      if (markdown === undefined) return;
      assert.equal(normalizeBody(markdown), markdown, 'the cleaned body is the stored body');
      assertInert(renderMarkdown(markdown));
      assert.doesNotMatch(renderMarkdown(markdown), /<base\b/i);
    });

    it(`stores ${JSON.stringify(payload)} sent as HTML inert`, () => {
      const markdown = markdownFromHtml(payload);
      if (markdown === undefined) return;
      assert.equal(normalizeBody(markdown), markdown);
      assertInert(renderMarkdown(markdown));
      assert.doesNotMatch(renderMarkdown(markdown), /<base\b/i);
    });
  }

  it('answers a body that is already clean and stored unchanged', () => {
    for (const body of [
      'Some *text*.',
      'H<sub>2</sub>O\n\n<details>\n<summary>s</summary>\n\nx\n\n</details>',
    ]) {
      assert.equal(cleanMarkdown(body), body);
    }
  });
});

describe('a body as iA Writer sends it (AC #5)', () => {
  // Reconstructed: iA Writer's preview HTML for a short article, blank lines
  // between blocks and ids on headings, as its publishing export writes it.
  const IA_WRITER = `<h1 id="atripnorth">A trip north</h1>

<p>We left <em>early</em>, before the <strong>fog</strong> lifted. The route is on <a href="https://maps.example/route">the map</a>.</p>

<h2 id="whatwepacked">What we packed</h2>

<ul>
<li>A tent</li>
<li>Two stoves

<ul>
<li>One spare</li>
</ul></li>
</ul>

<ol>
<li>Drive</li>
<li>Walk</li>
</ol>

<blockquote>
<p>The north is a state of mind.</p>
</blockquote>

<pre><code class="swift">let miles = 42
print(miles)
</code></pre>

<figure>
<img src="https://shll.me/media/2026/10/lake.jpg" alt="A grey lake" />
<figcaption>The lake at dawn</figcaption>
</figure>

<p>More soon.</p>
`;

  it('round-trips to sensible Markdown', () => {
    const markdown = fromHtml(IA_WRITER);

    assert.equal(
      markdown,
      [
        '# A trip north',
        '',
        'We left _early_, before the **fog** lifted. The route is on [the map](https://maps.example/route).',
        '',
        '## What we packed',
        '',
        '- A tent',
        '- Two stoves',
        '  - One spare',
        '',
        '1. Drive',
        '2. Walk',
        '',
        '> The north is a state of mind.',
        '',
        '```',
        'let miles = 42',
        'print(miles)',
        '```',
        '',
        '<figure>',
        '<img src="https://shll.me/media/2026/10/lake.jpg" alt="A grey lake">',
        '<figcaption>The lake at dawn</figcaption>',
        '</figure>',
        '',
        'More soon.',
      ].join('\n'),
    );
    const page = renderMarkdown(markdown);
    assert.match(page, /<h1 id="a-trip-north">A trip north<\/h1>/);
    assert.match(
      page,
      /<figure>\n<img src="https:\/\/shll.me\/media\/2026\/10\/lake.jpg" alt="A grey lake">/,
    );
    assert.doesNotMatch(page, /<pre tabindex="0"><code>&lt;/);
  });
});
