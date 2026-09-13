import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_PREFIX } from '../admin/session.ts';
import { THEME_ASSET_PREFIX, UPLOAD_ASSET_PREFIX } from './assets.ts';
import { AUTHOR_BASE, INBOX_BASE } from './authors.ts';
import { COMMENTS_ROOT } from './feeds.ts';
import { ROBOTS_PATH, SITEMAP_PATH } from './sitemap.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  forgetTerm,
  PAGE_SEGMENT,
  recordTermRename,
  redirectedTerm,
  RESERVED_TOP_LEVEL_PATHS,
  taxonomyBaseProblems,
  taxonomyBasesOrDefault,
  taxonomyForSegment,
  taxonomyRedirectsOf,
  termHref,
} from './taxonomy.ts';
import type { TaxonomyRedirect } from './taxonomy.ts';

describe('the default taxonomy bases', () => {
  it('are the ones WordPress uses, so a migrated site keeps its URLs', () => {
    assert.deepEqual(DEFAULT_TAXONOMY_BASES, { tag: 'tag', category: 'category' });
  });
});

describe('termHref', () => {
  it('spells an archive URL under the base it is given', () => {
    assert.equal(
      termHref({ taxonomy: 'tag', term: 'notes' }, 0, DEFAULT_TAXONOMY_BASES),
      '/tag/notes/',
    );
    assert.equal(
      termHref({ taxonomy: 'category', term: 'general' }, 0, DEFAULT_TAXONOMY_BASES),
      '/category/general/',
    );
    assert.equal(
      termHref({ taxonomy: 'tag', term: 'notes' }, 0, { tag: 'topics', category: 'filed' }),
      '/topics/notes/',
    );
  });
});

describe('taxonomyForSegment', () => {
  it('reads a base back, and knows a segment that is neither', () => {
    const bases = { tag: 'topics', category: 'filed' };
    assert.equal(taxonomyForSegment('topics', bases), 'tag');
    assert.equal(taxonomyForSegment('filed', bases), 'category');
    assert.equal(taxonomyForSegment('tag', bases), undefined);
    assert.equal(taxonomyForSegment(undefined, bases), undefined);
  });
});

describe('taxonomyBaseProblems', () => {
  it('accepts a pair of ordinary segments', () => {
    assert.deepEqual(taxonomyBaseProblems(DEFAULT_TAXONOMY_BASES), {});
    assert.deepEqual(taxonomyBaseProblems({ tag: 'topics', category: 'filed-under' }), {});
  });

  it('refuses an empty base', () => {
    const problems = taxonomyBaseProblems({ tag: '', category: 'category' });
    assert.match(problems.tag ?? '', /cannot be empty/);
    assert.equal(problems.category, undefined);
  });

  it('refuses a base that is more than one segment', () => {
    for (const value of ['a/b', '/tag', 'tag/', 'tag s', 'tag.xml', 'tág']) {
      const problems = taxonomyBaseProblems({ tag: value, category: 'category' });
      assert.notEqual(problems.tag, undefined, `${value} should be refused`);
    }
  });

  it('refuses two bases that are the same word, naming both', () => {
    const problems = taxonomyBaseProblems({ tag: 'topics', category: 'topics' });
    assert.match(problems.tag ?? '', /different/);
    assert.match(problems.category ?? '', /different/);
  });

  it('refuses a base that names a path the site already answers on', () => {
    for (const reserved of RESERVED_TOP_LEVEL_PATHS) {
      const problems = taxonomyBaseProblems({ tag: reserved, category: 'category' });
      assert.notEqual(problems.tag, undefined, `${reserved} should be reserved`);
    }
  });
});

describe('the reserved list', () => {
  it('covers every top-level path the site actually registers', () => {
    const registered = [
      PAGE_SEGMENT,
      ADMIN_PREFIX,
      THEME_ASSET_PREFIX,
      UPLOAD_ASSET_PREFIX,
      COMMENTS_ROOT,
      SITEMAP_PATH,
      ROBOTS_PATH,
      // decision-14: the author archives and the shared inbox are the site's
      // own, and an actor id that a settings field could move would be a
      // different account to everybody following it.
      AUTHOR_BASE,
      INBOX_BASE,
    ].map((prefix) => prefix.replaceAll('/', ''));

    for (const segment of registered) {
      assert.ok(
        RESERVED_TOP_LEVEL_PATHS.includes(segment),
        `${segment} is a top-level path but a taxonomy base could take it`,
      );
    }
  });
});

describe('taxonomyBasesOrDefault', () => {
  it('keeps a usable pair and falls back for anything else', () => {
    assert.deepEqual(taxonomyBasesOrDefault({ tag: 'topics', category: 'filed' }), {
      tag: 'topics',
      category: 'filed',
    });
    assert.deepEqual(taxonomyBasesOrDefault({}), DEFAULT_TAXONOMY_BASES);
    assert.deepEqual(taxonomyBasesOrDefault({ tag: 'a/b', category: 3 }), DEFAULT_TAXONOMY_BASES);
    assert.deepEqual(
      taxonomyBasesOrDefault({ tag: 'same', category: 'same' }),
      DEFAULT_TAXONOMY_BASES,
    );
  });
});

describe('recordTermRename', () => {
  const tag = (from: string, to: string): TaxonomyRedirect => ({ taxonomy: 'tag', from, to });

  it('collapses a chain so an old URL is answered in one hop', () => {
    const first = recordTermRename([], tag('a', 'b'));
    assert.deepEqual(recordTermRename(first, tag('b', 'c')), [tag('a', 'c'), tag('b', 'c')]);
  });

  it('replaces an older record of the same term moving', () => {
    const stale = [tag('a', 'b')];
    assert.deepEqual(recordTermRename(stale, tag('a', 'c')), [tag('a', 'c')]);
  });

  it('drops a record of a term that has come back into use', () => {
    const moved = [tag('a', 'b')];
    // Something else is renamed to `a`, so `a` answers again and the record of
    // where it used to point would only get in the way.
    assert.deepEqual(recordTermRename(moved, tag('z', 'a')), [tag('z', 'a')]);
  });

  it('leaves the other taxonomy alone', () => {
    const category: TaxonomyRedirect = { taxonomy: 'category', from: 'a', to: 'b' };
    assert.deepEqual(recordTermRename([category], tag('a', 'c')), [category, tag('a', 'c')]);
  });
});

describe('forgetTerm', () => {
  it('drops every record touching a deleted term, and nothing else', () => {
    const redirects: TaxonomyRedirect[] = [
      { taxonomy: 'tag', from: 'a', to: 'gone' },
      { taxonomy: 'tag', from: 'gone', to: 'b' },
      { taxonomy: 'tag', from: 'c', to: 'd' },
      { taxonomy: 'category', from: 'a', to: 'gone' },
    ];

    assert.deepEqual(forgetTerm(redirects, 'tag', 'gone'), [
      { taxonomy: 'tag', from: 'c', to: 'd' },
      { taxonomy: 'category', from: 'a', to: 'gone' },
    ]);
  });
});

describe('taxonomyRedirectsOf', () => {
  it('keeps the entries that are renames and drops the rest', () => {
    assert.deepEqual(
      taxonomyRedirectsOf([
        { taxonomy: 'tag', from: 'a', to: 'b' },
        { taxonomy: 'nonsense', from: 'a', to: 'b' },
        { taxonomy: 'tag', from: '', to: 'b' },
        { taxonomy: 'tag', from: 'a', to: 'a' },
        { taxonomy: 'category', from: 'x', to: 2 },
        'not an object',
        null,
      ]),
      [{ taxonomy: 'tag', from: 'a', to: 'b' }],
    );
    assert.deepEqual(taxonomyRedirectsOf(undefined), []);
  });
});

describe('redirectedTerm', () => {
  it('answers for the taxonomy that moved and no other', () => {
    const redirects: TaxonomyRedirect[] = [{ taxonomy: 'tag', from: 'a', to: 'b' }];

    assert.equal(redirectedTerm(redirects, { taxonomy: 'tag', term: 'a' }), 'b');
    assert.equal(redirectedTerm(redirects, { taxonomy: 'category', term: 'a' }), undefined);
    assert.equal(redirectedTerm(redirects, { taxonomy: 'tag', term: 'b' }), undefined);
  });
});
