import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { CORE_DATA_FILES, dataFileFor } from '../files/data-files.ts';
import {
  BODY,
  BOLD,
  FAMILY,
  ITALIC,
  REGULAR,
  face,
  googleLookup as lookup,
  stubGoogle,
} from './__testing__/google.ts';
import type { StubbedGoogle } from './__testing__/google.ts';
import {
  FONT_PATH_PREFIX,
  createFontStore,
  css2Url,
  fontFamilySlug,
  isFontFamilyName,
} from './index.ts';
import type { FontStore } from './index.ts';

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

let google: StubbedGoogle;
before(() => {
  google = stubGoogle();
});
after(() => {
  google.restore();
});

let dataDir: string;
let fonts: FontStore;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-fonts-'));
  fonts = createFontStore({ dataDir, hostLookup: lookup });
});
afterEach(async () => {
  google.reset();
  await rm(dataDir, { recursive: true, force: true });
});

async function storedFiles(): Promise<string[]> {
  try {
    return (await readdir(path.join(dataDir, 'fonts'), { recursive: true })).sort();
  } catch {
    return [];
  }
}

describe('a family name', () => {
  it('is letters, digits and single spaces', () => {
    for (const name of ['Roboto', 'Atkinson Hyperlegible', 'M PLUS 1p', '42dot Sans']) {
      assert.equal(isFontFamilyName(name), true, name);
    }
    for (const name of [
      '',
      ' Roboto',
      'Roboto ',
      'Two  Spaces',
      "Rob'oto",
      'Roboto"; } body { color: red',
      'Roboto\nSans',
      'Ro/boto',
      'A'.repeat(65),
    ]) {
      assert.equal(isFontFamilyName(name), false, name);
    }
  });

  it('has a lower-case slug with hyphens for spaces', () => {
    assert.equal(fontFamilySlug('Atkinson Hyperlegible'), 'atkinson-hyperlegible');
  });

  it('is sent to the CSS2 API with + for spaces and the styles sorted', () => {
    assert.equal(
      css2Url(FAMILY, BODY),
      'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap',
    );
  });
});

describe('fetching a family Google has', () => {
  it('downloads every WOFF2 file it lists and writes a stylesheet that points at this site', async () => {
    google.serveFamily(BODY);
    const fetched = await fonts.ensure(FAMILY, BODY);
    assert.ok(fetched.ok, JSON.stringify(fetched));
    assert.equal(fetched.stylesheet.family, FAMILY);

    const cssRequest = google.requested.find((r) =>
      r.url.startsWith('https://fonts.googleapis.com/'),
    );
    assert.match(cssRequest?.userAgent ?? '', /Chrome\/\d+/);
    assert.ok(
      google.requested.every((r) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url)),
    );

    const files = await storedFiles();
    const woff2s = files.filter((f) => f.endsWith('.woff2'));
    assert.equal(woff2s.length, 6);
    for (const file of woff2s) {
      const bytes = await readFile(path.join(dataDir, 'fonts', file));
      assert.equal(path.basename(file), `${hashOf(bytes)}.woff2`);
      assert.equal(Buffer.from(bytes.subarray(0, 4)).toString('latin1'), 'wOF2');
    }
    assert.ok(
      files.every((f) => f === 'atkinson-hyperlegible' || f.startsWith('atkinson-hyperlegible/')),
    );

    const { href } = fetched.stylesheet;
    assert.match(
      href,
      /^\/_geekity\/fonts\/atkinson-hyperlegible\/400-700-400i\.css\?v=[0-9a-f]{12}$/,
    );
    const css = await readFile(
      path.join(dataDir, 'fonts', 'atkinson-hyperlegible', '400-700-400i.css'),
      'utf8',
    );
    assert.doesNotMatch(css, /gstatic|googleapis|https?:/);
    assert.equal(css.match(/@font-face/g)?.length, 6);
    assert.equal(css.match(/font-display: swap;/g)?.length, 6);
    assert.match(css, /font-style: italic;\n {2}font-weight: 400;/);
    assert.match(css, /unicode-range: U\+0100-02BA, U\+02BD-02C5, U\+1E00-1E9F;/);
    for (const url of css.match(/url\([^)]*\)/g) ?? []) {
      assert.match(
        url,
        new RegExp(`^url\\(${FONT_PATH_PREFIX}atkinson-hyperlegible/[0-9a-f]{12}\\.woff2\\)$`),
      );
    }

    assert.deepEqual(fonts.stylesheet(FAMILY, BODY), fetched.stylesheet);
  });

  it('does nothing the second time while the files are there', async () => {
    google.serveFamily(BODY);
    const first = await fonts.ensure(FAMILY, BODY);
    assert.ok(first.ok);
    assert.equal(first.fetched, true);
    google.requested.length = 0;

    const again = await createFontStore({ dataDir, hostLookup: lookup }).ensure(
      FAMILY,
      [...BODY].reverse(),
    );
    assert.ok(again.ok);
    assert.equal(again.fetched, false);
    assert.deepEqual(again.stylesheet, first.stylesheet);
    assert.deepEqual(google.requested, []);
  });

  it('fetches again when a file it lists has gone', async () => {
    google.serveFamily(BODY);
    const first = await fonts.ensure(FAMILY, BODY);
    assert.ok(first.ok);
    const folder = path.join(dataDir, 'fonts', 'atkinson-hyperlegible');
    const gone = (await readdir(folder)).find((f) => f.endsWith('.woff2'))!;
    await rm(path.join(folder, gone));
    google.requested.length = 0;

    const again = await fonts.ensure(FAMILY, BODY);
    assert.ok(again.ok);
    assert.equal(again.fetched, true);
    assert.ok((await readdir(folder)).includes(gone));
  });
});

describe('a family or style Google does not have', () => {
  it('is refused as an unknown family, and nothing is written', async () => {
    const fetched = await fonts.ensure('Nosuch Family', BODY);
    assert.equal(fetched.ok, false);
    assert.ok(!fetched.ok);
    assert.equal(fetched.refusal.kind, 'unknown-family');
    assert.equal(fetched.refusal.family, 'Nosuch Family');
    assert.match(fetched.refusal.message, /Google Fonts has no family called Nosuch Family/);
    assert.deepEqual(await storedFiles(), []);
  });

  it('names the styles a family lacks, and nothing is written', async () => {
    google.serveFamily([REGULAR, BOLD]);
    const fetched = await fonts.ensure(FAMILY, BODY);
    assert.ok(!fetched.ok);
    assert.equal(fetched.refusal.kind, 'missing-styles');
    assert.ok(fetched.refusal.kind === 'missing-styles');
    assert.deepEqual(fetched.refusal.styles, [ITALIC]);
    assert.match(fetched.refusal.message, /Atkinson Hyperlegible has no 400 italic/);
    assert.deepEqual(await storedFiles(), []);
  });

  it('refuses a name that is not a family name without asking Google', async () => {
    const fetched = await fonts.ensure("Roboto'; } * { color: red", BODY);
    assert.ok(!fetched.ok);
    assert.equal(fetched.refusal.kind, 'invalid-name');
    assert.deepEqual(google.requested, []);
  });
});

describe('a stylesheet that names another host', () => {
  it('is refused, the other host is never contacted, and nothing is written', async () => {
    google.serveFamily(BODY);
    const url = css2Url(FAMILY, BODY);
    google.web[url] = () =>
      new Response(`${face(BOLD, 'latin', 'https://elsewhere.example/evil.woff2')}\n`, {
        headers: { 'content-type': 'text/css' },
      });
    const fetched = await fonts.ensure(FAMILY, BODY);
    assert.ok(!fetched.ok);
    assert.equal(fetched.refusal.kind, 'unavailable');
    assert.match(fetched.refusal.message, /elsewhere\.example/);
    assert.ok(google.requested.every((r) => !r.url.includes('elsewhere.example')));
    assert.deepEqual(await storedFiles(), []);
  });

  it('is refused when Google redirects the stylesheet off its hosts', async () => {
    const url = css2Url(FAMILY, BODY);
    google.web[url] = () =>
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x.css' } });
    const fetched = await fonts.ensure(FAMILY, BODY);
    assert.ok(!fetched.ok);
    assert.equal(fetched.refusal.kind, 'unavailable');
    assert.ok(google.requested.every((r) => !r.url.includes('elsewhere.example')));
  });

  it('is refused when it names a gstatic file over plain http', async () => {
    const url = css2Url(FAMILY, [BOLD]);
    google.web[url] = () =>
      new Response(face(BOLD, 'latin', 'http://fonts.gstatic.com/s/x.woff2'), {
        headers: { 'content-type': 'text/css' },
      });
    const fetched = await fonts.ensure(FAMILY, [BOLD]);
    assert.ok(!fetched.ok);
    assert.equal(fetched.refusal.kind, 'unavailable');
    assert.deepEqual(await storedFiles(), []);
  });
});

describe('the files on disk', () => {
  it('are rebuildable, so an export leaves them out', () => {
    const declared = dataFileFor(CORE_DATA_FILES, 'fonts/atkinson-hyperlegible/0123456789ab.woff2');
    assert.equal(declared?.dataClass.kind, 'rebuildable');
    assert.match(declared?.lost ?? '', /\w/);
    assert.equal(dataFileFor(CORE_DATA_FILES, 'fonts/a/400.css')?.dataClass.kind, 'rebuildable');
  });

  it('have no stylesheet to link while they are missing', () => {
    assert.equal(fonts.stylesheet(FAMILY, BODY), undefined);
  });

  it('lose their stylesheet on the same store once one of them is deleted', async () => {
    google.serveFamily(BODY);
    assert.ok((await fonts.ensure(FAMILY, BODY)).ok);
    assert.notEqual(fonts.stylesheet(FAMILY, BODY), undefined);

    const folder = path.join(dataDir, 'fonts', fontFamilySlug(FAMILY));
    const gone = (await readdir(folder)).find((name) => name.endsWith('.woff2'));
    assert.ok(gone !== undefined);
    await rm(path.join(folder, gone));

    assert.equal(fonts.stylesheet(FAMILY, BODY), undefined);
  });
});
