/**
 * `scripts/docker-build-push.sh`, the one way an image of this package reaches
 * ghcr.io.
 *
 * The script lives at the repository root, but this is the test glob CI runs,
 * and the image it publishes is this package's. It is driven through its
 * command line only: arguments, working directory, exit status and output.
 * `docker` and `pnpm` are the two things it talks to, so each test puts stub
 * executables for them first on PATH. The stubs append every call to a log and
 * fail when told to, which is how a test sees what would have been built and
 * pushed without building or pushing anything. The script runs from a copy in
 * a throwaway fixture repository, so the version it reads is one the test
 * chose, not whatever release-please last wrote.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { PACKAGE_ROOT } from './__testing__/cli.ts';

const SCRIPT = path.join(PACKAGE_ROOT, '..', '..', 'scripts', 'docker-build-push.sh');
const IMAGE = 'ghcr.io/geekitycom/cms';
const GATES = ['lint', 'format:check', 'typecheck', 'test'];

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Everything a stub reads to decide how to behave. */
interface Options {
  /** The `pnpm` script that should fail, if any. */
  failGate?: string;
  /** `docker info` fails, as it does when the daemon is down. */
  dockerDown?: boolean;
  /** Write a docker config that lists ghcr.io. Defaults to true. */
  loggedIn?: boolean;
  /** Run from this path inside the fixture repository. */
  subdir?: string;
}

interface Run {
  status: number | null;
  output: string;
  /** Every stub call, one per line: `docker buildx build ...`, `pnpm lint`. */
  calls: string[];
}

/** A stub executable that logs its name and arguments to `$STUB_LOG`. */
const STUB = `#!/bin/sh
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0") $1" in
  "pnpm $STUB_FAIL_GATE") exit 1 ;;
  "docker info") [ -z "$STUB_DOCKER_DOWN" ] || exit 1 ;;
  "docker login") exit 1 ;;
esac
exit 0
`;

/**
 * Make a fixture repository with `version` in `packages/cms/package.json` and
 * a different version in the root `package.json`, copy the script into it, and
 * run it with `args`.
 */
function run(args: string[], version = '9.8.7', options: Options = {}): Run {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'geekity-docker-push-'));
  scratch.push(repo);

  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'docker-build-push.sh'));
  fs.writeFileSync(path.join(repo, 'Dockerfile'), 'FROM scratch\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{ "version": "0.0.0" }\n');
  fs.mkdirSync(path.join(repo, 'packages', 'cms'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'packages', 'cms', 'package.json'),
    JSON.stringify({ name: '@geekity/cms', version }),
  );
  fs.mkdirSync(path.join(repo, 'apps', 'demo'), { recursive: true });

  const bin = path.join(repo, '.stub-bin');
  fs.mkdirSync(bin);
  for (const name of ['docker', 'pnpm']) {
    fs.writeFileSync(path.join(bin, name), STUB, { mode: 0o755 });
  }

  const home = path.join(repo, '.stub-home');
  fs.mkdirSync(path.join(home, '.docker'), { recursive: true });
  if (options.loggedIn !== false) {
    fs.writeFileSync(
      path.join(home, '.docker', 'config.json'),
      JSON.stringify({ auths: { 'ghcr.io': {} } }),
    );
  }

  const log = path.join(repo, '.stub-log');
  fs.writeFileSync(log, '');

  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: home,
    STUB_LOG: log,
    STUB_FAIL_GATE: options.failGate ?? '',
    STUB_DOCKER_DOWN: options.dockerDown === true ? '1' : '',
  };

  const result = spawnSync('bash', [path.join(repo, 'scripts', 'docker-build-push.sh'), ...args], {
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

const builds = (calls: string[]): string[] =>
  calls.filter((c) => c.startsWith('docker buildx build'));
const gatesRun = (calls: string[]): string[] =>
  calls.filter((c) => c.startsWith('pnpm ')).map((c) => c.slice('pnpm '.length));

describe('docker-build-push.sh --dry-run', () => {
  it('prints the image with the version, latest and custom tags and builds nothing', () => {
    const { status, output, calls } = run(['--dry-run', 'beta']);

    assert.equal(status, 0, output);
    assert.match(output, /ghcr\.io\/geekitycom\/cms:9\.8\.7/);
    assert.match(output, /ghcr\.io\/geekitycom\/cms:latest/);
    assert.match(output, /ghcr\.io\/geekitycom\/cms:beta/);
    assert.match(output, /linux\/amd64,linux\/arm64/);
    assert.deepEqual(builds(calls), []);
    assert.deepEqual(gatesRun(calls), []);
    assert.ok(!calls.some((c) => c.startsWith('docker login')), calls.join('\n'));
  });
});

describe('docker-build-push.sh version', () => {
  it('tags with the version in packages/cms/package.json, not the workspace root', () => {
    const { status, output } = run(['--dry-run'], '1.2.3');

    assert.equal(status, 0, output);
    assert.match(output, /ghcr\.io\/geekitycom\/cms:1\.2\.3/);
    assert.doesNotMatch(output, /cms:0\.0\.0/);
  });
});

describe('docker-build-push.sh quality gates', () => {
  for (const [index, gate] of GATES.entries()) {
    it(`stops before any build when ${gate} fails`, () => {
      const { status, output, calls } = run([], '9.8.7', { failGate: gate });

      assert.notEqual(status, 0, output);
      assert.deepEqual(gatesRun(calls), GATES.slice(0, index + 1));
      assert.deepEqual(builds(calls), []);
      assert.match(output, new RegExp(gate));
    });
  }
});

describe('docker-build-push.sh real run', () => {
  it('runs every gate, then builds both platforms and pushes the version, latest and custom tags', () => {
    const { status, output, calls } = run(['beta'], '9.8.7');

    assert.equal(status, 0, output);
    assert.deepEqual(gatesRun(calls), GATES);
    const [build, ...more] = builds(calls);
    assert.deepEqual(more, []);
    assert.ok(build !== undefined, calls.join('\n'));
    assert.ok(calls.indexOf(build) > calls.lastIndexOf('pnpm test'), calls.join('\n'));
    assert.match(build, /--platform linux\/amd64,linux\/arm64 /);
    assert.match(build, /--tag ghcr\.io\/geekitycom\/cms:9\.8\.7 /);
    assert.match(build, /--tag ghcr\.io\/geekitycom\/cms:latest /);
    assert.match(build, /--tag ghcr\.io\/geekitycom\/cms:beta /);
    assert.match(build, / --push \.$/);
    assert.match(output, /docker buildx imagetools inspect ghcr\.io\/geekitycom\/cms:9\.8\.7/);
  });

  it('pushes only the version and latest when no custom tag is given', () => {
    const { status, output, calls } = run([], '9.8.7');

    assert.equal(status, 0, output);
    const tags = [...(builds(calls)[0] ?? '').matchAll(/--tag (\S+)/g)].map((m) => m[1]);
    assert.deepEqual(tags, [`${IMAGE}:9.8.7`, `${IMAGE}:latest`]);
  });
});

describe('docker-build-push.sh refusals', () => {
  it('refuses to run from anywhere but the repository root', () => {
    const { status, output, calls } = run(['--dry-run'], '9.8.7', { subdir: 'apps/demo' });

    assert.notEqual(status, 0, output);
    assert.match(output, /repository root/);
    assert.deepEqual(calls, []);
  });

  it('stops when Docker is not running', () => {
    const { status, output, calls } = run([], '9.8.7', { dockerDown: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /Docker is not running/);
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(builds(calls), []);
  });

  it('tries docker login when ghcr.io is not in the docker config, and stops if it fails', () => {
    const { status, output, calls } = run([], '9.8.7', { loggedIn: false });

    assert.notEqual(status, 0, output);
    assert.ok(calls.includes('docker login ghcr.io'), calls.join('\n'));
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(builds(calls), []);
  });

  it('rejects a custom tag Docker would not accept', () => {
    const { status, output, calls } = run(['--dry-run', 'not/a:tag']);

    assert.notEqual(status, 0, output);
    assert.match(output, /not a valid tag/);
    assert.deepEqual(calls, []);
  });

  it('rejects an unknown option', () => {
    const { status, output } = run(['--push-only']);

    assert.notEqual(status, 0, output);
    assert.match(output, /unknown option: --push-only/);
  });
});
