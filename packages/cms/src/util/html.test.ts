import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeEntities, escapeAttribute, escapeText } from './html.ts';

describe('escapeText', () => {
  it('escapes the characters that would start markup', () => {
    assert.equal(escapeText('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
  });

  it('leaves quotes alone, which a text node does not need escaped', () => {
    assert.equal(escapeText(`"it's"`), `"it's"`);
  });
});

describe('escapeAttribute', () => {
  it('escapes both quotes so either kind of attribute is safe', () => {
    assert.equal(escapeAttribute(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
  });
});

describe('decodeEntities', () => {
  it('resolves named, decimal and hex references', () => {
    assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&apos;&nbsp;'), `&<>"'\u00a0`);
    assert.equal(decodeEntities('&#38;&#x26;&#X3C;'), '&&<');
  });

  it('decodes once, so an escaped reference stays a reference', () => {
    assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  });

  it('leaves an unknown name or an invalid code point as written', () => {
    assert.equal(
      decodeEntities('&bogus; &#xD800; &#1114112; &AMP;'),
      '&bogus; &#xD800; &#1114112; &AMP;',
    );
  });

  it('round-trips through escapeAttribute', () => {
    const value = `Fish & "chips" <b>'s</b>`;
    assert.equal(decodeEntities(escapeAttribute(value)), value);
  });
});
