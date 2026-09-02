import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultPermalink, slugify } from './slug.ts';

describe('slugify', () => {
  it('lowercases and hyphenates a plain title', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
  });

  it('strips accents down to ASCII', () => {
    assert.equal(slugify('Café — a Naïve Résumé?!'), 'cafe-a-naive-resume');
  });

  it('transliterates letters that do not decompose', () => {
    assert.equal(slugify('Ærø & Straße'), 'aero-strasse');
  });

  it('keeps digits and drops punctuation', () => {
    assert.equal(slugify('Top 10 Things (2026)'), 'top-10-things-2026');
  });

  it('collapses runs of separators and trims the ends', () => {
    assert.equal(slugify('  --Hello___there--  '), 'hello-there');
  });

  it('drops characters with no ASCII form', () => {
    assert.equal(slugify('こんにちは world'), 'world');
  });

  it('is empty when nothing survives', () => {
    assert.equal(slugify('!!! ???'), '');
  });
});

describe('defaultPermalink', () => {
  it('dates a post permalink from its year and month', () => {
    assert.equal(
      defaultPermalink({ type: 'post', slug: 'hello-world', date: '2026-09-02T09:00:00-05:00' }),
      '/2026/09/hello-world/',
    );
  });

  it('uses the offset as written rather than converting to UTC', () => {
    assert.equal(
      defaultPermalink({ type: 'post', slug: 'boundary', date: '2026-10-01T00:30:00+02:00' }),
      '/2026/10/boundary/',
    );
  });

  it('accepts a Date for a post', () => {
    assert.equal(
      defaultPermalink({ type: 'post', slug: 'epoch', date: new Date('2001-02-03T04:05:06Z') }),
      '/2001/02/epoch/',
    );
  });

  it('gives a page a top level permalink', () => {
    assert.equal(defaultPermalink({ type: 'page', slug: 'about' }), '/about/');
  });

  it('ignores a date on a page', () => {
    assert.equal(
      defaultPermalink({ type: 'page', slug: 'about', date: '2026-09-02T09:00:00-05:00' }),
      '/about/',
    );
  });

  it('refuses a post with no date', () => {
    assert.throws(() => defaultPermalink({ type: 'post', slug: 'hello-world' }), TypeError);
  });

  it('refuses a date it cannot read a year and month from', () => {
    assert.throws(
      () => defaultPermalink({ type: 'post', slug: 'hello-world', date: 'sometime in 2026' }),
      TypeError,
    );
  });

  it('refuses an empty slug', () => {
    assert.throws(() => defaultPermalink({ type: 'page', slug: '' }), TypeError);
  });
});
