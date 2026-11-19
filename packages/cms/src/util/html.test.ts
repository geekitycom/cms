import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeAttribute, decodeEntities, escapeAttribute, escapeText } from './html.ts';

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

  it('leaves an unknown name as written', () => {
    assert.equal(decodeEntities('&bogus; &Amp; &#; &#x;'), '&bogus; &Amp; &#; &#x;');
  });

  it('reads a numeric reference HTML cannot hold as the replacement character', () => {
    assert.equal(
      decodeEntities('&#0; &#x0; &#xD800; &#xDFFF; &#1114112; &#99999999999999999999;'),
      '\ufffd \ufffd \ufffd \ufffd \ufffd \ufffd',
    );
  });

  it('reads a numeric reference in 0x80 to 0x9F as the windows-1252 character', () => {
    assert.equal(decodeEntities('&#128;&#x92;&#x93;&#x94;&#150;&#x9F;'), '€’“”–Ÿ');
    assert.equal(decodeEntities('&#x81;&#x9D;'), '\u0081\u009d');
  });

  it('reads a numeric reference with no semicolon, as HTML does', () => {
    assert.equal(decodeEntities('&#38 &#x3C&#169x'), '& <©x');
    assert.equal(decodeAttribute('?a=&#38b'), '?a=&b');
  });

  it('keeps a noncharacter reference as the character it names', () => {
    assert.equal(decodeEntities('&#xFFFE;&#xFDD0;'), '\ufffe\ufdd0');
  });

  it('resolves every name in the HTML table', () => {
    assert.equal(
      decodeEntities(
        '&eacute;&rsquo;&hellip;&AMP;&CounterClockwiseContourIntegral;&fjlig;&NewLine;',
      ),
      'é’…&∳fj\n',
    );
  });

  it('resolves a legacy name written without its semicolon', () => {
    assert.equal(
      decodeEntities('Ren&eacute Caf&eacute; &copy 2026 &amp &lt;b&gt'),
      'René Café © 2026 & <b>',
    );
  });

  it('reads the longest legacy name a run of letters starts with', () => {
    assert.equal(decodeEntities('&copy2026 &notit; &notin; &ampx'), '©2026 ¬it; ∉ &x');
  });

  it('leaves a name that is only valid with a semicolon alone without one', () => {
    assert.equal(decodeEntities('&rsquo &hellip.'), '&rsquo &hellip.');
  });

  for (const name of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    it(`keeps &${name}; as written`, () => {
      assert.equal(decodeEntities(`a &${name}; b`), `a &${name}; b`);
      assert.equal(decodeAttribute(`a &${name}; b`), `a &${name}; b`);
    });
  }

  it('round-trips through escapeAttribute', () => {
    const value = `Fish & "chips" <b>'s</b>`;
    assert.equal(decodeEntities(escapeAttribute(value)), value);
  });
});

describe('decodeAttribute', () => {
  it('resolves references the way text does', () => {
    assert.equal(decodeAttribute('Ren&eacute; &rsquo; &#38; &copy 2026'), 'René ’ & © 2026');
  });

  it('keeps a legacy name without a semicolon as written before = or a letter or digit', () => {
    assert.equal(
      decodeAttribute('/search?q=1&copy=2&amp=3&notes=4&lt5'),
      '/search?q=1&copy=2&amp=3&notes=4&lt5',
    );
  });

  it('resolves a legacy name without a semicolon before anything else', () => {
    assert.equal(decodeAttribute('?a=1&amp&b=2&copy;'), '?a=1&&b=2©');
  });
});
