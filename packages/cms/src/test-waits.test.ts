import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

const TIME_WAIT = new RegExp(
  [
    /\bsetTimeout\s*\(/,
    /node:timers\/promises/,
    /\bsleep\s*\(/,
    /\bdeadline\b.*\bDate\.now\(\)|\bDate\.now\(\).*\bdeadline\b/,
    /\bDate\.now\(\)(?:\s*-\s*\w+)?\s*[<>]|[<>]=?\s*Date\.now\(\)/,
    /=\s*Date\.now\(\)\s*-\s*[a-z]\w*\s*;/,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
);

const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

interface Allowance {
  readonly file: string;
  readonly line: string;
  readonly because: string;
}

const DURATION = 'measures a duration the test asserts on';

const ALLOWED: readonly Allowance[] = [
  {
    file: '__testing__/wait.ts',
    line: 'const timer = setTimeout(() => {',
    because: 'the bound on every event wait, so a missing event fails instead of hanging',
  },
  {
    file: '__testing__/offline.test.ts',
    line: 'await new Promise((resolve) => setTimeout(resolve, 10));',
    because: 'the source of a child test program, which swallows a fetch and carries on',
  },
  { file: 'cli-reload.test.ts', line: 'const took = Date.now() - started;', because: DURATION },
  { file: 'cli-reload.test.ts', line: 'const took = Date.now() - copied;', because: DURATION },
  {
    file: 'admin/cited-title-slug.test.ts',
    line: 'const waited = Date.now() - started;',
    because: DURATION,
  },
  {
    file: 'admin/plugins-install.test.ts',
    line: 'assert.ok(Date.now() - started < 10_000',
    because: DURATION,
  },
  {
    file: 'indieauth/client.test.ts',
    line: 'assert.ok(Date.now() - started < 2000',
    because: DURATION,
  },
  {
    file: 'webmention/cited-picture.test.ts',
    line: 'assert.ok(Date.now() - started < 2_000);',
    because: DURATION,
  },
  {
    file: 'webmention/reply-context.test.ts',
    line: 'assert.ok(Date.now() - started < 2_000',
    because: DURATION,
  },
];

interface TimeWait {
  readonly file: string;
  readonly line: string;
  readonly at: string;
}

const SELF_QUOTING_CHECKS = new Set(['test-waits.test.ts', 'clock-boundary.test.ts']);

function isTest(relative: string): boolean {
  return (
    relative.endsWith('.test.ts') ||
    (relative.endsWith('.ts') && relative.split(path.sep).includes('__testing__'))
  );
}

function timeWaits(): TimeWait[] {
  const found: TimeWait[] = [];
  for (const entry of readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(SOURCE_ROOT, absolute);
    if (!isTest(relative)) continue;
    const file = relative.split(path.sep).join('/');
    if (SELF_QUOTING_CHECKS.has(file)) continue;
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        if (COMMENT.test(text) || !TIME_WAIT.test(text)) return;
        found.push({ file, line: text.trim(), at: `${file}:${String(index + 1)}` });
      });
  }
  return found;
}

function allows(allowance: Allowance, wait: TimeWait): boolean {
  return allowance.file === wait.file && wait.line.includes(allowance.line);
}

describe('the tests', () => {
  const waits = timeWaits();

  it('wait on events, not on time', () => {
    const unlisted = waits
      .filter((wait) => !ALLOWED.some((allowance) => allows(allowance, wait)))
      .map((wait) => `${wait.at}: ${wait.line}`);

    assert.deepEqual(
      unlisted,
      [],
      'these wait on time: wait for the event instead with nextEvent from ' +
        '__testing__/wait.ts, move a pinned clock (createCms({ now })), or list ' +
        'the line in ALLOWED if the test asserts a duration',
    );
  });

  it('list no allowance that no longer matches a wait', () => {
    const stale = ALLOWED.filter((allowance) => !waits.some((wait) => allows(allowance, wait))).map(
      (allowance) => `${allowance.file}: ${allowance.line}`,
    );

    assert.deepEqual(stale, []);
  });
});
