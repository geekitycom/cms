import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_PREFIX } from '../admin/session.ts';
import { FEDERATION_PREFIX } from '../federation/paths.ts';
import { THEME_ASSET_PREFIX, UPLOAD_ASSET_PREFIX } from './assets.ts';
import {
  DEFAULT_TAXONOMY_BASES,
  PAGE_SEGMENT,
  RESERVED_TOP_LEVEL_PATHS,
  taxonomyBaseProblems,
  taxonomyBasesOrDefault,
  taxonomyForSegment,
  termHref,
} from './taxonomy.ts';

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
      FEDERATION_PREFIX,
      THEME_ASSET_PREFIX,
      UPLOAD_ASSET_PREFIX,
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
