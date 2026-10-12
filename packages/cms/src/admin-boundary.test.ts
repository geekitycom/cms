import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

const BELOW_ADMIN = ['content', 'media', 'micropub', 'site'];

const ADMIN_IMPORT = /from\s+['"](?:\.\.\/)+admin\//;

describe('the admin boundary', () => {
  it('keeps the modules below the admin from importing admin/', () => {
    const offenders: string[] = [];
    for (const directory of BELOW_ADMIN) {
      for (const entry of readdirSync(path.join(SOURCE_ROOT, directory), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
          continue;
        }
        const file = path.join(entry.parentPath, entry.name);
        if (file.split(path.sep).includes('__testing__')) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (ADMIN_IMPORT.test(line)) {
              offenders.push(`${path.relative(SOURCE_ROOT, file)}:${String(index + 1)}`);
            }
          });
      }
    }
    assert.deepEqual(offenders, []);
  });
});
