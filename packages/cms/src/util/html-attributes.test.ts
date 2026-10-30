import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteAttributes } from './html-attributes.ts';

const upper = (name: string, value: string): string | undefined =>
  name === 'href' ? value.toUpperCase() : undefined;

describe('rewriteAttributes', () => {
  it('rewrites the named attribute and leaves every other byte as written', () => {
    assert.equal(
      rewriteAttributes('<p class=x>a <a  href="/b" title=\'t\'>b</a></p>', upper),
      '<p class=x>a <a  href="/B" title=\'t\'>b</a></p>',
    );
  });

  it('reads a quoted value holding a > as one value, not the end of the tag', () => {
    assert.equal(
      rewriteAttributes('<a title="1 > 0" href="/b">b</a>', upper),
      '<a title="1 > 0" href="/B">b</a>',
    );
  });

  it('never reads attribute text inside another quoted value as an attribute', () => {
    assert.equal(
      rewriteAttributes('<img alt=\'see href="/x"\' src="/y">', upper),
      '<img alt=\'see href="/x"\' src="/y">',
    );
  });

  it('keeps the quote a value was written with, and quotes a bare one', () => {
    assert.equal(rewriteAttributes("<a href='/b'>", upper), "<a href='/B'>");
    assert.equal(rewriteAttributes('<a href=/b>', upper), '<a href="/B">');
  });

  it('passes entities through without decoding them', () => {
    assert.equal(
      rewriteAttributes('<a href="/b?x=1&amp;y=2">', (name, value) =>
        name === 'href' ? `${value}#z` : undefined,
      ),
      '<a href="/b?x=1&amp;y=2#z">',
    );
  });

  it('touches no text outside a start tag', () => {
    assert.equal(rewriteAttributes('href="/b" <b>x</b>', upper), 'href="/b" <b>x</b>');
  });
});
