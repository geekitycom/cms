import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ADMIN_TEMPLATES, PACKAGED_ADMIN_DIR } from './templates.ts';

/**
 * Nunjucks has no public API for a template's dependencies, so they are read
 * from the text: every `extends`, `import`, `include` and `from` names its
 * target as a string literal, and every static file is written as
 * `{{ adminAsset('name') }}`.
 */

const TEMPLATE_REFERENCE = /\{%-?\s*(?:extends|import|include|from)\s+(["'])([^"']+)\1/g;
const ASSET_REFERENCE = /\{\{\s*adminAsset\((["'])([\w./-]+)\1\)\s*\}\}/g;
const UNVERSIONED_ASSET = /_static\/|assetPrefix/;

interface Walk {
  templates: Set<string>;
  assets: Set<string>;
  missing: string[];
  unversioned: string[];
}

async function walk(name: string, from: string, seen: Walk): Promise<void> {
  if (seen.templates.has(name)) return;
  seen.templates.add(name);
  const file = path.join(PACKAGED_ADMIN_DIR, name);
  if (!existsSync(file)) {
    seen.missing.push(`${name} (from ${from})`);
    return;
  }
  const text = await readFile(file, 'utf8');
  for (const [, , asset] of text.matchAll(ASSET_REFERENCE)) seen.assets.add(asset ?? '');
  if (UNVERSIONED_ASSET.test(text)) seen.unversioned.push(name);
  for (const [, , target] of text.matchAll(TEMPLATE_REFERENCE)) {
    await walk(target ?? '', name, seen);
  }
}

describe('the admin folder', async () => {
  const seen: Walk = {
    templates: new Set(),
    assets: new Set(),
    missing: [],
    unversioned: [],
  };
  for (const name of Object.values(ADMIN_TEMPLATES)) await walk(name, 'ADMIN_TEMPLATES', seen);

  it('holds every template the admin renders and everything those extend, import or include', () => {
    assert.deepEqual(seen.missing, []);
    assert.ok(seen.templates.has('layouts/shell.njk'));
    assert.ok(seen.templates.has('static/admin-bar.css'));
  });

  it('holds every static file those templates reference', () => {
    const missing = [...seen.assets].filter(
      (asset) => !existsSync(path.join(PACKAGED_ADMIN_DIR, 'static', asset)),
    );
    assert.deepEqual(missing, []);
    assert.ok(seen.assets.has('editor.js'));
    assert.ok(seen.assets.has('admin.css'));
  });

  it('links every static file through adminAsset, so its URL names the version', () => {
    assert.deepEqual(seen.unversioned, []);
  });
});
