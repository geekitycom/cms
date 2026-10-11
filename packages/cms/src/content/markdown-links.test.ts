import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteMarkdownLinks } from './markdown-links.ts';

const SITE = 'https://example.com';

function toMarkdown(href: string): string | undefined {
  const url = new URL(href, `${SITE}/here/`);
  if (url.origin !== SITE) return undefined;
  return `${url.pathname}index.md${url.hash}`;
}

describe('rewriteMarkdownLinks', () => {
  it('rewrites an inline link and keeps its text, title and fragment', () => {
    assert.equal(
      rewriteMarkdownLinks('See [the post](/a/#part "Title") now.', toMarkdown),
      'See [the post](/a/index.md#part "Title") now.',
    );
  });

  it('rewrites an absolute link to the site and leaves an external one', () => {
    assert.equal(
      rewriteMarkdownLinks(
        '[one](https://example.com/b/) and [two](https://elsewhere.org/c/)',
        toMarkdown,
      ),
      '[one](/b/index.md) and [two](https://elsewhere.org/c/)',
    );
  });

  it('leaves images, code spans and code blocks alone', () => {
    const body = [
      '![alt](/photo/)',
      '',
      'Inline `[x](/a/)` code.',
      '',
      '```',
      '[y](/a/)',
      '```',
      '',
      '    [z](/a/)',
    ].join('\n');
    assert.equal(rewriteMarkdownLinks(body, toMarkdown), body);
  });

  it('rewrites the link around an image but not the image', () => {
    assert.equal(
      rewriteMarkdownLinks('[![alt](/photo/)](/a/)', toMarkdown),
      '[![alt](/photo/)](/a/index.md)',
    );
  });

  it('rewrites links in lists, quotes and headings', () => {
    const body = ['- one [a](/a/)', '  more [b](/b/)', '', '> [c](/c/)', '', '## [d](/d/) ##'].join(
      '\n',
    );
    assert.equal(
      rewriteMarkdownLinks(body, toMarkdown),
      [
        '- one [a](/a/index.md)',
        '  more [b](/b/index.md)',
        '',
        '> [c](/c/index.md)',
        '',
        '## [d](/d/index.md) ##',
      ].join('\n'),
    );
  });

  it('turns an autolink and a bare URL to the site into links to the Markdown', () => {
    assert.equal(
      rewriteMarkdownLinks('<https://example.com/a/> and https://example.com/b/.', toMarkdown),
      '[https://example.com/a/](/a/index.md) and [https://example.com/b/](/b/index.md).',
    );
  });

  it('rewrites a reference definition, not the reference', () => {
    assert.equal(
      rewriteMarkdownLinks('[the post][p]\n\n[p]: /a/ "Title"', toMarkdown),
      '[the post][p]\n\n[p]: /a/index.md "Title"',
    );
  });

  it('leaves raw HTML alone', () => {
    const body = '<a href="/a/">raw</a>';
    assert.equal(rewriteMarkdownLinks(body, toMarkdown), body);
  });

  it('puts a destination with a space in angle brackets', () => {
    assert.equal(
      rewriteMarkdownLinks('[a](/a/)', () => '/a b/index.md'),
      '[a](</a b/index.md>)',
    );
  });
});
