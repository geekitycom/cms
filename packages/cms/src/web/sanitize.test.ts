import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeCommentHtml } from './sanitize.ts';

describe('sanitising a comment', () => {
  it('keeps the markup a fediverse note is made of', () => {
    const html =
      '<p>Good <strong>post</strong>, though <em>see</em> <a href="https://example.test/x">this</a>.</p>' +
      '<p>Second<br>line</p>';

    assert.equal(
      sanitizeCommentHtml(html),
      '<p>Good <strong>post</strong>, though <em>see</em> ' +
        '<a href="https://example.test/x" rel="nofollow noopener noreferrer">this</a>.</p>' +
        '<p>Second<br>line</p>',
    );
  });

  it('keeps a list, a quotation and preformatted code', () => {
    const html =
      '<blockquote><p>Quoted.</p></blockquote><ul><li>One</li><li>Two</li></ul>' +
      '<pre><code>const x = 1;</code></pre>';

    assert.equal(sanitizeCommentHtml(html), html);
  });

  it('drops a script and everything inside it', () => {
    const html = '<p>Before</p><script>alert("boom")</script><p>After</p>';

    assert.equal(sanitizeCommentHtml(html), '<p>Before</p><p>After</p>');
  });

  it('drops a style block whole, so no CSS reaches a reader', () => {
    assert.equal(sanitizeCommentHtml('<style>p { color: red }</style><p>Hi</p>'), '<p>Hi</p>');
  });

  it('drops every event handler and every attribute but an anchor’s href', () => {
    const html =
      '<p onclick="steal()" class="x">Hi <a href="https://a.test" target="_blank">a</a></p>';

    assert.equal(
      sanitizeCommentHtml(html),
      '<p>Hi <a href="https://a.test" rel="nofollow noopener noreferrer">a</a></p>',
    );
  });

  it('refuses a javascript: link, keeping the text it wrapped', () => {
    assert.equal(sanitizeCommentHtml('<a href="javascript:alert(1)">click</a>'), 'click');
    assert.equal(sanitizeCommentHtml('<a href="  JAVASCRIPT:alert(1)">click</a>'), 'click');
    assert.equal(sanitizeCommentHtml('<a href="data:text/html,<b>x">click</a>'), 'click');
    // A control character in the middle is what a browser's URL parser drops
    // before it reads the scheme, so it is what this drops too.
    assert.equal(sanitizeCommentHtml('<a href="java&#10;script:alert(1)">click</a>'), 'click');
  });

  it('keeps a mailto link, which is how a note names an address', () => {
    assert.equal(
      sanitizeCommentHtml('<a href="mailto:ada@example.test">write</a>'),
      '<a href="mailto:ada@example.test" rel="nofollow noopener noreferrer">write</a>',
    );
  });

  it('unwraps an element it does not know rather than losing what it said', () => {
    assert.equal(
      sanitizeCommentHtml('<div><span class="h-card">@<span>ada</span></span> hello</div>'),
      '@ada hello',
    );
    assert.equal(sanitizeCommentHtml('<img src="x.png" onerror="steal()">'), '');
  });

  it('escapes text, so nothing in it can be read as markup', () => {
    assert.equal(
      sanitizeCommentHtml('<p>5 &lt; 6 &amp; 7 > 4</p>'),
      '<p>5 &lt; 6 &amp; 7 &gt; 4</p>',
    );
    assert.equal(sanitizeCommentHtml('a < b'), 'a &lt; b');
    assert.equal(sanitizeCommentHtml('<p>&#39;quoted&#39;</p>'), '<p>&#39;quoted&#39;</p>');
  });

  it('closes what the note left open, so the result is well formed', () => {
    assert.equal(sanitizeCommentHtml('<p>Unclosed'), '<p>Unclosed</p>');
    assert.equal(sanitizeCommentHtml('<p>One<p>Two'), '<p>One</p><p>Two</p>');
    assert.equal(sanitizeCommentHtml('<em>a</strong>b</em>'), '<em>ab</em>');
  });

  it('drops a comment, a doctype and a stray angle bracket', () => {
    assert.equal(sanitizeCommentHtml('<!-- <script>x</script> -->ok'), 'ok');
    assert.equal(sanitizeCommentHtml('<!doctype html><p>ok</p>'), '<p>ok</p>');
    assert.equal(sanitizeCommentHtml('1 <'), '1 &lt;');
  });

  it('is idempotent, because its output is drawn from its own allowlist', () => {
    const once = sanitizeCommentHtml('<p onclick="x">Hi <a href="https://a.test">a</a></p>');

    assert.equal(sanitizeCommentHtml(once), once);
  });
});
