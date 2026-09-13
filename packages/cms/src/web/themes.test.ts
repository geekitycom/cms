import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { PACKAGED_ADMIN_DIR } from '../admin/templates.ts';
import {
  findThemeFile,
  PACKAGED_THEME_DIR,
  readTheme,
  SITE_THEME_KIND,
  THEME_MANIFEST_FILE,
  themeSearchPath,
} from './themes.ts';

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
