import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  handSyndicationOf,
  parseSyndicationTargets,
  selectedTargets,
  SYNDICATE_TO_FRONT_MATTER_KEY,
} from './syndication.ts';
import type { SyndicationTarget } from './syndication.ts';

const INDIENEWS: SyndicationTarget = {
  id: 'indienews',
  name: 'IndieNews',
  url: 'https://news.indieweb.org/en',
  tag: 'indienews',
};

const MASTODON: SyndicationTarget = {
  id: 'mastodon',
  name: 'Mastodon',
  url: 'https://brid.gy/publish/mastodon',
};

describe('reading the declared targets', () => {
  it('keeps every valid target in file order', () => {
    const { targets, problems } = parseSyndicationTargets(
      JSON.stringify([
        INDIENEWS,
        { id: 'mastodon', name: 'Mastodon', url: 'https://brid.gy/publish/mastodon' },
      ]),
    );

    assert.deepEqual(targets, [INDIENEWS, MASTODON]);
    assert.deepEqual(problems, []);
  });

  it('reports and drops an entry without an id, a name or a web URL, and a repeated id', () => {
    const { targets, problems } = parseSyndicationTargets(
      JSON.stringify([
        { name: 'No id', url: 'https://a.example/' },
        { id: 'has space', name: 'Bad id', url: 'https://a.example/' },
        { id: 'noname', url: 'https://a.example/' },
        { id: 'ftp', name: 'Not the web', url: 'ftp://a.example/' },
        { id: 'tagged', name: 'Bad tag', url: 'https://a.example/', tag: 7 },
        INDIENEWS,
        { ...INDIENEWS, name: 'Again' },
        'just a string',
      ]),
    );

    assert.deepEqual(targets, [INDIENEWS], 'only the one good entry survives');
    assert.equal(problems.length, 7, 'every bad entry is reported');
    assert.ok(
      problems.some((problem) => problem.includes('indienews')),
      'the repeat is named',
    );
  });

  it('reports a file that is not a JSON array and declares nothing', () => {
    assert.deepEqual(parseSyndicationTargets('{').targets, []);
    assert.equal(parseSyndicationTargets('{').problems.length, 1);
    assert.equal(parseSyndicationTargets('{"targets": []}').problems.length, 1);
  });
});

describe('which targets a post selects', () => {
  const targets = [INDIENEWS, MASTODON];

  it('selects the ids its syndicate-to lists, in declaration order', () => {
    const selected = selectedTargets(
      { tags: [], extra: { [SYNDICATE_TO_FRONT_MATTER_KEY]: ['mastodon', 'indienews'] } },
      targets,
    );

    assert.deepEqual(selected, [INDIENEWS, MASTODON]);
  });

  it('accepts a single id written as a string, and ignores an id nobody declared', () => {
    assert.deepEqual(
      selectedTargets({ tags: [], extra: { 'syndicate-to': 'mastodon' } }, targets),
      [MASTODON],
    );
    assert.deepEqual(
      selectedTargets({ tags: [], extra: { 'syndicate-to': ['nowhere'] } }, targets),
      [],
    );
  });

  it('selects a target whose tag the post carries, whatever its case', () => {
    assert.deepEqual(selectedTargets({ tags: ['IndieNews'], extra: {} }, targets), [INDIENEWS]);
  });

  it('selects nothing for an untagged post that lists nothing', () => {
    assert.deepEqual(selectedTargets({ tags: ['indieweb'], extra: {} }, targets), []);
  });
});

describe('syndication URLs written by hand', () => {
  it('keeps http and https URLs and drops anything else', () => {
    assert.deepEqual(
      handSyndicationOf({
        syndication: ['https://social.example/@me/1', 'javascript:alert(1)', 4, 'not a url'],
      }),
      ['https://social.example/@me/1'],
    );
    assert.deepEqual(handSyndicationOf({ syndication: 'https://a.example/1' }), [
      'https://a.example/1',
    ]);
    assert.deepEqual(handSyndicationOf({}), []);
  });
});
