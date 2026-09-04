import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderCommentMarkdown } from './markdown.ts';

describe('the restricted Markdown a comment is rendered with', () => {
  it('renders the Markdown a person would expect to work', () => {
    const html = renderCommentMarkdown('**Nice** post, and a `code` word.\n\n- one\n- two');

    assert.match(html, /<strong>Nice<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<li>one<\/li>/);
  });

  it('escapes raw HTML instead of rendering it', () => {
    const html = renderCommentMarkdown('<script>alert(1)</script><b>bold</b>');

    assert.ok(!html.includes('<script>'), `the script tag is not markup: ${html}`);
    assert.ok(!html.includes('<b>'), `nor is any other raw tag: ${html}`);
    assert.match(html, /&lt;script&gt;/);
  });

  it('marks every link nofollow ugc', () => {
    const html = renderCommentMarkdown('[a link](https://example.com/page)');

    assert.match(html, /<a href="https:\/\/example\.com\/page" rel="nofollow ugc">a link<\/a>/);
  });

  it('marks a bare URL the same way, because it is a link too', () => {
    const html = renderCommentMarkdown('See https://example.com/page for more.');

    assert.match(html, /rel="nofollow ugc"/);
    assert.match(html, /href="https:\/\/example\.com\/page"/);
  });

  it('refuses a link to a scheme this site will not publish', () => {
    for (const source of [
      '[click](javascript:alert(1))',
      '[click](data:text/html,<script>alert(1)</script>)',
      '[click](vbscript:msgbox)',
    ]) {
      const html = renderCommentMarkdown(source);
      assert.ok(!html.includes('<a '), `nothing became a link: ${html}`);
      assert.match(html, /click/);
    }
  });

  it('shows an image as a link rather than embedding a stranger’s file', () => {
    const html = renderCommentMarkdown('![a cat](https://example.com/cat.png)');

    assert.ok(!html.includes('<img'), `nothing is embedded: ${html}`);
    assert.match(html, /<a href="https:\/\/example\.com\/cat\.png" rel="nofollow ugc">a cat<\/a>/);
  });

  it('is empty for an empty comment, so nothing has to guard the call', () => {
    assert.equal(renderCommentMarkdown(''), '');
    assert.equal(renderCommentMarkdown('   \n  '), '');
  });
});
