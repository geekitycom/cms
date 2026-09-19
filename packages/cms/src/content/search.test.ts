import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from './document.ts';
import { htmlToText, MAXIMUM_QUERY_TERMS, searchExpression, searchText } from './search.ts';

describe('searchExpression', () => {
  it('quotes every word, so they are all required and none is syntax', () => {
    assert.equal(searchExpression('sqlite search'), '"sqlite" "search"');
  });

  it('keeps a quoted phrase together', () => {
    assert.equal(searchExpression('"full text" search'), '"full text" "search"');
  });

  it('treats a quote left open as a phrase running to the end', () => {
    assert.equal(searchExpression('a "full text'), '"a" "full text"');
  });

  it('turns a trailing star into a prefix query', () => {
    assert.equal(searchExpression('fed*'), '"fed" *');
  });

  it('reads FTS5 operators, column filters and brackets as plain words', () => {
    assert.equal(
      searchExpression('title:hello OR (NEAR world) -draft'),
      '"title:hello" "OR" "(NEAR" "world)" "-draft"',
    );
  });

  it('doubles a quote inside a word, the way FTS5 escapes one', () => {
    assert.equal(searchExpression(`it's o"clock`), `"it's" "o" "clock"`);
  });

  it('drops terms that hold nothing the tokenizer would keep', () => {
    assert.equal(searchExpression('fish & chips -- "" *'), '"fish" "chips"');
  });

  it('finds nothing to search for in an empty or punctuation-only query', () => {
    assert.equal(searchExpression(''), undefined);
    assert.equal(searchExpression('   '), undefined);
    assert.equal(searchExpression('- & * ""'), undefined);
  });

  it(`keeps at most ${String(MAXIMUM_QUERY_TERMS)} terms`, () => {
    const query = Array.from({ length: 40 }, (_, index) => `w${String(index)}`).join(' ');
    const expression = searchExpression(query) ?? '';
    assert.equal(expression.split(' ').length, MAXIMUM_QUERY_TERMS);
  });
});

describe('htmlToText', () => {
  it('separates blocks, drops markup and decodes entities', () => {
    assert.equal(
      htmlToText(
        '<h2>Fish &amp; chips</h2><p>Were <em>very</em>&nbsp;good&#8230; &#x2014; yes</p>',
      ),
      'Fish & chips Were very good… — yes',
    );
  });

  it('drops scripts, styles and comments with their contents', () => {
    assert.equal(
      htmlToText('<p>a</p><script>var hidden = 1;</script><style>p{}</style><!-- note --><p>b</p>'),
      'a b',
    );
  });

  it('removes the snippet marks so a document cannot forge one', () => {
    assert.equal(htmlToText('<p>a\u0002b\u0003c</p>'), 'abc');
  });
});

describe('searchText', () => {
  it('indexes the title, description, taxonomy and body text', () => {
    const document = {
      title: 'Hello',
      description: 'A greeting',
      tags: ['intro'],
      categories: ['general'],
      html: '<p>Hi <a href="https://example.com/secret">there</a>.</p>',
    } as Document;

    assert.deepEqual(searchText(document), {
      title: 'Hello',
      description: 'A greeting',
      terms: 'intro general',
      body: 'Hi there.',
    });
  });
});
