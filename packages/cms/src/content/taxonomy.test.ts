import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { UPLOAD_ASSET_PREFIX } from './uploads.ts';
import { THEME_ASSET_PREFIX } from '../theme/assets.ts';
import { AUTHOR_BASE, INBOX_BASE } from './authors.ts';
import { COMMENTS_ROOT } from '../web/feeds.ts';
import { ROBOTS_PATH } from '../web/robots.ts';
import { SITEMAP_PATH } from '../web/sitemap.ts';
import {
  DEFAULT_PERMALINK_BASES,
  DEFAULT_TAXONOMY_BASES,
  forgetTerm,
  PAGE_SEGMENT,
  PERMALINK_BASES,
  permalinkBaseProblems,
  permalinkBasesOrDefault,
  recordTermRename,
  redirectedTerm,
  RESERVED_TOP_LEVEL_PATHS,
  taxonomyForSegment,
  taxonomyRedirectsOf,
  termHref,
} from './taxonomy.ts';
import type { TaxonomyRedirect } from './taxonomy.ts';

describe('the default taxonomy bases', () => {
  it('are the common ones, so a migrated site keeps its URLs', () => {
    assert.deepEqual(DEFAULT_TAXONOMY_BASES, { tag: 'tag', category: 'category' });
  });

  it('sit beside a wiki base of wiki', () => {
    assert.deepEqual(DEFAULT_PERMALINK_BASES, { tag: 'tag', category: 'category', wiki: 'wiki' });
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

  it('puts a tag archive at its lower-case URL and keeps a category as spelled (TASK-308)', () => {
    assert.equal(
      termHref({ taxonomy: 'tag', term: 'WordCampUS' }, 1, DEFAULT_TAXONOMY_BASES),
      '/tag/wordcampus/page/2/',
    );
    assert.equal(
      termHref({ taxonomy: 'tag', term: 'Ärger' }, 0, DEFAULT_TAXONOMY_BASES),
      `/tag/${encodeURIComponent('ärger')}/`,
    );
    assert.equal(
      termHref({ taxonomy: 'category', term: 'News' }, 0, DEFAULT_TAXONOMY_BASES),
      '/category/News/',
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

describe('permalinkBaseProblems', () => {
  const bases = { tag: 'tag', category: 'category', wiki: 'wiki' };

  it('accepts three ordinary segments', () => {
    assert.deepEqual(permalinkBaseProblems(DEFAULT_PERMALINK_BASES), {});
    assert.deepEqual(
      permalinkBaseProblems({ tag: 'topics', category: 'filed-under', wiki: 'notes' }),
      {},
    );
  });

  it('refuses an empty base', () => {
    const problems = permalinkBaseProblems({ ...bases, tag: '' });
    assert.match(problems.tag ?? '', /cannot be empty/);
    assert.equal(problems.category, undefined);
    assert.match(permalinkBaseProblems({ ...bases, wiki: ' ' }).wiki ?? '', /wiki base cannot/);
  });

  it('refuses a base that is more than one segment', () => {
    for (const value of ['a/b', '/tag', 'tag/', 'tag s', 'tag.xml', 'tág']) {
      assert.notEqual(
        permalinkBaseProblems({ ...bases, tag: value }).tag,
        undefined,
        `${value} should be refused`,
      );
      assert.notEqual(
        permalinkBaseProblems({ ...bases, wiki: value }).wiki,
        undefined,
        `${value} should be refused as a wiki base`,
      );
    }
  });

  it('refuses two bases that are the same word, naming both', () => {
    const problems = permalinkBaseProblems({ ...bases, tag: 'topics', category: 'topics' });
    assert.match(problems.tag ?? '', /different/);
    assert.match(problems.category ?? '', /different/);
    assert.equal(problems.wiki, undefined);
  });

  it('refuses a wiki base that is the tag or the category base, naming the pair', () => {
    const withTag = permalinkBaseProblems({ ...bases, wiki: 'tag' });
    assert.match(withTag.wiki ?? '', /tag base and the wiki base/);
    assert.match(withTag.tag ?? '', /tag base and the wiki base/);
    assert.equal(withTag.category, undefined);

    const withCategory = permalinkBaseProblems({ ...bases, wiki: 'category' });
    assert.match(withCategory.wiki ?? '', /category base and the wiki base/);
    assert.match(withCategory.category ?? '', /category base and the wiki base/);
    assert.equal(withCategory.tag, undefined);

    const all = permalinkBaseProblems({ tag: 'same', category: 'same', wiki: 'same' });
    for (const base of PERMALINK_BASES) assert.match(all[base] ?? '', /different/);
  });

  it('refuses a base that names a path the site already answers on', () => {
    for (const reserved of RESERVED_TOP_LEVEL_PATHS) {
      assert.notEqual(
        permalinkBaseProblems({ ...bases, tag: reserved }).tag,
        undefined,
        `${reserved} should be reserved`,
      );
      assert.notEqual(
        permalinkBaseProblems({ ...bases, wiki: reserved }).wiki,
        undefined,
        `${reserved} should be reserved for the wiki base too`,
      );
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

describe('permalinkBasesOrDefault', () => {
  it('keeps three usable bases and falls back for anything else', () => {
    assert.deepEqual(permalinkBasesOrDefault({ tag: 'topics', category: 'filed', wiki: 'notes' }), {
      tag: 'topics',
      category: 'filed',
      wiki: 'notes',
    });
    assert.deepEqual(permalinkBasesOrDefault({}), DEFAULT_PERMALINK_BASES);
    assert.deepEqual(
      permalinkBasesOrDefault({ tag: 'a/b', category: 3, wiki: 'admin' }),
      DEFAULT_PERMALINK_BASES,
    );
    assert.deepEqual(
      permalinkBasesOrDefault({ tag: 'same', category: 'same' }),
      DEFAULT_PERMALINK_BASES,
    );
    assert.deepEqual(
      permalinkBasesOrDefault({ tag: 'topics', category: 'filed', wiki: 'topics' }),
      DEFAULT_PERMALINK_BASES,
      'a wiki base on top of an archive base falls back with the rest',
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

  it('matches tags without regard to case, and drops a rename that only changes the case', () => {
    assert.deepEqual(recordTermRename([tag('a', 'OpenSource')], tag('opensource', 'OSS')), [
      tag('a', 'OSS'),
      tag('opensource', 'OSS'),
    ]);
    assert.deepEqual(recordTermRename([], tag('opensource', 'OpenSource')), []);
    const category: TaxonomyRedirect = { taxonomy: 'category', from: 'news', to: 'News' };
    assert.deepEqual(recordTermRename([], category), [category]);
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

describe('forgetTerm on a tag', () => {
  it('forgets every casing of a deleted tag', () => {
    const redirects: TaxonomyRedirect[] = [{ taxonomy: 'tag', from: 'Old', to: 'Gone' }];
    assert.deepEqual(forgetTerm(redirects, 'tag', 'gone'), []);
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

  it('finds a renamed tag in any casing', () => {
    const redirects: TaxonomyRedirect[] = [{ taxonomy: 'tag', from: 'OpenSource', to: 'OSS' }];

    assert.equal(redirectedTerm(redirects, { taxonomy: 'tag', term: 'opensource' }), 'OSS');
  });
});
