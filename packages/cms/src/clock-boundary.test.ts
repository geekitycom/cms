import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

const CLOCK_READ = /\bnew Date\(\s*\)|\bDate\.now\(\s*\)|\bsystemClock\(\)|\?\?\s*systemClock\b/;

const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

interface Allowance {
  readonly file: string;
  readonly line: string;
  readonly because: string;
}

const ELAPSED_WALL_TIME = 'measures elapsed wall time, which a pinned clock would stop';

const ALLOWED: readonly Allowance[] = [
  {
    file: 'util/clock.ts',
    line: 'export const systemClock: Clock = () => new Date();',
    because: 'the system clock definition',
  },
  {
    file: 'config.ts',
    line: 'now: config.now ?? systemClock,',
    because: 'the one clock createCms builds every service with, when a site names none',
  },
  {
    file: 'content/sqlite/open.ts',
    line: 'const clock = options.now ?? systemClock;',
    because: 'the index opened outside createCms, by a test or a tool, when it names no clock',
  },
  {
    file: 'store/admin-store.ts',
    line: 'options.now ?? systemClock',
    because: 'openAdminStore is public; a caller outside createCms may name no clock',
  },
  {
    file: 'content/served.ts',
    line: 'export function isServed(document: Document, now: Date = systemClock()): boolean {',
    because: 'isServed is public; a caller outside createCms may name no instant',
  },
  {
    file: 'content/served.ts',
    line: 'export function isListed(document: Document, now: Date = systemClock()): boolean {',
    because: 'isListed is public; a caller outside createCms may name no instant',
  },
  {
    file: 'site/users.ts',
    line: 'createdAt: (input.now ?? systemClock()).toISOString(),',
    because: 'createUser is public; a caller outside createCms may name no instant',
  },
  {
    file: 'content/sync.ts',
    line: 'const deadline = Date.now() + PROBE_DEADLINE_MS;',
    because: ELAPSED_WALL_TIME,
  },
  {
    file: 'content/sync.ts',
    line: 'while (Date.now() < deadline) {',
    because: ELAPSED_WALL_TIME,
  },
  {
    file: 'webmention/reply-contexts.ts',
    line: 'const deadline = Date.now() + CITED_SLUG_TIMEOUT_MS;',
    because: ELAPSED_WALL_TIME,
  },
  {
    file: 'webmention/reply-contexts.ts',
    line: 'const timeoutMs = deadline - Date.now();',
    because: ELAPSED_WALL_TIME,
  },
  {
    file: 'supervisor/primary.ts',
    line: 'now: () => Date.now(),',
    because: `the supervisor's crash and settle windows; ${ELAPSED_WALL_TIME}`,
  },
  {
    file: 'jobs/lock-file.ts',
    line: 'if (Date.now() - info.mtimeMs > STALE_LOCK_MS) return true;',
    because: 'measures how long a lock file has been held, against the file system clock',
  },
];

interface ClockRead {
  readonly file: string;
  readonly line: string;
  readonly at: string;
}

function isSource(relative: string): boolean {
  return (
    relative.endsWith('.ts') &&
    !relative.endsWith('.test.ts') &&
    !relative.split(path.sep).includes('__testing__')
  );
}

function clockReads(): ClockRead[] {
  const found: ClockRead[] = [];
  for (const entry of readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(SOURCE_ROOT, absolute);
    if (!isSource(relative)) continue;
    const file = relative.split(path.sep).join('/');
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        if (COMMENT.test(text) || !CLOCK_READ.test(text)) return;
        found.push({ file, line: text.trim(), at: `${file}:${String(index + 1)}` });
      });
  }
  return found;
}

function allows(allowance: Allowance, read: ClockRead): boolean {
  return allowance.file === read.file && read.line.includes(allowance.line);
}

describe('the clock', () => {
  const reads = clockReads();

  it('is read only through the clock createCms is built with', () => {
    const unlisted = reads
      .filter((read) => !ALLOWED.some((allowance) => allows(allowance, read)))
      .map((read) => `${read.at}: ${read.line}`);

    assert.deepEqual(
      unlisted,
      [],
      'these read the system clock: take the instant from the injected clock ' +
        '(config.now, store.now() or admin.now()), or list the read in ALLOWED ' +
        'if it measures elapsed wall time',
    );
  });

  it('lists no allowance that no longer matches a read', () => {
    const stale = ALLOWED.filter((allowance) => !reads.some((read) => allows(allowance, read))).map(
      (allowance) => `${allowance.file}: ${allowance.line}`,
    );

    assert.deepEqual(stale, []);
  });
});
