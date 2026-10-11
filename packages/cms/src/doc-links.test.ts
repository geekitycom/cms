import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { anchorsOf, checkDocLinks, docFiles, slug } from '../../../scripts/check-doc-links.ts';

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geekity-doc-links-'));
  scratch.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('slug', () => {
  it('gives the anchors GitHub gives these headings', () => {
    assert.deepEqual(
      [
        'The `geekity` command',
        'security.txt and change-password',
        '1. Create the stack and its directories',
        "Core releases and the plugins' core range",
        'Two directories: `content/` and `data/`',
        'A user_name in **bold**',
      ].map(slug),
      [
        'the-geekity-command',
        'securitytxt-and-change-password',
        '1-create-the-stack-and-its-directories',
        'core-releases-and-the-plugins-core-range',
        'two-directories-content-and-data',
        'a-user_name-in-bold',
      ],
    );
  });

  it('numbers a repeated heading and ignores one inside a code fence', () => {
    const anchors = anchorsOf('# Feeds\n\n## Comments\n\n```md\n## Fenced\n```\n\n### Comments\n');
    assert.deepEqual([...anchors], ['feeds', 'comments', 'comments-1']);
  });
});

describe('checkDocLinks', () => {
  it('reports a missing file, a missing anchor and an undefined reference, and nothing else', () => {
    const root = repository({
      'README.md': [
        '# Site',
        '',
        'See [a real heading](docs/a.md#a-real-heading) and [the top](#site).',
        'See [nothing](docs/missing.md) and [a wrong anchor](docs/a.md#nope).',
        'A [reference][gone] and a [kept one][kept].',
        'Code is skipped: `[x](docs/missing.md)`.',
        '',
        '```md',
        '[y](docs/missing.md)',
        '```',
        '',
        '[kept]: docs/a.md',
        '',
      ].join('\n'),
      'docs/a.md': '# A\n\n## A real heading\n',
    });

    assert.deepEqual(
      checkDocLinks(root, docFiles(root)).map((p) => `${p.file}:${String(p.line)}: ${p.message}`),
      [
        'README.md:5: [gone]: no reference definition in this file',
        'README.md:4: docs/missing.md: no such file docs/missing.md',
        'README.md:4: docs/a.md#nope: no heading in docs/a.md has the anchor #nope',
      ],
    );
  });

  it('holds a README that ships to npm to absolute links, and checks those against the checkout', () => {
    const root = repository({
      'README.md': '# Site\n',
      'docs/a.md': '# A\n\n## Here\n',
      'packages/thing/README.md': [
        '# Thing',
        '',
        '[relative](../../docs/a.md)',
        '[absolute](https://github.com/geekitycom/cms/blob/main/docs/a.md#here)',
        '[wrong](https://github.com/geekitycom/cms/blob/main/docs/a.md#there)',
        '[inside](src/index.ts)',
        '',
      ].join('\n'),
      'packages/thing/src/index.ts': '',
    });

    assert.deepEqual(
      checkDocLinks(root, docFiles(root)).map((p) => `${p.file}:${String(p.line)}: ${p.message}`),
      [
        'packages/thing/README.md:3: ../../docs/a.md: this README ships to npm, so link outside packages/thing as https://github.com/geekitycom/cms/blob/main/...',
        'packages/thing/README.md:5: https://github.com/geekitycom/cms/blob/main/docs/a.md#there: no heading in docs/a.md has the anchor #there',
      ],
    );
  });
});
