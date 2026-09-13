/**
 * The default theme's code highlighter, `themes/default/static/highlight.js`.
 *
 * The bundle is a build product that is nevertheless committed (see
 * `scripts/build-highlight.js`), so a site gets a working highlighter out of
 * the package with no build step of its own. That makes it something a test has
 * to hold to account: it is the file readers actually download, not a source
 * file somebody might rebuild.
 *
 * There is no browser here and no jsdom in this project, so the bundle is run
 * in a Node VM against the smallest DOM it touches — `document.readyState`,
 * `addEventListener`, `querySelectorAll`, and per element `getAttribute`,
 * `className`, `classList`, `dataset`, `children`, `textContent`, `innerHTML`.
 * That is enough to prove what TASK-86 AC #3 claims: a known language is
 * highlighted into `hljs-` spans, an unknown one is left exactly as the
 * renderer wrote it, and nothing is auto-detected.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { renderMarkdown } from '../content/markdown.ts';
import { PACKAGED_THEME_DIR } from './themes.ts';

const BUNDLE = path.join(PACKAGED_THEME_DIR, 'static', 'highlight.js');

/** The languages `scripts/build-highlight.js` says it puts in the bundle. */
const LANGUAGES = [
  'bash',
  'css',
  'diff',
  'dockerfile',
  'go',
  'ini',
  'javascript',
  'json',
  'markdown',
  'nginx',
  'php',
  'python',
  'rust',
  'shell',
  'sql',
  'typescript',
  'xml',
  'yaml',
];

/** The `<code>` the bundle sees: everything it reads, and nothing else. */
interface CodeElement {
  /** The `class` attribute, as the renderer wrote it plus whatever hljs added. */
  classes: Set<string>;
  /** The text inside, which becomes marked-up HTML once it is highlighted. */
  innerHTML: string;
  /** The same set as a string, which is what both readers of it actually use. */
  readonly className: string;
  readonly textContent: string;
  readonly dataset: Record<string, string>;
  readonly children: { length: number };
  readonly classList: { add: (name: string) => void };
  getAttribute: (name: string) => string | null;
}

/** A `<code class="language-…">text</code>` for the stub document to hand over. */
function codeElement(language: string | undefined, text: string): CodeElement {
  const classes = new Set(language === undefined ? [] : [`language-${language}`]);

  return {
    classes,
    innerHTML: text,
    get className(): string {
      return [...classes].join(' ');
    },
    get textContent(): string {
      return text;
    },
    dataset: {},
    children: { length: 0 },
    classList: { add: (name: string) => void classes.add(name) },
    getAttribute: (name: string) => (name === 'class' ? [...classes].join(' ') : null),
  };
}

/** The bundle's `hljs`, the API it puts on `window`. */
interface Hljs {
  versionString: string;
  listLanguages: () => string[];
  getLanguage: (name: string) => unknown;
}

/**
 * Run the bundle over a list of code elements and give back what it did.
 *
 * `readyState` is `loading`, so the bundle registers a `DOMContentLoaded`
 * listener rather than running at once; the listener is then called here, which
 * is both what a browser does and what makes this deterministic.
 */
function run(elements: CodeElement[]): Hljs {
  let ready: (() => void) | undefined;

  const document = {
    readyState: 'loading',
    addEventListener: (event: string, listener: () => void) => {
      if (event === 'DOMContentLoaded') ready = listener;
    },
    querySelectorAll: (selector: string) => {
      assert.equal(
        selector,
        'pre code[class*="language-"]',
        'the bundle looked for something other than a fenced block',
      );
      return elements.filter((element) => element.getAttribute('class')?.includes('language-'));
    },
  };

  const window: { hljs?: Hljs } = {};
  const sandbox = { document, window, console };
  runInNewContext(readFileSync(BUNDLE, 'utf8'), sandbox);

  assert.ok(ready, 'the bundle did not wait for DOMContentLoaded');
  ready();

  assert.ok(window.hljs, 'the bundle put no hljs on the window');
  return window.hljs;
}

describe('the default theme highlighter (TASK-86)', () => {
  it('is built from the pinned highlight.js, with the documented languages', () => {
    const require = createRequire(import.meta.url);
    const { version } = require('highlight.js/package.json') as { version: string };

    const hljs = run([]);

    assert.equal(
      hljs.versionString,
      version,
      'the committed bundle was built from a different highlight.js: run `pnpm --filter @geekity/cms build:highlight`',
    );
    assert.deepEqual([...hljs.listLanguages()].sort(), [...LANGUAGES].sort());
  });

  it('fetches nothing at runtime: no CDN, no network call, no injected tag', () => {
    const source = readFileSync(BUNDLE, 'utf8');

    // The only URLs in it are the two documentation links highlight.js prints
    // in a console warning; nothing is loaded from anywhere.
    assert.deepEqual(
      [...new Set(source.match(/https?:\/\/[^"'`\s,)]+/g) ?? [])].sort(),
      [
        'https://github.com/highlightjs/highlight.js/issues/2277',
        'https://github.com/highlightjs/highlight.js/wiki/security',
      ],
      'the bundle names a host it did not before',
    );
    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|XMLHttpRequest|importScripts|createElement\(["'`]script/,
      'the bundle loads something at runtime',
    );

    // And the sandbox every other test in this file runs it in has no `fetch`,
    // no `XMLHttpRequest` and no network of any kind: it would throw.
  });

  it('highlights a block whose language it knows', () => {
    const element = codeElement('js', 'const answer = 42;\n');
    run([element]);

    assert.match(element.innerHTML, /<span class="hljs-keyword">const<\/span>/);
    assert.match(element.innerHTML, /hljs-number/);
    assert.ok(element.classes.has('hljs'), 'the element was not marked as highlighted');
    assert.ok(element.classes.has('language-js'), 'the element lost its language class');
  });

  it('marks a diff block up as additions and deletions', () => {
    const element = codeElement('diff', '--- a\n+++ b\n-gone\n+here\n');
    run([element]);

    assert.match(element.innerHTML, /<span class="hljs-deletion">-gone<\/span>/);
    assert.match(element.innerHTML, /<span class="hljs-addition">\+here<\/span>/);
  });

  it('leaves a language it does not know alone, class and text', () => {
    const element = codeElement('brainfuck', '++[->+<]\n');
    run([element]);

    assert.equal(element.innerHTML, '++[->+<]\n', 'an unknown language was touched');
    assert.deepEqual([...element.classes], ['language-brainfuck']);
  });

  it('detects nothing: a block with no language stays plain', () => {
    const element = codeElement(undefined, 'SELECT * FROM documents;\n');
    run([element]);

    assert.equal(element.innerHTML, 'SELECT * FROM documents;\n', 'a plain block was highlighted');
    assert.equal(element.classes.size, 0, 'a plain block was given a class');
  });

  it('reads the classes the renderer writes', () => {
    // The selector and the class the bundle looks for are the renderer's
    // output, not a convention the two agree on separately.
    const html = renderMarkdown('```sql\nSELECT 1;\n```\n');

    assert.match(html, /<pre tabindex="0"><code class="language-sql">/);
  });
});
