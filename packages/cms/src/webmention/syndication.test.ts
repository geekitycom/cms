import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { SYNDICATE_TO_FRONT_MATTER_KEY } from '../content/syndicate-to.ts';
import type { SyndicationTarget } from '../content/syndicate-to.ts';
import {
  checkSyndicationTarget,
  handSyndicationOf,
  parseSyndicationTargets,
  selectedTargets,
  SYNDICATION_FILE,
  syndicationCopies,
} from './syndication.ts';

const INDIENEWS: SyndicationTarget = {
  id: 'indienews',
  name: 'IndieNews',
  url: 'https://news.indieweb.org/en',
  tag: 'indienews',
};

const SITE_LANGUAGE = 'en';

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

describe('checking one target, field by field (TASK-218)', () => {
  it('answers the target for a valid entry, trimmed and with canonical languages', () => {
    assert.deepEqual(
      checkSyndicationTarget({
        id: 'news',
        name: ' News ',
        url: 'https://news.example/{lang}',
        tag: ' indienews ',
        languages: ['EN', 'de-at'],
      }),
      {
        target: {
          id: 'news',
          name: 'News',
          url: 'https://news.example/{lang}',
          tag: 'indienews',
          languages: ['en', 'de-AT'],
        },
      },
    );
  });

  it('names every field that is wrong at once, so a form can mark each', () => {
    const checked = checkSyndicationTarget({
      id: 'has space',
      name: '  ',
      url: 'ftp://a.example/',
      tag: '',
      languages: ['de', 'not a tag!'],
    });

    assert.ok('problems' in checked, 'the entry is refused');
    assert.deepEqual(Object.keys(checked.problems).sort(), [
      'id',
      'languages',
      'name',
      'tag',
      'url',
    ]);
  });

  it('is the rule the file is read by: a bad field in the file is reported with its sentence', () => {
    const checked = checkSyndicationTarget({ id: 'x', name: 'X', url: 'mailto:a@b.example' });
    assert.ok('problems' in checked);
    const { problems } = parseSyndicationTargets(
      JSON.stringify([{ id: 'x', name: 'X', url: 'mailto:a@b.example' }]),
    );
    assert.equal(problems.length, 1);
    assert.ok(
      problems[0]?.includes(checked.problems.url ?? 'missing'),
      `the log line carries the form's sentence: ${problems[0] ?? ''}`,
    );
  });
});

describe('which targets a post selects', () => {
  const targets = [INDIENEWS, MASTODON];

  it('selects the ids its syndicate-to lists, in declaration order', () => {
    const selected = selectedTargets(
      { tags: [], extra: { [SYNDICATE_TO_FRONT_MATTER_KEY]: ['mastodon', 'indienews'] } },
      targets,
      SITE_LANGUAGE,
    );

    assert.deepEqual(selected, [INDIENEWS, MASTODON]);
  });

  it('accepts a single id written as a string, and ignores an id nobody declared', () => {
    assert.deepEqual(
      selectedTargets({ tags: [], extra: { 'syndicate-to': 'mastodon' } }, targets, SITE_LANGUAGE),
      [MASTODON],
    );
    assert.deepEqual(
      selectedTargets({ tags: [], extra: { 'syndicate-to': ['nowhere'] } }, targets, SITE_LANGUAGE),
      [],
    );
  });

  it('selects a target whose tag the post carries, whatever its case', () => {
    assert.deepEqual(selectedTargets({ tags: ['IndieNews'], extra: {} }, targets, SITE_LANGUAGE), [
      INDIENEWS,
    ]);
  });

  it('selects nothing for an untagged post that lists nothing', () => {
    assert.deepEqual(
      selectedTargets({ tags: ['indieweb'], extra: {} }, targets, SITE_LANGUAGE),
      [],
    );
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

/** IndieNews as a site declares it once for every language it has a page in. */
const INDIENEWS_BY_LANGUAGE: SyndicationTarget = {
  id: 'indienews',
  name: 'IndieNews',
  url: 'https://news.indieweb.org/{lang}',
  tag: 'indienews',
  languages: ['en', 'de', 'fr'],
};

/** A target whose URL follows the post's language, whatever it is. */
const ANY_LANGUAGE: SyndicationTarget = {
  id: 'wiki',
  name: 'Wiki',
  url: 'https://{lang}.wiki.example/notify',
};

function tagged(lang?: string): { tags: string[]; extra: Record<string, unknown> } {
  return { tags: ['indienews'], extra: lang === undefined ? {} : { lang } };
}

describe('reading a per-language target (TASK-156)', () => {
  it('keeps a {lang} placeholder in the url and a list of languages as canonical tags', () => {
    const { targets, problems } = parseSyndicationTargets(
      JSON.stringify([{ ...INDIENEWS_BY_LANGUAGE, languages: ['EN', 'de', 'fr'] }, ANY_LANGUAGE]),
    );

    assert.deepEqual(problems, []);
    assert.deepEqual(targets, [INDIENEWS_BY_LANGUAGE, ANY_LANGUAGE]);
  });

  it('reports and drops a languages list that is empty or names something that is not a tag', () => {
    const { targets, problems } = parseSyndicationTargets(
      JSON.stringify([
        { ...INDIENEWS_BY_LANGUAGE, id: 'empty', languages: [] },
        { ...INDIENEWS_BY_LANGUAGE, id: 'not-a-list', languages: 'de' },
        { ...INDIENEWS_BY_LANGUAGE, id: 'bad-tag', languages: ['de', 'not a tag!'] },
        { ...INDIENEWS_BY_LANGUAGE, id: 'bad-url', url: 'ftp://news.example/{lang}' },
      ]),
    );

    assert.deepEqual(targets, []);
    assert.equal(problems.length, 4, problems.join(' | '));
  });
});

describe('a target that follows the post’s language (TASK-156 AC #1)', () => {
  it('fills {lang} from the post’s language', () => {
    assert.deepEqual(
      selectedTargets(
        { tags: [], extra: { 'syndicate-to': 'wiki', lang: 'de' } },
        [ANY_LANGUAGE],
        'en',
      ).map((target) => target.url),
      ['https://de.wiki.example/notify'],
    );
  });

  it('falls back to the site’s language for a post that names none', () => {
    assert.deepEqual(
      selectedTargets({ tags: [], extra: { 'syndicate-to': 'wiki' } }, [ANY_LANGUAGE], 'fr').map(
        (target) => target.url,
      ),
      ['https://fr.wiki.example/notify'],
    );
  });

  it('leaves a url without a placeholder as it was declared', () => {
    assert.deepEqual(selectedTargets(tagged('de'), [INDIENEWS], 'en'), [INDIENEWS]);
  });
});

describe('a target restricted to some languages (TASK-156 AC #2, #3)', () => {
  it('sends a German post to /de and an English one to /en', () => {
    assert.deepEqual(
      selectedTargets(tagged('de'), [INDIENEWS_BY_LANGUAGE], 'en').map((target) => target.url),
      ['https://news.indieweb.org/de'],
    );
    assert.deepEqual(
      selectedTargets(tagged('en'), [INDIENEWS_BY_LANGUAGE], 'de').map((target) => target.url),
      ['https://news.indieweb.org/en'],
    );
    assert.deepEqual(
      selectedTargets(tagged(), [INDIENEWS_BY_LANGUAGE], 'de').map((target) => target.url),
      ['https://news.indieweb.org/de'],
      'a post that names no language is in the site’s',
    );
  });

  it('takes a regional post under the language it lists, and fills {lang} with that', () => {
    assert.deepEqual(
      selectedTargets(tagged('de-AT'), [INDIENEWS_BY_LANGUAGE], 'en').map((target) => target.url),
      ['https://news.indieweb.org/de'],
    );
  });

  it('does not select a target for a post in a language it does not list', () => {
    assert.deepEqual(selectedTargets(tagged('es'), [INDIENEWS_BY_LANGUAGE], 'en'), []);
    assert.deepEqual(
      selectedTargets(
        { tags: [], extra: { 'syndicate-to': 'indienews', lang: 'ja' } },
        [INDIENEWS_BY_LANGUAGE],
        'en',
      ),
      [],
      'not even when the post lists it by id',
    );
  });
});

describe('a copies file that does not parse', () => {
  const roots: string[] = [];
  after(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function siteWith(text: string): Promise<{ contentDir: string; file: string }> {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-syndication-'));
    roots.push(contentDir);
    const file = path.join(contentDir, ...SYNDICATION_FILE.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return { contentDir, file };
  }

  function quietly<T>(task: () => T): { result: T; warned: string[] } {
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => warned.push(line);
    try {
      return { result: task(), warned };
    } finally {
      console.warn = warn;
    }
  }

  const damagedTexts = {
    'is not JSON':
      '{\n  "/posts/a/": { "https://brid.gy/publish/mastodon": "https://m.example/1" },\n}\n',
    'is JSON but not an object': '["https://m.example/1"]\n',
  };

  for (const [why, text] of Object.entries(damagedTexts)) {
    it(`refuses to record a copy when the file ${why}, and leaves its bytes alone`, async () => {
      const { contentDir, file } = await siteWith(text);
      const copies = syndicationCopies(contentDir);

      await assert.rejects(
        copies.write('/posts/b/', 'https://news.indieweb.org/en', 'https://news.example/2'),
        (error: Error) => error.message.includes(file),
      );
      await assert.rejects(copies.forget('/posts/a/'), (error: Error) =>
        error.message.includes(file),
      );

      assert.equal(await readFile(file, 'utf8'), text);
    });

    it(`reads no copies, with a warning naming the file, when it ${why}`, async () => {
      const { contentDir, file } = await siteWith(text);
      const copies = syndicationCopies(contentDir);

      const { result, warned } = quietly(() => [
        copies.read('/posts/a/'),
        copies.read('/posts/a/'),
      ]);

      assert.deepEqual(result, [{}, {}]);
      assert.equal(warned.length, 1);
      assert.ok(warned[0]?.includes(file));
    });
  }
});

describe('a copies file edited by hand', () => {
  const roots: string[] = [];
  after(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  const handWritten = {
    '/posts/a/': {
      'https://brid.gy/publish/mastodon': 'https://m.example/1',
      'https://news.indieweb.org/en': 'see the thread',
    },
    '/posts/b/': 'posted by hand',
    '/posts/c/': ['https://m.example/3'],
  };

  async function copiesWith(
    text: string,
  ): Promise<{ file: string; copies: ReturnType<typeof syndicationCopies> }> {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-syndication-'));
    roots.push(contentDir);
    const file = path.join(contentDir, ...SYNDICATION_FILE.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return { file, copies: syndicationCopies(contentDir) };
  }

  it('reads only the copies that are web URLs', async () => {
    const { copies } = await copiesWith(JSON.stringify(handWritten));

    assert.deepEqual(copies.read('/posts/a/'), {
      'https://brid.gy/publish/mastodon': 'https://m.example/1',
    });
    assert.deepEqual(copies.read('/posts/b/'), {});
  });

  it('keeps the entries it cannot read as written when it records another copy', async () => {
    const { file, copies } = await copiesWith(JSON.stringify(handWritten));

    await copies.write('/posts/d/', 'https://brid.gy/publish/mastodon', 'https://m.example/4');
    await copies.write('/posts/a/', 'https://brid.gy/publish/mastodon', undefined);
    await copies.write('/posts/b/', 'https://brid.gy/publish/mastodon', undefined);

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      '/posts/a/': { 'https://news.indieweb.org/en': 'see the thread' },
      '/posts/b/': 'posted by hand',
      '/posts/c/': ['https://m.example/3'],
      '/posts/d/': { 'https://brid.gy/publish/mastodon': 'https://m.example/4' },
    });
  });
});
