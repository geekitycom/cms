import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  createRedirectSource,
  decodedPath,
  findPathRedirect,
  findQueryRedirect,
  NO_REDIRECTS,
  parseRedirects,
  redirectLocation,
  sortedQuery,
} from './redirects.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseRedirects', () => {
  it('reads a list and a map, keyed by decoded path or by path and sorted query', () => {
    const { table, problems } = parseRedirects([
      {
        path: 'a.json',
        text: JSON.stringify([
          { from: '/caf%C3%A9/', to: '/coffee/', status: 308 },
          { from: '/?p=7&b=1', to: '/seven/' },
        ]),
      },
      { path: 'b.json', text: JSON.stringify({ '/old/': 'https://example.org/new' }) },
    ]);
    assert.deepEqual(problems, []);
    assert.deepEqual(table.paths.get('/café/'), {
      from: '/caf%C3%A9/',
      location: '/coffee/',
      status: 308,
      passQuery: true,
    });
    assert.equal(table.paths.get('/old/')?.location, 'https://example.org/new');
    assert.equal(table.paths.get('/old/')?.status, 301);
    assert.equal(table.queries.get('/?b=1&p=7')?.passQuery, false);
  });

  it('keeps the first of a source declared twice and says so', () => {
    const { table, problems } = parseRedirects([
      { path: 'a.json', text: JSON.stringify({ '/x/': '/first/' }) },
      { path: 'b.json', text: JSON.stringify({ '/x/': '/second/' }) },
    ]);
    assert.equal(table.paths.get('/x/')?.location, '/first/');
    assert.deepEqual(problems, [
      'b.json: "/x/" is declared more than once; the first declaration is used.',
    ]);
  });

  it('serves no entry that leads into a loop, and none that is malformed', () => {
    const { table, problems } = parseRedirects([
      {
        path: 'a.json',
        text: JSON.stringify([
          { from: '/a/', to: '/b/' },
          { from: '/b/', to: '/a/' },
          { from: 'nope', to: '/c/' },
          { from: '/d/', to: '/e/', status: 200 },
          { from: '/f/', to: 'ftp://example.org/' },
        ]),
      },
      { path: 'b.json', text: '{' },
    ]);
    assert.equal(table.paths.size, 0);
    assert.equal(problems.length, 6);
    assert.ok(problems.some((line) => line.includes('"/a/" leads into a redirect loop')));
    assert.ok(problems.some((line) => line.startsWith('b.json: it is not valid JSON')));
  });
});

describe('looking a request up in the table', () => {
  const { table } = parseRedirects([
    {
      path: 'a.json',
      text: JSON.stringify([
        { from: '/old/', to: '/new/' },
        { from: '/?p=7', to: '/seven/' },
        { from: '/kept/', to: '/target/#part' },
      ]),
    },
  ]);

  it('finds a query source only with exactly its query', () => {
    assert.equal(findQueryRedirect(table, '/', '?p=7')?.location, '/seven/');
    assert.equal(findQueryRedirect(table, '/', '?p=8'), undefined);
    assert.equal(findQueryRedirect(table, '/', ''), undefined);
  });

  it('finds a path source with or without its trailing slash', () => {
    assert.equal(findPathRedirect(table, '/old/')?.location, '/new/');
    assert.equal(findPathRedirect(table, '/old')?.location, '/new/');
    assert.equal(findPathRedirect(NO_REDIRECTS, '/old/'), undefined);
  });

  it('carries the query on to a target that names none, before its fragment', () => {
    const old = findPathRedirect(table, '/old/');
    const kept = findPathRedirect(table, '/kept/');
    assert.ok(old !== undefined && kept !== undefined);
    assert.equal(redirectLocation(old, '?utm=x'), '/new/?utm=x');
    assert.equal(redirectLocation(kept, '?utm=x'), '/target/?utm=x#part');
    assert.equal(redirectLocation(old, ''), '/new/');
  });

  it('sorts a query and decodes a path as a request is', () => {
    assert.equal(sortedQuery('?b=2&a=1'), 'a=1&b=2');
    assert.equal(decodedPath('/caf%C3%A9/'), '/café/');
    assert.equal(decodedPath('/%E0%A4%A/'), '/%E0%A4%A/');
  });
});

describe('createRedirectSource', () => {
  it('reads redirects.json and every file under redirects/, again when one changes', async () => {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-redirects-'));
    dirs.push(contentDir);
    await mkdir(path.join(contentDir, '_data', 'redirects'), { recursive: true });
    await writeFile(path.join(contentDir, '_data', 'redirects.json'), '{ "/a/": "/b/" }');
    await writeFile(path.join(contentDir, '_data', 'redirects', 'more.json'), '{ "/c/": "/d/" }');
    const warnings: string[] = [];
    const source = createRedirectSource({
      contentDir,
      logger: { warn: (message) => warnings.push(message) },
    });

    const first = source.current();
    assert.deepEqual([...first.paths.keys()], ['/a/', '/c/']);
    assert.equal(source.current(), first);

    await writeFile(path.join(contentDir, '_data', 'redirects.json'), '{ "/c/": "/e/" }');
    assert.equal(source.current().paths.get('/c/')?.location, '/e/');
    assert.equal(warnings.length, 1);
  });

  it('is the empty table for a site with no redirect files', () => {
    const source = createRedirectSource({ contentDir: path.join(tmpdir(), 'geekity-none') });
    assert.equal(source.current().paths.size, 0);
  });
});
