/**
 * `scripts/npm-publish.sh`, the one way this package reaches npm.
 *
 * The script lives at the repository root, but the package it publishes is
 * this one, and this is the test glob CI runs. It is driven through its
 * command line only: arguments, working directory, exit status and output.
 * `git`, `npm` and `pnpm` are the three things it talks to, so each test puts
 * stub executables for them first on PATH. The stubs append every call to a
 * log and answer as the test tells them to, which is how a test sees what
 * would have been published without publishing anything or logging in to
 * anything. The script runs from a copy in a throwaway fixture repository, so
 * the version it reads is one the test chose, not whatever release-please last
 * wrote.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { PACKAGE_ROOT } from './__testing__/cli.ts';

const SCRIPT = path.join(PACKAGE_ROOT, '..', '..', 'scripts', 'npm-publish.sh');
const GATES = ['lint', 'format:check', 'typecheck', 'test', 'test:11ty'];

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Everything a stub reads to decide how to behave. */
interface Options {
  /** The `pnpm` script that should fail, if any. */
  failGate?: string;
  /** `git status --porcelain` lists a change, as it does in a dirty tree. */
  dirty?: boolean;
  /** What `git tag --points-at HEAD` prints. Defaults to the version's tag. */
  headTags?: string[];
  /** `npm whoami` fails, as it does when nobody is logged in. */
  loggedOut?: boolean;
  /** What `npm view <pkg>@<version> version` prints; empty means unpublished. */
  published?: string;
  /** Run from this path inside the fixture repository. */
  subdir?: string;
}

interface Run {
  status: number | null;
  output: string;
  /** Every stub call, one per line: `pnpm lint`, `npm whoami`. */
  calls: string[];
}

/** A stub executable that logs its name and arguments to `$STUB_LOG`. */
const STUB = `#!/bin/sh
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0") $1" in
  "pnpm $STUB_FAIL_GATE") exit 1 ;;
  "git status") printf '%s' "$STUB_DIRTY" ;;
  "git tag") printf '%s' "$STUB_HEAD_TAGS" ;;
  "npm whoami") [ -z "$STUB_LOGGED_OUT" ] || exit 1; echo "a-maintainer" ;;
  "npm view") [ -n "$STUB_PUBLISHED" ] || exit 1; echo "$STUB_PUBLISHED" ;;
esac
exit 0
`;

/**
 * Make a fixture repository with `version` in `packages/cms/package.json` and
 * a different version in the root `package.json`, copy the script into it, and
 * run it with `args`.
 */
function run(args: string[], version = '9.8.7', options: Options = {}): Run {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'geekity-npm-publish-'));
  scratch.push(repo);

  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'npm-publish.sh'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{ "version": "0.0.0" }\n');
  fs.mkdirSync(path.join(repo, 'packages', 'cms'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'packages', 'cms', 'package.json'),
    JSON.stringify({ name: '@geekity/cms', version }),
  );
  fs.mkdirSync(path.join(repo, 'apps', 'demo'), { recursive: true });

  const bin = path.join(repo, '.stub-bin');
  fs.mkdirSync(bin);
  for (const name of ['git', 'npm', 'pnpm']) {
    fs.writeFileSync(path.join(bin, name), STUB, { mode: 0o755 });
  }

  const log = path.join(repo, '.stub-log');
  fs.writeFileSync(log, '');

  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: repo,
    STUB_LOG: log,
    STUB_FAIL_GATE: options.failGate ?? '',
    STUB_DIRTY: options.dirty === true ? ' M packages/cms/src/index.ts\n' : '',
    STUB_HEAD_TAGS: (options.headTags ?? [`v${version}`]).join('\n'),
    STUB_LOGGED_OUT: options.loggedOut === true ? '1' : '',
    STUB_PUBLISHED: options.published ?? '',
  };

  const result = spawnSync('bash', [path.join(repo, 'scripts', 'npm-publish.sh'), ...args], {
    cwd: path.join(repo, options.subdir ?? ''),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status,
    output: result.stdout + result.stderr,
    calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

const publishes = (calls: string[]): string[] => calls.filter((c) => c.startsWith('pnpm publish'));
const gatesRun = (calls: string[]): string[] =>
  calls
    .filter((c) => c.startsWith('pnpm ') && !c.startsWith('pnpm publish'))
    .map((c) => c.slice('pnpm '.length));

describe('npm-publish.sh --dry-run', () => {
  it('prints the package, the version and the tag it would publish from, and publishes nothing', () => {
    const { status, output, calls } = run(['--dry-run']);

    assert.equal(status, 0, output);
    assert.match(output, /@geekity\/cms/);
    assert.match(output, /9\.8\.7/);
    assert.match(output, /v9\.8\.7/);
    assert.match(output, /lint format:check typecheck test test:11ty/);
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
    assert.deepEqual(calls, []);
  });
});

describe('npm-publish.sh version', () => {
  it('publishes the version in packages/cms/package.json, not the workspace root', () => {
    const { status, output } = run(['--dry-run'], '1.2.3');

    assert.equal(status, 0, output);
    assert.match(output, /1\.2\.3/);
    assert.match(output, /v1\.2\.3/);
    assert.doesNotMatch(output, /0\.0\.0/);
  });
});

describe('npm-publish.sh arguments', () => {
  it('refuses to run from anywhere but the repository root', () => {
    const { status, output, calls } = run(['--dry-run'], '9.8.7', { subdir: 'apps/demo' });

    assert.notEqual(status, 0, output);
    assert.match(output, /repository root/);
    assert.deepEqual(calls, []);
  });

  it('rejects an unknown option', () => {
    const { status, output, calls } = run(['--force']);

    assert.notEqual(status, 0, output);
    assert.match(output, /unknown option: --force/);
    assert.deepEqual(calls, []);
  });
});

describe('npm-publish.sh refusals', () => {
  it('refuses a dirty working tree, before any gate runs', () => {
    const { status, output, calls } = run([], '9.8.7', { dirty: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /working tree/);
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
  });

  it('refuses when HEAD does not carry the version tag, before any gate runs', () => {
    const { status, output, calls } = run([], '9.8.7', { headTags: ['v9.8.6'] });

    assert.notEqual(status, 0, output);
    assert.match(output, /v9\.8\.7/);
    assert.match(output, /HEAD/);
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
  });

  it('refuses when nobody is logged in to npm, and never logs in itself', () => {
    const { status, output, calls } = run([], '9.8.7', { loggedOut: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /npm login/);
    assert.ok(!calls.some((c) => c.startsWith('npm login')), calls.join('\n'));
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
  });

  it('refuses when the version is already on the registry, before any gate runs', () => {
    const { status, output, calls } = run([], '9.8.7', { published: '9.8.7' });

    assert.notEqual(status, 0, output);
    assert.match(output, /already published/);
    assert.match(output, /9\.8\.7/);
    assert.ok(calls.includes('npm view @geekity/cms@9.8.7 version'), calls.join('\n'));
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
  });
});

describe('npm-publish.sh quality gates', () => {
  for (const [index, gate] of GATES.entries()) {
    it(`stops before publishing when ${gate} fails`, () => {
      const { status, output, calls } = run([], '9.8.7', { failGate: gate });

      assert.notEqual(status, 0, output);
      assert.deepEqual(gatesRun(calls), GATES.slice(0, index + 1));
      assert.deepEqual(publishes(calls), []);
      assert.match(output, new RegExp(gate));
    });
  }
});

describe('npm-publish.sh real run', () => {
  it('checks, runs every gate, then publishes the tagged version without --no-git-checks', () => {
    const { status, output, calls } = run([], '9.8.7', { headTags: ['v9.8.7', 'nightly'] });

    assert.equal(status, 0, output);
    assert.deepEqual(gatesRun(calls), GATES);
    const [publish, ...more] = publishes(calls);
    assert.deepEqual(more, []);
    assert.ok(publish !== undefined, calls.join('\n'));
    assert.equal(publish, 'pnpm publish --filter @geekity/cms --access public');
    assert.ok(calls.indexOf(publish) > calls.lastIndexOf('pnpm test:11ty'), calls.join('\n'));
    assert.ok(calls.indexOf('npm whoami') < calls.indexOf('pnpm lint'), calls.join('\n'));
    assert.match(output, /@geekity\/cms@9\.8\.7/);
  });
});
