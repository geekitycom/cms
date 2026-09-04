import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import type { DocumentContent } from './document.ts';
import { parseDocument } from './parser.ts';
import { serializeDocument } from './writer.ts';

const FIXTURES = new URL('../../test/fixtures/content/', import.meta.url);

const FIXTURE_PATHS = [
  'posts/2026-09-02-hello-world.md',
  'posts/2026-08-15-notes-from-a-draft.md',
  'pages/about.md',
];

async function fixture(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, FIXTURES), 'utf8');
}

function content(overrides: Partial<DocumentContent> = {}): DocumentContent {
  return {
    title: 'A Title',
    permalink: '/a-title/',
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: 'Body.',
    ...overrides,
  };
}

describe('serializeDocument', () => {
  it('emits every modelled key in a fixed order, then the unmodelled ones', () => {
    const document = content({
      title: 'Order Matters',
      date: '2026-01-02T03:04:05Z',
      updated: '2026-01-03T00:00:00Z',
      permalink: '/2026/01/order-matters/',
      tags: ['one', 'two'],
      categories: ['general'],
      draft: true,
      description: 'Every modelled key, in order.',
      author: 'andrew',
      activitypub: { id: 'https://example.com/1', published: '2026-01-03T00:00:01Z' },
      extra: { layout: 'special', series: 'ordering' },
    });

    assert.equal(
      serializeDocument(document),
      `---
title: Order Matters
date: '2026-01-02T03:04:05Z'
updated: '2026-01-03T00:00:00Z'
permalink: /2026/01/order-matters/
tags:
  - one
  - two
categories:
  - general
draft: true
description: Every modelled key, in order.
author: andrew
activitypub:
  id: https://example.com/1
  published: '2026-01-03T00:00:01Z'
layout: special
series: ordering
---

Body.
`,
    );
  });

  it('leaves out keys that carry nothing', () => {
    assert.equal(
      serializeDocument(content()),
      '---\ntitle: A Title\npermalink: /a-title/\n---\n\nBody.\n',
    );
  });

  it('writes the same bytes every time for an unchanged document', () => {
    const document = content({ tags: ['a'], extra: { series: 'x' } });

    assert.equal(serializeDocument(document), serializeDocument(document));
  });

  it('ends after the front matter when there is no body', () => {
    assert.equal(
      serializeDocument(content({ body: '   \n\n' })),
      '---\ntitle: A Title\npermalink: /a-title/\n---\n',
    );
  });

  it('keeps a long description on one line', () => {
    const description =
      'A description long enough that a default YAML line width would fold it across lines.';

    const text = serializeDocument(content({ description }));

    assert.match(text, new RegExp(`\ndescription: ${description}\n`));
  });

  it('quotes a date so it reads back as a string, not a YAML timestamp', () => {
    const text = serializeDocument(content({ date: '2026-01-02T03:04:05-05:00' }));

    assert.match(text, /\ndate: '2026-01-02T03:04:05-05:00'\n/);
    assert.equal(parseDocument(text, { path: 'posts/a.md' }).date, '2026-01-02T03:04:05-05:00');
  });

  it('leaves an empty category list out, as it does an empty tag list', () => {
    assert.doesNotMatch(serializeDocument(content({ categories: [] })), /categories/);
  });

  it('round trips a categorised document through a write and a parse', () => {
    const text = serializeDocument(
      content({ tags: ['notes'], categories: ['general', 'meta'], date: '2026-01-02T03:04:05Z' }),
    );

    const parsed = parseDocument(text, { path: 'posts/a.md' });

    assert.deepEqual(parsed.categories, ['general', 'meta']);
    assert.deepEqual(parsed.tags, ['notes']);
    assert.equal(serializeDocument(parsed), text);
  });

  it('drops an activitypub block with nothing in it', () => {
    const text = serializeDocument(content({ activitypub: {} }));

    assert.doesNotMatch(text, /activitypub/);
  });

  for (const path of FIXTURE_PATHS) {
    it(`rewrites ${path} byte for byte`, async () => {
      const source = await fixture(path);

      assert.equal(serializeDocument(parseDocument(source, { path })), source);
    });

    it(`round trips ${path} through a parse, a write and a parse`, async () => {
      const source = await fixture(path);
      const once = parseDocument(source, { path });

      const twice = parseDocument(serializeDocument(once), { path });

      assert.deepStrictEqual(twice, once);
    });
  }

  it('preserves unknown front matter across a round trip', async () => {
    const path = 'posts/2026-08-15-notes-from-a-draft.md';
    const once = parseDocument(await fixture(path), { path });

    const twice = parseDocument(serializeDocument(once), { path });

    assert.deepStrictEqual(twice.extra, {
      eleventyExcludeFromCollections: true,
      series: 'notebook',
      review: { by: 'someone-else', due: '2026-09-01' },
    });
  });

  it('writes an untidy document into canonical form and then leaves it alone', () => {
    const untidy = '---\npermalink: /a-title/\ntitle: A Title\n---\n\n\n\nBody.\n\n\n';
    const document = parseDocument(untidy, { path: 'pages/a-title.md' });

    const written = serializeDocument(document);

    assert.equal(written, '---\ntitle: A Title\npermalink: /a-title/\n---\n\nBody.\n');
    assert.equal(serializeDocument(parseDocument(written, { path: 'pages/a-title.md' })), written);
  });

  it('agrees with the hash the parser recorded', async () => {
    const path = 'pages/about.md';
    const document = parseDocument(await fixture(path), { path });

    const rewritten = parseDocument(serializeDocument(document), { path });

    assert.equal(rewritten.hash, document.hash);
  });
});
