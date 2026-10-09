import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { seedTags } from '../scripts/seed.ts';
import { SEED } from '../src/seed.ts';
import { hashtagKey } from '../src/key.ts';

const CSV = [
  '_followback,869',
  'palestine,104',
  'nude,33',
  'fediverse,45',
  'IndieWeb,4',
  'indieweb,2',
  '_____relay_____,6',
  'pornstar,5',
  'peacock,3',
  'wordpress,2',
  'pkm,1',
  'brandnew,0',
  '',
].join('\n');

const DENYLIST = ['# adult tags', 'nude', '', '*porn*'].join('\n');

describe('the seed filter', () => {
  it('keeps tags with at least two followers, most followed first', () => {
    assert.deepEqual(seedTags(CSV, DENYLIST, 2), [
      ['palestine', 104],
      ['fediverse', 45],
      ['IndieWeb', 4],
      ['peacock', 3],
      ['wordpress', 2],
    ]);
  });

  it('drops tags.pub service accounts, whose names start with an underscore', () => {
    const names = seedTags(CSV, '', 2).map(([name]) => name);
    assert.ok(!names.includes('_followback'));
    assert.ok(!names.includes('_____relay_____'));
  });

  it('drops a denylisted tag by name, and by a fragment between asterisks, in any case', () => {
    const names = seedTags('Nude,9\nPornStar,9\nnudel,9\n', DENYLIST, 2).map(([name]) => name);
    assert.deepEqual(names, ['nudel']);
  });

  it('keeps one spelling of a tag tags.pub folds together, with the larger count', () => {
    assert.deepEqual(seedTags('indieweb,2\nIndieWeb,4\nindie-web,3\n', '', 2), [['IndieWeb', 4]]);
  });

  it('refuses a line it cannot read rather than guess', () => {
    assert.throws(() => seedTags('palestine;104\n', '', 2), /line 1/);
    assert.throws(() => seedTags('gaza,many\n', '', 2), /line 1/);
  });
});

describe('the committed seed', () => {
  it('records where it came from and when', () => {
    assert.match(SEED.source, /tags\.pub/);
    assert.match(SEED.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('holds no service account, no denylisted tag and nothing under two followers', () => {
    const denylist = readFileSync(new URL('../scripts/denylist.txt', import.meta.url), 'utf8');
    assert.ok(SEED.tags.length > 100);
    const csv = SEED.tags.map(([name, followers]) => `${name},${String(followers)}`).join('\n');
    assert.deepEqual(seedTags(csv, denylist, 2), SEED.tags);
    for (const [name, followers] of SEED.tags) {
      assert.ok(followers >= 2, name);
      assert.ok(!name.startsWith('_'), name);
      assert.notEqual(hashtagKey(name), '', name);
    }
  });
});
