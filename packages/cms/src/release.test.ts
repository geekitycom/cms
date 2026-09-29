/**
 * `scripts/release.sh`, which publishes this package to npm and its image to
 * ghcr.io in one run.
 *
 * It is driven like the two scripts it runs: from copies in a throwaway
 * fixture repository, with stub `git`, `npm`, `pnpm` and `docker` executables
 * first on PATH that log every call and fail when told to. The log is one
 * sequence across all three scripts, which is how a test sees the order of
 * the whole release: every preflight check, each gate once, the npm publish,
 * then the image build.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { PACKAGE_ROOT } from './__testing__/cli.ts';

const SCRIPTS = path.join(PACKAGE_ROOT, '..', '..', 'scripts');
const COPIED = ['release.sh', 'npm-publish.sh', 'docker-build-push.sh', 'lib/quality-gates.sh'];
const GATES = ['lint', 'format:check', 'typecheck', 'test', 'test:11ty'];
const RECOVERY = 'pnpm docker:build-push -- --skip-gates';

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Everything a stub reads to decide how to behave. */
interface Options {
  /** The `pnpm` script that should fail, if any. */
  failGate?: string;
  /** `npm view` finds the version, as it does once it is published. */
  published?: boolean;
  /** `pnpm publish` fails. */
  publishFails?: boolean;
  /** `docker info` fails, as it does when the daemon is down. */
  dockerDown?: boolean;
  /** `docker buildx build` fails. */
  buildFails?: boolean;
  /** Run from this path inside the fixture repository. */
  subdir?: string;
}

interface Run {
  status: number | null;
  output: string;
  /** Every stub call, one per line: `npm whoami`, `pnpm lint`. */
  calls: string[];
}

/** A stub executable that logs its name and arguments to `$STUB_LOG`. */
const STUB = `#!/bin/sh
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0") $1" in
  "pnpm publish") [ -z "$STUB_PUBLISH_FAILS" ] || exit 1 ;;
  "pnpm $STUB_FAIL_GATE") exit 1 ;;
  "git tag") echo "v9.8.7" ;;
  "npm whoami") echo "a-maintainer" ;;
  "npm view") [ -n "$STUB_PUBLISHED" ] || exit 1; echo "9.8.7" ;;
  "docker info") [ -z "$STUB_DOCKER_DOWN" ] || exit 1 ;;
  "docker login") exit 1 ;;
  "docker buildx") [ "$2" != build ] || [ -z "$STUB_BUILD_FAILS" ] || exit 1 ;;
esac
exit 0
`;

function fixture(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'geekity-release-'));
  scratch.push(repo);

  fs.mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true });
  for (const file of COPIED) {
    fs.copyFileSync(path.join(SCRIPTS, file), path.join(repo, 'scripts', file));
  }
  fs.writeFileSync(path.join(repo, 'Dockerfile'), 'FROM scratch\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{ "version": "0.0.0" }\n');
  fs.mkdirSync(path.join(repo, 'packages', 'cms'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'packages', 'cms', 'package.json'),
    JSON.stringify({ name: '@geekity/cms', version: '9.8.7' }),
  );
  fs.mkdirSync(path.join(repo, 'apps', 'demo'), { recursive: true });

  const bin = path.join(repo, '.stub-bin');
  fs.mkdirSync(bin);
  for (const name of ['git', 'npm', 'pnpm', 'docker']) {
    fs.writeFileSync(path.join(bin, name), STUB, { mode: 0o755 });
  }

  const home = path.join(repo, '.stub-home');
  fs.mkdirSync(path.join(home, '.docker'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.docker', 'config.json'),
    JSON.stringify({ auths: { 'ghcr.io': {} } }),
  );
  return repo;
}

/** Run `script` from a fresh fixture repository with `args`. */
function run(args: string[], options: Options = {}, script = 'release.sh'): Run {
  const repo = fixture();
  const log = path.join(repo, '.stub-log');
  fs.writeFileSync(log, '');

  const env: NodeJS.ProcessEnv = {
    PATH: `${path.join(repo, '.stub-bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: path.join(repo, '.stub-home'),
    STUB_LOG: log,
    STUB_FAIL_GATE: options.failGate ?? '',
    STUB_PUBLISHED: options.published === true ? '1' : '',
    STUB_PUBLISH_FAILS: options.publishFails === true ? '1' : '',
    STUB_DOCKER_DOWN: options.dockerDown === true ? '1' : '',
    STUB_BUILD_FAILS: options.buildFails === true ? '1' : '',
  };

  const result = spawnSync('bash', [path.join(repo, 'scripts', script), ...args], {
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

type Phase = 'preflight' | 'gate' | 'publish' | 'build';

/** Which part of a release a stub call belongs to. */
function phase(call: string): Phase {
  if (call.startsWith('pnpm publish')) return 'publish';
  if (call.startsWith('pnpm ')) return 'gate';
  if (call.startsWith('docker buildx')) return 'build';
  return 'preflight';
}

/** The phases in the order they ran, with each run of one phase collapsed. */
const phases = (calls: string[]): Phase[] =>
  calls.map(phase).filter((p, i, all) => i === 0 || all[i - 1] !== p);
const gatesRun = (calls: string[]): string[] =>
  calls.filter((c) => phase(c) === 'gate').map((c) => c.slice('pnpm '.length));
const publishes = (calls: string[]): string[] => calls.filter((c) => phase(c) === 'publish');
const builds = (calls: string[]): string[] =>
  calls.filter((c) => c.startsWith('docker buildx build'));

/** The gates a script's dry run says it would run. */
function gatesOf(script: string): string[] {
  const { output } = run(['--dry-run'], {}, script);
  const line = /Would run the quality gates: (.+)/.exec(output)?.[1];
  assert.ok(line !== undefined, output);
  return line.split(' ');
}

describe('release.sh quality gates', () => {
  it('runs every gate either script runs, in one order', () => {
    const union = new Set([...gatesOf('npm-publish.sh'), ...gatesOf('docker-build-push.sh')]);
    const { status, output, calls } = run([]);

    assert.equal(status, 0, output);
    assert.deepEqual(new Set(gatesRun(calls)), union);
    assert.deepEqual(gatesRun(calls), GATES);
  });

  for (const [index, gate] of GATES.entries()) {
    it(`publishes nothing and builds nothing when ${gate} fails`, () => {
      const { status, output, calls } = run([], { failGate: gate });

      assert.notEqual(status, 0, output);
      assert.deepEqual(gatesRun(calls), GATES.slice(0, index + 1));
      assert.deepEqual(publishes(calls), []);
      assert.deepEqual(builds(calls), []);
      assert.match(output, new RegExp(`'pnpm ${gate}' failed`));
    });
  }
});

describe('release.sh real run', () => {
  it('runs every preflight check, then each gate once, then publishes, then builds', () => {
    const { status, output, calls } = run([]);

    assert.equal(status, 0, output);
    // Each half re-runs its own checks just before it publishes.
    assert.deepEqual(phases(calls), [
      'preflight',
      'gate',
      'preflight',
      'publish',
      'preflight',
      'build',
    ]);
    assert.deepEqual(gatesRun(calls), GATES);
    assert.equal(publishes(calls).length, 1, calls.join('\n'));
    assert.equal(builds(calls).length, 1, calls.join('\n'));
    assert.ok(calls.indexOf('npm whoami') < calls.indexOf('docker info'), calls.join('\n'));
    assert.ok(calls.indexOf('docker info') < calls.indexOf('pnpm lint'), calls.join('\n'));
  });

  it('passes a custom tag through to the image build', () => {
    const { status, output, calls } = run(['beta']);

    assert.equal(status, 0, output);
    const tags = [...(builds(calls)[0] ?? '').matchAll(/--tag (\S+)/g)].map((m) => m[1]);
    assert.deepEqual(tags, [
      'ghcr.io/geekitycom/cms:9.8.7',
      'ghcr.io/geekitycom/cms:latest',
      'ghcr.io/geekitycom/cms:beta',
    ]);
  });
});

describe('release.sh preflight', () => {
  it('runs no gate when the npm preflight fails, and never reaches Docker', () => {
    const { status, output, calls } = run([], { published: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /already published/);
    assert.deepEqual(phases(calls), ['preflight']);
    assert.ok(!calls.includes('docker info'), calls.join('\n'));
  });

  it('runs no gate when the Docker preflight fails', () => {
    const { status, output, calls } = run([], { dockerDown: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /Docker is not running/);
    assert.deepEqual(phases(calls), ['preflight']);
    assert.ok(calls.includes('npm whoami'), calls.join('\n'));
  });

  it('refuses a custom tag Docker would not accept before any gate runs', () => {
    const { status, output, calls } = run(['not/a:tag']);

    assert.notEqual(status, 0, output);
    assert.match(output, /not a valid tag/);
    assert.deepEqual(phases(calls), ['preflight']);
  });
});

describe('release.sh failures after the gates', () => {
  it('builds nothing when the npm publish fails', () => {
    const { status, output, calls } = run([], { publishFails: true });

    assert.notEqual(status, 0, output);
    assert.deepEqual(builds(calls), []);
    assert.ok(!output.includes(RECOVERY), output);
  });

  it('says npm published and gives the command to finish when the Docker step fails', () => {
    const { status, output, calls } = run(['beta'], { buildFails: true });

    assert.notEqual(status, 0, output);
    assert.equal(publishes(calls).length, 1, calls.join('\n'));
    assert.match(output, /@geekity\/cms@9\.8\.7 was published to npm/);
    assert.ok(output.includes(`${RECOVERY} beta`), output);
  });

  it('leaves the tag out of the command to finish when none was given', () => {
    const { status, output } = run([], { buildFails: true });

    assert.notEqual(status, 0, output);
    assert.match(output, new RegExp(`${RECOVERY}\\n`));
  });
});

describe('release.sh --dry-run', () => {
  it('prints the whole plan, with both halves and the custom tag, and runs nothing', () => {
    const { status, output, calls } = run(['--dry-run', 'beta']);

    assert.equal(status, 0, output);
    assert.deepEqual(calls, []);
    assert.match(output, new RegExp(GATES.join(' ')));
    assert.match(output, /@geekity\/cms/);
    assert.match(output, /v9\.8\.7/);
    assert.match(output, /ghcr\.io\/geekitycom\/cms:beta/);
    assert.match(output, /npm-publish\.sh --skip-gates/);
    assert.match(output, /docker-build-push\.sh --skip-gates beta/);
  });
});

describe('release.sh arguments', () => {
  it('refuses to run from anywhere but the repository root', () => {
    const { status, output, calls } = run(['--dry-run'], { subdir: 'apps/demo' });

    assert.notEqual(status, 0, output);
    assert.match(output, /repository root/);
    assert.deepEqual(calls, []);
  });

  it('rejects an unknown option', () => {
    const { status, output, calls } = run(['--skip-gates']);

    assert.notEqual(status, 0, output);
    assert.match(output, /unknown option: --skip-gates/);
    assert.deepEqual(calls, []);
  });

  it('rejects a second custom tag', () => {
    const { status, output, calls } = run(['beta', 'gamma']);

    assert.notEqual(status, 0, output);
    assert.match(output, /only one custom tag/);
    assert.deepEqual(calls, []);
  });
});
