import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import { parseDocument } from '../content/parser.ts';
import {
  createRenderer,
  createTemplateEnvironment,
  formatDate,
  paginate,
  themeSearchPath,
} from './index.ts';
import type { Renderer } from './index.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A renderer over a content directory holding `files`, and no site theme. */
async function renderer(
  files: Record<string, string> = {},
  overrides: { baseUrl?: string } = {},
): Promise<{ renderer: Renderer; contentDir: string }> {
  const contentDir = await temporaryDir('geekity-render-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const config = resolveConfig({
    contentDir,
    themesDir: path.join(contentDir, 'themes'),
    ...(overrides.baseUrl === undefined ? {} : { baseUrl: overrides.baseUrl }),
  });
  return { renderer: createRenderer({ config }), contentDir };
}

const source = [
  '---',
  'title: Hello',
  "date: '2026-09-02T09:00:00Z'",
  'permalink: /2026/09/hello/',
  '---',
  '',
  'Body.',
  '',
].join('\n');

describe('the renderer', () => {
  it('turns a document into HTML with no request involved', async () => {
    const { renderer: theme } = await renderer();

    const html = theme.renderDocument(parseDocument(source, { path: 'posts/hello.md' }));

    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes('Hello'), 'the title is rendered');
    assert.ok(html.includes('<p>Body.</p>'), 'the body is rendered');
  });

  it('renders a listing from documents and a pagination', async () => {
    const { renderer: theme } = await renderer();
    const document = parseDocument(source, { path: 'posts/hello.md' });

    const html = theme.renderListing({
      title: 'Everything',
      url: '/',
      documents: [document],
      pagination: paginate({ total: 1, size: 10, pageNumber: 0, hrefForPage: () => '/' }),
    });

    assert.ok(html.includes('href="/2026/09/hello/"'), 'the document is linked');
    assert.ok(!html.includes('Page 1 of 1'), 'a single-page listing has no pager');
  });

  it('reads the site data from content/_data/site.json', async () => {
    const { renderer: theme } = await renderer({
      '_data/site.json': JSON.stringify({ title: 'A Site', tagline: 'and a tagline' }),
    });

    assert.equal(theme.site().title, 'A Site');
    assert.ok(theme.renderNotFound('/gone/').includes('A Site'), 'the title reaches a page');
    // Any key of the file is readable, not only the ones the CMS models. The
    // tagline is printed under the site title on the front page and nowhere
    // else (decision-16), so the root path is where to look for it.
    assert.ok(
      theme.render('layouts/base.njk', { page: { url: '/' } }).includes('and a tagline'),
      'an unmodelled site key does not reach a template',
    );
  });

  it('picks the page size up from the site data, and defaults to ten', async () => {
    const { renderer: withDefault } = await renderer();
    assert.equal(withDefault.pageSize(), 10);

    const { renderer: configured } = await renderer({
      '_data/site.json': JSON.stringify({ postsPerPage: 3 }),
    });
    assert.equal(configured.pageSize(), 3);
  });

  it('falls back to the defaults when the site data will not parse', async () => {
    const { renderer: theme } = await renderer({ '_data/site.json': '{ not json' });

    assert.equal(theme.site().title, 'Geekity');
  });

  it('re-reads the site data after the file changes', async () => {
    const { renderer: theme, contentDir } = await renderer({
      '_data/site.json': JSON.stringify({ title: 'Before' }),
    });
    assert.equal(theme.site().title, 'Before');

    await writeFile(
      path.join(contentDir, '_data/site.json'),
      JSON.stringify({ title: 'After' }),
      'utf8',
    );

    assert.equal(theme.site().title, 'After');
  });
});

describe('the theme filters', () => {
  const environment = (baseUrl: string) =>
    createTemplateEnvironment({ themeDirs: themeSearchPath('/no/such/theme'), baseUrl });

  it('formats a date in each documented format', () => {
    const date = new Date('2026-09-02T09:00:00Z');

    assert.equal(formatDate(date, 'readable'), '2 September 2026');
    assert.equal(formatDate(date, 'html'), '2026-09-02');
    assert.equal(formatDate(date, 'year'), '2026');
    assert.equal(formatDate(date, 'iso'), '2026-09-02T09:00:00.000Z');
  });

  it('formats a date string the same way it formats a Date', () => {
    assert.equal(formatDate('2026-09-02T09:00:00Z', 'html'), '2026-09-02');
    // The instant is what is formatted, so an offset is applied first.
    assert.equal(formatDate('2026-09-02T20:00:00-05:00', 'iso'), '2026-09-03T01:00:00.000Z');
  });

  it('renders nothing for a value that is not a date', () => {
    assert.equal(formatDate(undefined, 'html'), '');
    assert.equal(formatDate('not a date', 'readable'), '');
  });

  it('reads "now" as the moment it is asked, for the footer’s copyright year', () => {
    const thisYear = String(new Date().getUTCFullYear());

    assert.equal(formatDate('now', 'year', 'UTC'), thisYear);
    assert.equal(formatDate('now', 'html', 'UTC').slice(0, 4), thisYear);
  });

  it('renders readable, html and year in the timezone it is given', () => {
    // Nine in the evening in Chicago is the next day in UTC.
    const instant = '2026-09-02T02:00:00Z';

    assert.equal(formatDate(instant, 'readable', 'America/Chicago'), '1 September 2026');
    assert.equal(formatDate(instant, 'html', 'America/Chicago'), '2026-09-01');
    assert.equal(formatDate(instant, 'year', 'America/Chicago'), '2026');
    assert.equal(formatDate('2026-01-01T02:00:00Z', 'year', 'America/Chicago'), '2025');
  });

  it('keeps iso the instant whatever the timezone', () => {
    assert.equal(
      formatDate('2026-09-02T02:00:00Z', 'iso', 'America/Chicago'),
      '2026-09-02T02:00:00.000Z',
    );
  });

  it('takes the zone from the site the template is rendering', () => {
    const env = environment('https://geekity.example');
    const template = '{{ d | date("html") }}';

    assert.equal(
      env.renderString(template, {
        site: { timezone: 'America/Chicago' },
        d: '2026-09-02T02:00:00Z',
      }),
      '2026-09-01',
    );
    assert.equal(
      env.renderString(template, {
        site: { timezone: 'Europe/Berlin' },
        d: '2026-09-02T02:00:00Z',
      }),
      '2026-09-02',
    );
    assert.equal(
      env.renderString(template, { d: '2026-09-02T02:00:00Z' }),
      '2026-09-02',
      'and UTC when the site names no zone',
    );
  });

  it('lets a template name a zone of its own', () => {
    const env = environment('https://geekity.example');

    assert.equal(
      env.renderString('{{ d | date("html", "Europe/Berlin") }}', {
        site: { timezone: 'America/Chicago' },
        d: '2026-09-02T02:00:00Z',
      }),
      '2026-09-02',
    );
  });

  it('leaves a root-relative URL alone when the site is served from the root', () => {
    const env = environment('https://geekity.example');

    assert.equal(env.renderString('{{ "/about/" | url }}', {}), '/about/');
  });

  it('prefixes a root-relative URL with the base path when there is one', () => {
    const env = environment('https://geekity.example/blog');

    assert.equal(env.renderString('{{ "/about/" | url }}', {}), '/blog/about/');
  });

  it('makes a path absolute against the base URL', () => {
    const env = environment('https://geekity.example/blog');

    assert.equal(
      env.renderString('{{ "/about/" | absoluteUrl }}', {}),
      'https://geekity.example/blog/about/',
    );
  });

  it('escapes by default and only lets `safe` through', () => {
    const env = environment('https://geekity.example');

    assert.equal(env.renderString('{{ value }}', { value: '<b>x</b>' }), '&lt;b&gt;x&lt;/b&gt;');
    assert.equal(env.renderString('{{ value | safe }}', { value: '<b>x</b>' }), '<b>x</b>');
  });
});
