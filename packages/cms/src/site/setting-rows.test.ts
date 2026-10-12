import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { frontPageOf, frontPageProblems, requiredWholeDays } from './setting-rows.ts';
import { DEFAULT_SITE_SETTINGS } from './settings.ts';
import { formFromSettings } from './settings-form.ts';

const FORM = formFromSettings(DEFAULT_SITE_SETTINGS);

describe('requiredWholeDays', () => {
  it('reads a whole number of days, 0 included', () => {
    assert.equal(requiredWholeDays(' 30 '), 30);
    assert.equal(requiredWholeDays('0'), 0);
  });

  it('refuses an empty field rather than reading it as 0', () => {
    assert.equal(requiredWholeDays(''), undefined);
    assert.equal(requiredWholeDays('   '), undefined);
  });

  it('refuses a fraction, a negative and a word', () => {
    for (const typed of ['1.5', '-1', 'week']) {
      assert.equal(requiredWholeDays(typed), undefined, typed);
    }
  });
});

describe('frontPageOf', () => {
  it('keeps both picks when there is a homepage', () => {
    assert.deepEqual(frontPageOf({ ...FORM, homepage: ' home ', postsPage: ' blog ' }), {
      homepage: 'home',
      postsPage: 'blog',
    });
  });

  it('clears the posts page with the homepage', () => {
    assert.deepEqual(frontPageOf({ ...FORM, homepage: '', postsPage: 'blog' }), {
      homepage: '',
      postsPage: '',
    });
  });
});

describe('frontPageProblems', () => {
  it('finds nothing wrong with no picks, or with two different pages', () => {
    assert.deepEqual(frontPageProblems({ ...FORM, homepage: '', postsPage: '' }), {
      homepage: undefined,
      postsPage: undefined,
    });
    assert.deepEqual(frontPageProblems({ ...FORM, homepage: 'home', postsPage: 'blog' }), {
      homepage: undefined,
      postsPage: undefined,
    });
  });

  it('refuses a posts page without a homepage, and one page picked twice', () => {
    assert.match(
      frontPageProblems({ ...FORM, homepage: '', postsPage: 'blog' }).postsPage ?? '',
      /needs a homepage/,
    );
    assert.match(
      frontPageProblems({ ...FORM, homepage: 'home', postsPage: ' home ' }).postsPage ?? '',
      /two different pages/,
    );
  });

  it('refuses a pick that is not a slug, on the field it was typed in', () => {
    const problems = frontPageProblems({ ...FORM, homepage: 'a b', postsPage: 'c/d' });
    assert.match(problems.homepage ?? '', /A homepage is the slug/);
    assert.match(problems.postsPage ?? '', /A posts page is the slug/);
  });
});
