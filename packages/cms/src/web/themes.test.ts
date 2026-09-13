import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { PACKAGED_ADMIN_DIR } from '../admin/templates.ts';
import {
  chooseTheme,
  createThemeSource,
  findThemeFile,
  listSiteThemes,
  PACKAGED_THEME_DIR,
  readTheme,
  SITE_THEME_KIND,
  THEME_MANIFEST_FILE,
  themeSearchPath,
} from './themes.ts';
import type { ThemeSource } from './themes.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A theme directory holding whatever files a test names, relative paths. */
async function themeDir(
  name: string,
  files: Record<string, string> = {},
): Promise<{ parent: string; dir: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'geekity-themes-'));
  temporaryDirs.push(parent);
  const dir = path.join(parent, name);
  await mkdir(dir, { recursive: true });

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(dir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  return { parent, dir };
}

describe('reading a theme manifest', () => {
  it('reads the packaged theme as a site theme named after its directory', () => {
    const read = readTheme(PACKAGED_THEME_DIR);

    assert.equal(read.ok, true, read.ok ? '' : read.reason);
    assert.ok(read.ok);
    assert.equal(read.theme.id, 'default');
    assert.equal(read.theme.kind, SITE_THEME_KIND);
    assert.equal(read.theme.dir, path.resolve(PACKAGED_THEME_DIR));
    assert.ok(read.theme.name.length > 0, 'it has a display name');
    assert.ok((read.theme.description ?? '').length > 0, 'it has a description');
  });

  it('reads a name, a kind and a description out of a theme.json', async () => {
    const { dir } = await themeDir('midnight', {
      [THEME_MANIFEST_FILE]: JSON.stringify({
        name: 'Midnight',
        kind: 'site',
        description: 'Dark, quiet, and mostly type.',
      }),
    });

    const read = readTheme(dir);

    assert.ok(read.ok, read.ok ? '' : read.reason);
    assert.deepEqual(
      { id: read.theme.id, name: read.theme.name, description: read.theme.description },
      { id: 'midnight', name: 'Midnight', description: 'Dark, quiet, and mostly type.' },
    );
  });

  it('takes a theme with no description', async () => {
    const { dir } = await themeDir('plain', {
      [THEME_MANIFEST_FILE]: JSON.stringify({ name: 'Plain', kind: 'site' }),
    });

    const read = readTheme(dir);

    assert.ok(read.ok, read.ok ? '' : read.reason);
    assert.equal(read.theme.description, undefined);
  });

  it('is not a theme when there is no manifest', async () => {
    const { dir } = await themeDir('bare', { 'layouts/post.njk': 'nothing but a layout' });

    const read = readTheme(dir);

    assert.equal(read.ok, false);
    assert.ok(!read.ok);
    assert.match(read.reason, /theme\.json/);
  });

  it('is not a theme when the directory is not there at all', () => {
    const read = readTheme(path.join(tmpdir(), 'geekity-theme-that-is-not-there'));

    assert.equal(read.ok, false);
    assert.ok(!read.ok);
    assert.match(read.reason, /theme\.json/);
  });

  it('is not a theme when the manifest does not parse', async () => {
    const { dir } = await themeDir('broken', { [THEME_MANIFEST_FILE]: '{ "name": ' });

    const read = readTheme(dir);

    assert.ok(!read.ok);
    assert.match(read.reason, /could not be read|is not valid JSON/i);
  });

  it('is not a theme when the manifest is not an object', async () => {
    const { dir } = await themeDir('listy', { [THEME_MANIFEST_FILE]: '["midnight"]' });

    const read = readTheme(dir);

    assert.ok(!read.ok);
    assert.match(read.reason, /object/i);
  });

  it('is not a theme when it has no name', async () => {
    const { dir } = await themeDir('nameless', {
      [THEME_MANIFEST_FILE]: JSON.stringify({ kind: 'site' }),
    });

    const read = readTheme(dir);

    assert.ok(!read.ok);
    assert.match(read.reason, /name/);
  });

  it('is not a theme when the kind is one this CMS does not have', async () => {
    const { dir } = await themeDir('adminish', {
      [THEME_MANIFEST_FILE]: JSON.stringify({ name: 'Adminish', kind: 'admin' }),
    });

    const read = readTheme(dir);

    assert.ok(!read.ok);
    assert.match(read.reason, /kind/);
    assert.match(read.reason, /admin/);
  });

  it('is not a theme when the kind is missing', async () => {
    const { dir } = await themeDir('kindless', {
      [THEME_MANIFEST_FILE]: JSON.stringify({ name: 'Kindless' }),
    });

    const read = readTheme(dir);

    assert.ok(!read.ok);
    assert.match(read.reason, /kind/);
  });
});

describe('the site theme search path', () => {
  it('is the site theme first and the packaged theme second', () => {
    assert.deepEqual(themeSearchPath('/srv/site/theme'), ['/srv/site/theme', PACKAGED_THEME_DIR]);
  });

  it('never carries the admin directory, which is not overridable', () => {
    const dirs = themeSearchPath('/srv/site/theme').map((dir) => path.resolve(dir));

    assert.ok(
      !dirs.includes(path.resolve(PACKAGED_ADMIN_DIR)),
      'the admin templates stay out of the theme search path',
    );
  });

  it('points at the packaged theme that actually ships the layouts', () => {
    assert.ok(
      findThemeFile(themeSearchPath('/no/such/theme'), 'layouts/post.njk') !== undefined,
      'the packaged post layout is found',
    );
  });

  it('is the packaged theme alone when the site has chosen none', () => {
    assert.deepEqual(themeSearchPath(), [PACKAGED_THEME_DIR]);
  });
});

describe('choosing one theme out of a themes directory', () => {
  /** A themes directory holding one theme per entry, each with a manifest. */
  async function themesDir(themes: Record<string, Record<string, string>>): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-themes-dir-'));
    temporaryDirs.push(dir);

    for (const [name, files] of Object.entries(themes)) {
      for (const [relative, contents] of Object.entries({
        [THEME_MANIFEST_FILE]: JSON.stringify({ name, kind: 'site' }),
        ...files,
      })) {
        const file = path.join(dir, name, ...relative.split('/'));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, contents, 'utf8');
      }
    }

    return dir;
  }

  it('is the packaged theme alone when the site names none', async () => {
    const dir = await themesDir({ midnight: {}, daylight: {} });

    const chosen = chooseTheme({ themesDir: dir, name: '' });

    assert.equal(chosen.theme, undefined);
    assert.equal(chosen.problem, undefined);
    assert.deepEqual(chosen.dirs, [PACKAGED_THEME_DIR]);
  });

  it('puts the named theme in front of the packaged one, and no other', async () => {
    const dir = await themesDir({ midnight: {}, daylight: {} });

    const chosen = chooseTheme({ themesDir: dir, name: 'midnight' });

    assert.equal(chosen.theme?.id, 'midnight');
    assert.deepEqual(chosen.dirs, [path.join(dir, 'midnight'), PACKAGED_THEME_DIR]);
  });

  it('falls back to the packaged theme, with a reason, when the theme is gone', async () => {
    const dir = await themesDir({ midnight: {} });

    const chosen = chooseTheme({ themesDir: dir, name: 'daylight' });

    assert.equal(chosen.theme, undefined);
    assert.deepEqual(chosen.dirs, [PACKAGED_THEME_DIR]);
    assert.match(chosen.problem ?? '', /daylight/);
  });

  it('falls back, with a reason, when the directory is not a theme', async () => {
    const dir = await themesDir({ midnight: {} });
    await rm(path.join(dir, 'midnight', THEME_MANIFEST_FILE));

    const chosen = chooseTheme({ themesDir: dir, name: 'midnight' });

    assert.equal(chosen.theme, undefined);
    assert.match(chosen.problem ?? '', /theme\.json/);
  });

  it('refuses a name that is a path rather than a directory in the themes directory', async () => {
    const dir = await themesDir({ midnight: {} });

    for (const name of ['../midnight', 'a/b', '.', '..', '/etc']) {
      const chosen = chooseTheme({ themesDir: dir, name });

      assert.deepEqual(chosen.dirs, [PACKAGED_THEME_DIR], `${name} chose a directory`);
      assert.ok(chosen.problem !== undefined, `${name} was taken as a theme name`);
    }
  });
});

describe('listing what is in a themes directory', () => {
  /** A themes directory holding whatever a test writes into it. */
  async function themesDir(files: Record<string, string> = {}): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-themes-list-'));
    temporaryDirs.push(dir);

    for (const [relative, contents] of Object.entries(files)) {
      const file = path.join(dir, ...relative.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, 'utf8');
    }

    return dir;
  }

  /** One theme's manifest, as a file for {@link themesDir}. */
  function manifest(id: string, name: string, description?: string): Record<string, string> {
    return {
      [`${id}/${THEME_MANIFEST_FILE}`]: JSON.stringify({
        name,
        kind: 'site',
        ...(description === undefined ? {} : { description }),
      }),
    };
  }

  it('is empty for a site that has never written a theme', () => {
    const listed = listSiteThemes(path.join(tmpdir(), 'geekity-themes-that-are-not-there'));

    assert.deepEqual(listed.themes, []);
    assert.deepEqual(listed.unreadable, []);
  });

  it('reads every theme in it, by directory name, in order', async () => {
    const dir = await themesDir({
      ...manifest('midnight', 'Midnight', 'Dark and quiet.'),
      ...manifest('daylight', 'Daylight'),
    });

    const listed = listSiteThemes(dir);

    assert.deepEqual(
      listed.themes.map((theme) => [theme.id, theme.name, theme.description]),
      [
        ['daylight', 'Daylight', undefined],
        ['midnight', 'Midnight', 'Dark and quiet.'],
      ],
    );
    assert.equal(listed.themes[1]?.dir, path.join(dir, 'midnight'), 'and where each one is');
  });

  it('says why a folder that is not a theme is not one, rather than dropping it', async () => {
    const dir = await themesDir({
      ...manifest('midnight', 'Midnight'),
      [`halfway/${THEME_MANIFEST_FILE}`]: '{ "name": ',
      'bare/layouts/post.njk': 'a layout and no manifest',
    });

    const listed = listSiteThemes(dir);

    assert.deepEqual(
      listed.themes.map((theme) => theme.id),
      ['midnight'],
    );
    assert.deepEqual(
      listed.unreadable.map((entry) => entry.id),
      ['bare', 'halfway'],
    );
    assert.match(listed.unreadable[0]?.reason ?? '', /theme\.json/);
    assert.match(listed.unreadable[1]?.reason ?? '', /JSON/);
  });

  it('does not take a file, or the operating system’s litter, for a theme', async () => {
    const dir = await themesDir({
      ...manifest('midnight', 'Midnight'),
      '.DS_Store': 'binary nonsense',
      'README.md': 'themes go in here',
      '.git/HEAD': 'ref: refs/heads/main',
    });

    const listed = listSiteThemes(dir);

    assert.deepEqual(
      listed.themes.map((theme) => theme.id),
      ['midnight'],
    );
    assert.deepEqual(listed.unreadable, [], 'and none of it is reported as a broken theme');
  });
});

describe('the theme a site is rendering through', () => {
  /** A themes directory with one theme in it, and the warnings it logs. */
  async function source(name: string): Promise<{
    dir: string;
    warnings: string[];
    chosen: { name: string };
    themes: ThemeSource;
  }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-themes-dir-'));
    temporaryDirs.push(dir);
    await mkdir(path.join(dir, name), { recursive: true });
    await writeFile(
      path.join(dir, name, THEME_MANIFEST_FILE),
      JSON.stringify({ name, kind: 'site' }),
      'utf8',
    );

    const warnings: string[] = [];
    const chosen = { name: '' };
    const themes = createThemeSource({
      themesDir: dir,
      chosen: () => chosen.name,
      logger: { warn: (message: string) => warnings.push(message) },
    });

    return { dir, warnings, chosen, themes };
  }

  it('follows the choice as it changes, without being told', async () => {
    const { dir, chosen, themes } = await source('midnight');

    assert.deepEqual(themes.current().dirs, [PACKAGED_THEME_DIR]);
    chosen.name = 'midnight';
    assert.deepEqual(themes.current().dirs, [path.join(dir, 'midnight'), PACKAGED_THEME_DIR]);
    chosen.name = '';
    assert.deepEqual(themes.current().dirs, [PACKAGED_THEME_DIR]);
  });

  it('notices a theme that has gone missing and falls back to the packaged one', async () => {
    const { dir, chosen, themes, warnings } = await source('midnight');
    chosen.name = 'midnight';
    assert.equal(themes.current().theme?.id, 'midnight');

    await rm(path.join(dir, 'midnight'), { recursive: true, force: true });

    assert.equal(themes.current().theme, undefined);
    assert.deepEqual(themes.current().dirs, [PACKAGED_THEME_DIR]);
    assert.equal(warnings.length, 1, 'one warning, however many renders follow');
    assert.match(warnings[0] ?? '', /midnight/);
  });

  it('warns once per change rather than once per render', async () => {
    const { chosen, themes, warnings } = await source('midnight');
    chosen.name = 'daylight';

    for (let i = 0; i < 5; i += 1) themes.current();
    assert.equal(warnings.length, 1);

    chosen.name = 'twilight';
    themes.current();
    assert.equal(warnings.length, 2, 'a different bad choice is worth saying');

    chosen.name = 'midnight';
    themes.current();
    assert.equal(warnings.length, 2, 'a choice that works is not');
  });
});

describe('finding one file across the search path', () => {
  it('prefers the file the site theme ships', async () => {
    const { dir } = await themeDir('site', { 'layouts/post.njk': 'mine' });

    const found = findThemeFile(themeSearchPath(dir), 'layouts/post.njk');

    assert.equal(found, path.join(dir, 'layouts', 'post.njk'));
  });

  it('falls through to the packaged theme, one file at a time', async () => {
    const { dir } = await themeDir('site', { 'layouts/post.njk': 'mine' });

    const found = findThemeFile(themeSearchPath(dir), 'layouts/page.njk');

    assert.equal(found, path.join(PACKAGED_THEME_DIR, 'layouts', 'page.njk'));
  });

  it('is undefined when no theme on the path has it', () => {
    assert.equal(findThemeFile(themeSearchPath('/no/such/theme'), 'layouts/nope.njk'), undefined);
  });

  it('will not walk out of a theme directory', async () => {
    const { parent, dir } = await themeDir('site', {});
    await writeFile(path.join(parent, 'secret.txt'), 'not a template', 'utf8');

    assert.equal(findThemeFile([dir], '../secret.txt'), undefined);
  });
});
