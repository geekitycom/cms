import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  IMAGE,
  planRelease,
  readWorkspace,
  releaseOrder,
  tarballProblems,
  type TagState,
  type WorkspacePackage,
} from '../../../scripts/release.ts';
import { PACKAGE_ROOT } from './__testing__/cli.ts';

const SCRIPTS = path.join(PACKAGE_ROOT, '..', '..', 'scripts');
const GATES = ['lint', 'format:check', 'typecheck', 'test', 'test:11ty'];

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const CORE = '@geekity/cms';
const A = '@geekity/plugin-a';
const B = '@geekity/plugin-b';

const CONFIG_DEPENDENT_LISTED_FIRST = {
  'release-type': 'node',
  'include-component-in-tag': false,
  packages: {
    'packages/cms': { 'package-name': '' },
    'packages/plugin-b': { component: 'plugin-b', 'include-component-in-tag': true },
    'packages/plugin-a': { component: 'plugin-a', 'include-component-in-tag': true },
  },
};

function plugin(name: string, version: string, requires: Record<string, string> = {}) {
  return {
    name,
    version,
    publishConfig: { access: 'public' },
    geekity: { plugin: true, hostApi: 1, requires },
    peerDependencies: { [CORE]: 'workspace:^', ...requires },
    devDependencies: { [CORE]: 'workspace:*' },
  };
}

interface Versions {
  cms: string;
  a: string;
  b: string;
}

const RELEASED: Versions = { cms: '1.0.0', a: '0.1.0', b: '0.1.0' };

function writeWorkspace(repo: string, versions: Versions): void {
  writeJson(path.join(repo, 'package.json'), { name: 'workspace', private: true, type: 'module' });
  writeJson(path.join(repo, 'release-please-config.json'), CONFIG_DEPENDENT_LISTED_FIRST);
  writeJson(path.join(repo, 'packages', 'cms', 'package.json'), {
    name: CORE,
    version: versions.cms,
    publishConfig: { access: 'public' },
  });
  for (const [dir, manifest] of [
    ['plugin-a', plugin(A, versions.a)],
    ['plugin-b', plugin(B, versions.b, { [A]: `>=${versions.a} <1.0.0` })],
  ] as const) {
    writeJson(path.join(repo, 'packages', dir, 'package.json'), manifest);
    writeJson(path.join(repo, 'packages', dir, 'dist', 'bundle', 'plugin.json'), {
      name: manifest.name,
      version: manifest.version,
      peerDependencies: manifest.peerDependencies,
    });
    fs.writeFileSync(
      path.join(repo, 'packages', dir, 'dist', 'bundle', 'index.js'),
      'export default {};\n',
    );
  }
}

describe('readWorkspace', () => {
  it('reads each package, its tag and the workspace packages it depends on', () => {
    const repo = temp('geekity-workspace-');
    writeWorkspace(repo, { cms: '1.2.0', a: '0.3.0', b: '0.4.0' });

    const packages = readWorkspace(repo);

    assert.deepEqual(
      packages.map((p) => [p.dir, p.name, p.version, p.tag, p.plugin, p.dependsOn]),
      [
        ['packages/cms', CORE, '1.2.0', 'v1.2.0', false, []],
        ['packages/plugin-b', B, '0.4.0', 'plugin-b-v0.4.0', true, [CORE, A]],
        ['packages/plugin-a', A, '0.3.0', 'plugin-a-v0.3.0', true, [CORE]],
      ],
    );
  });

  it('reads core and every plugin package of this repository', () => {
    const root = path.join(PACKAGE_ROOT, '..', '..');
    const plugins = fs
      .readdirSync(path.join(root, 'packages'))
      .filter((dir) => dir.startsWith('plugin-'))
      .map((dir) => `@geekity/${dir}`);

    const names = readWorkspace(root).map((p) => p.name);

    assert.equal(plugins.length, 4);
    assert.deepEqual(new Set(names), new Set([CORE, ...plugins]));
  });

  it('marks every package of this repository public', () => {
    for (const { dir } of readWorkspace(path.join(PACKAGE_ROOT, '..', '..'))) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(PACKAGE_ROOT, '..', '..', dir, 'package.json'), 'utf8'),
      );
      assert.deepEqual(manifest.publishConfig, { access: 'public' }, dir);
    }
  });
});

function pkg(name: string, dependsOn: string[] = [], version = '1.0.0'): WorkspacePackage {
  const short = name.replace('@geekity/', '');
  return {
    dir: `packages/${short}`,
    name,
    version,
    tag: name === CORE ? `v${version}` : `${short}-v${version}`,
    plugin: name !== CORE,
    dependsOn,
  };
}

describe('releaseOrder', () => {
  it('puts every package after the packages it depends on, and keeps the given order otherwise', () => {
    const order = releaseOrder([
      pkg('@geekity/plugin-post-summary', [CORE, '@geekity/plugin-llm']),
      pkg('@geekity/plugin-other', [CORE]),
      pkg('@geekity/plugin-llm', [CORE]),
      pkg(CORE),
    ]);

    assert.deepEqual(
      order.map((p) => p.name),
      [CORE, '@geekity/plugin-llm', '@geekity/plugin-post-summary', '@geekity/plugin-other'],
    );
  });

  it('orders this repository core first and plugin-llm before the plugins that require it', () => {
    const order = releaseOrder(readWorkspace(path.join(PACKAGE_ROOT, '..', '..'))).map(
      (p) => p.name,
    );

    assert.equal(order[0], CORE);
    for (const dependent of ['@geekity/plugin-post-summary', '@geekity/plugin-tag-suggest']) {
      assert.ok(order.indexOf('@geekity/plugin-llm') < order.indexOf(dependent), order.join());
    }
  });

  it('refuses a dependency cycle and names it', () => {
    assert.throws(
      () => releaseOrder([pkg(A, [B]), pkg(B, [A])]),
      /cycle: @geekity\/plugin-a → @geekity\/plugin-b → @geekity\/plugin-a/,
    );
  });
});

describe('planRelease', () => {
  const core = pkg(CORE, [], '2.0.0');
  const a = pkg(A, [CORE], '0.2.0');
  const b = pkg(B, [CORE, A], '0.3.0');
  const all = [core, b, a];
  const released = (...names: string[]): Map<string, TagState> =>
    new Map(names.map((name) => [name, 'released']));

  it('publishes only the versions npm does not have, dependencies first', () => {
    const plan = planRelease(all, {
      published: new Set([CORE]),
      tags: released(A, B),
      imageExists: true,
    });

    assert.deepEqual(plan.refusals, []);
    assert.deepEqual(
      plan.publish.map((p) => p.name),
      [A, B],
    );
    assert.deepEqual(
      plan.alreadyPublished.map((p) => p.name),
      [CORE],
    );
    assert.equal(plan.image.push, false);
  });

  it('pushes the image when core has a version with no image', () => {
    const plan = planRelease(all, {
      published: new Set([A, B]),
      tags: released(CORE),
      imageExists: false,
    });

    assert.deepEqual(
      plan.publish.map((p) => p.name),
      [CORE],
    );
    assert.deepEqual(plan.image, { push: true, ref: `${IMAGE}:2.0.0` });
  });

  it('pushes the image even when core is already on npm, to finish a release', () => {
    const plan = planRelease(all, {
      published: new Set([CORE, A, B]),
      tags: released(CORE),
      imageExists: false,
    });

    assert.deepEqual(plan.publish, []);
    assert.equal(plan.image.push, true);
  });

  it('has nothing to do when every version is on npm and the image exists', () => {
    const plan = planRelease(all, {
      published: new Set([CORE, A, B]),
      tags: new Map(),
      imageExists: true,
    });

    assert.deepEqual(plan.publish, []);
    assert.equal(plan.image.push, false);
    assert.deepEqual(plan.refusals, []);
  });

  for (const [state, message] of [
    ['missing', /tag plugin-a-v0\.2\.0 does not exist/],
    ['not-in-history', /tag plugin-a-v0\.2\.0 is not in the history of HEAD/],
    ['changed', /packages\/plugin-a has changed since plugin-a-v0\.2\.0/],
  ] as const) {
    it(`refuses a version to publish whose tag is ${state}`, () => {
      const plan = planRelease(all, {
        published: new Set([CORE, B]),
        tags: new Map([[A, state]]),
        imageExists: true,
      });

      assert.equal(plan.refusals.length, 1, plan.refusals.join('\n'));
      assert.match(plan.refusals[0] ?? '', message);
    });
  }

  it('refuses an image from a core whose tag is not released, once', () => {
    const plan = planRelease(all, {
      published: new Set([A, B]),
      tags: new Map([[CORE, 'missing']]),
      imageExists: false,
    });

    assert.equal(plan.refusals.length, 1, plan.refusals.join('\n'));
    assert.match(plan.refusals[0] ?? '', /tag v2\.0\.0 does not exist/);
  });

  it('does not check the tag of a version already on npm', () => {
    const plan = planRelease(all, {
      published: new Set([CORE, A, B]),
      tags: new Map([[A, 'changed']]),
      imageExists: true,
    });

    assert.deepEqual(plan.refusals, []);
  });
});

describe('tarballProblems', () => {
  function unpacked(files: Record<string, unknown>): string {
    const dir = temp('geekity-tarball-');
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
    }
    return dir;
  }
  const a = pkg(A, [CORE], '0.2.0');
  const manifest = { name: A, version: '0.2.0' };

  it('accepts a plugin with its bundle and a matching plugin.json', () => {
    const dir = unpacked({
      'package.json': manifest,
      'dist/bundle/index.js': 'export default {};',
      'dist/bundle/plugin.json': manifest,
    });

    assert.deepEqual(tarballProblems(a, dir), []);
  });

  it('names a plugin tarball with no bundle', () => {
    const dir = unpacked({ 'package.json': manifest });

    assert.deepEqual(tarballProblems(a, dir), [
      'it has no dist/bundle/index.js',
      'it has no dist/bundle/plugin.json',
    ]);
  });

  it('names a plugin.json for another version', () => {
    const dir = unpacked({
      'package.json': manifest,
      'dist/bundle/index.js': 'export default {};',
      'dist/bundle/plugin.json': { name: A, version: '0.1.0' },
    });

    assert.deepEqual(tarballProblems(a, dir), [
      'dist/bundle/plugin.json is @geekity/plugin-a@0.1.0',
    ]);
  });

  it('names a plugin.json whose peer ranges differ from the packed package.json', () => {
    const dir = unpacked({
      'package.json': { ...manifest, peerDependencies: { [CORE]: '^0.26.0' } },
      'dist/bundle/index.js': 'export default {};',
      'dist/bundle/plugin.json': { ...manifest, peerDependencies: { [CORE]: '>=0.26.0 <1.0.0' } },
    });

    assert.deepEqual(tarballProblems(a, dir), [
      'dist/bundle/plugin.json has peer ranges {"@geekity/cms":">=0.26.0 <1.0.0"}, and package.json has {"@geekity/cms":"^0.26.0"}',
    ]);
  });

  it('names a package.json for another version, and asks core for no bundle', () => {
    const dir = unpacked({ 'package.json': { name: CORE, version: '1.9.0' } });

    assert.deepEqual(tarballProblems(pkg(CORE, [], '2.0.0'), dir), [
      'package.json is @geekity/cms@1.9.0',
    ]);
  });
});

/** Everything a stub reads to decide how to behave. */
interface Options {
  published?: string[];
  images?: string[];
  failGate?: string;
  failPublish?: string;
  loggedOut?: boolean;
  /** `docker buildx build` fails. */
  buildFails?: boolean;
}

interface Run {
  status: number | null;
  output: string;
  /** Every stub call, one per line: `npm whoami`, `pnpm lint`. */
  calls: string[];
}

const STUB = `#!/bin/sh
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0") $1" in
  "npm whoami") [ -z "$STUB_LOGGED_OUT" ] || exit 1; echo a-maintainer ;;
  "npm view")
    for found in $STUB_PUBLISHED; do
      if [ "$found" = "$2" ]; then echo "\${2##*@}"; exit 0; fi
    done
    echo "npm error code E404" >&2; exit 1 ;;
  "npm publish")
    [ -z "$STUB_FAIL_PUBLISH" ] || case "$2" in *"$STUB_FAIL_PUBLISH"*) exit 1 ;; esac ;;
  "pnpm --dir")
    work=$(mktemp -d)
    cp -R "$2" "$work/package"
    tar -czf "$5/$(basename "$2").tgz" -C "$work" package ;;
  "pnpm $STUB_FAIL_GATE") exit 1 ;;
  "docker manifest")
    for found in $STUB_IMAGES; do
      if [ "$found" = "$3" ]; then echo '{}'; exit 0; fi
    done
    echo "manifest unknown" >&2; exit 1 ;;
  "docker login") exit 1 ;;
  "docker buildx") [ "$2" != build ] || [ -z "$STUB_BUILD_FAILS" ] || exit 1 ;;
esac
exit 0
`;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Release Test',
  GIT_AUTHOR_EMAIL: 'release@example.test',
  GIT_COMMITTER_NAME: 'Release Test',
  GIT_COMMITTER_EMAIL: 'release@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(repo: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function tagsOf(versions: Versions): string[] {
  return [`v${versions.cms}`, `plugin-a-v${versions.a}`, `plugin-b-v${versions.b}`];
}

function repository(versions: Versions = RELEASED, tags = tagsOf(versions)): string {
  const repo = temp('geekity-release-');
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(path.join(SCRIPTS, 'release.ts'), path.join(repo, 'scripts', 'release.ts'));
  fs.copyFileSync(
    path.join(SCRIPTS, 'docker-build-push.sh'),
    path.join(repo, 'scripts', 'docker-build-push.sh'),
  );
  fs.writeFileSync(path.join(repo, 'Dockerfile'), 'FROM scratch\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.stub-*\n');
  writeWorkspace(repo, versions);

  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'chore(release): release main');
  for (const tag of tags) git(repo, 'tag', tag);

  const origin = temp('geekity-origin-');
  git(origin, 'init', '-q', '--bare');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');

  const bin = path.join(repo, '.stub-bin');
  fs.mkdirSync(bin);
  for (const name of ['npm', 'pnpm', 'docker']) {
    fs.writeFileSync(path.join(bin, name), STUB, { mode: 0o755 });
  }
  const home = path.join(repo, '.stub-home');
  writeJson(path.join(home, '.docker', 'config.json'), { auths: { 'ghcr.io': {} } });
  return repo;
}

function allReleased(versions: Versions = RELEASED): Options {
  return {
    published: [`${CORE}@${versions.cms}`, `${A}@${versions.a}`, `${B}@${versions.b}`],
    images: [`${IMAGE}:${versions.cms}`],
  };
}

function release(repo: string, args: string[] = [], options: Options = {}): Run {
  const log = path.join(repo, '.stub-log');
  fs.writeFileSync(log, '');
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.ts'), ...args], {
    cwd: repo,
    env: {
      ...GIT_ENV,
      PATH: `${path.join(repo, '.stub-bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      HOME: path.join(repo, '.stub-home'),
      STUB_LOG: log,
      STUB_PUBLISHED: (options.published ?? []).join(' '),
      STUB_IMAGES: (options.images ?? []).join(' '),
      STUB_FAIL_GATE: options.failGate ?? '',
      STUB_FAIL_PUBLISH: options.failPublish ?? '',
      STUB_LOGGED_OUT: options.loggedOut === true ? '1' : '',
      STUB_BUILD_FAILS: options.buildFails === true ? '1' : '',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

const gatesRun = (calls: string[]): string[] =>
  calls.filter((c) => /^pnpm [\w:]+$/.test(c)).map((c) => c.slice('pnpm '.length));
const publishes = (calls: string[]): string[] =>
  calls.filter((c) => c.startsWith('npm publish')).map((c) => /\/([\w-]+)\.tgz/.exec(c)?.[1] ?? c);
const builds = (calls: string[]): string[] =>
  calls.filter((c) => c.startsWith('docker buildx build'));
const index = (calls: string[], prefix: string): number =>
  calls.findIndex((c) => c.startsWith(prefix));

const BUMPED: Versions = { cms: '1.1.0', a: '0.2.0', b: '0.2.0' };

describe('release.ts with nothing to release', () => {
  it('says so and exits 0, with no gate, no publish and no image', () => {
    const repo = repository();
    const { status, output, calls } = release(repo, [], allReleased());

    assert.equal(status, 0, output);
    assert.match(output, /Nothing to release/);
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
    assert.deepEqual(builds(calls), []);
    assert.ok(!calls.includes('npm whoami'), calls.join('\n'));
  });
});

describe('release.ts real run', () => {
  it('checks everything, runs each gate once, publishes dependencies first, then pushes the image', () => {
    const repo = repository(BUMPED);
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.equal(status, 0, output);
    assert.deepEqual(gatesRun(calls), GATES);
    assert.deepEqual(publishes(calls), ['cms', 'plugin-a', 'plugin-b']);
    assert.ok(calls.every((c) => !c.startsWith('npm publish') || c.includes('--access public')));
    assert.equal(builds(calls).length, 1, calls.join('\n'));
    assert.ok(index(calls, 'npm whoami') < index(calls, 'pnpm lint'), calls.join('\n'));
    assert.ok(index(calls, 'docker info') < index(calls, 'pnpm lint'), calls.join('\n'));
    const packs = calls.flatMap((c, i) => (c.startsWith('pnpm --dir') ? [i] : []));
    const uploads = calls.flatMap((c, i) => (c.startsWith('npm publish') ? [i] : []));
    assert.equal(packs.length, 3, calls.join('\n'));
    assert.ok(index(calls, 'pnpm test:11ty') < Math.min(...packs), 'packs after the gates');
    assert.ok(Math.max(...packs) < Math.min(...uploads), 'checks every tarball before publishing');
    assert.ok(Math.max(...uploads) < index(calls, 'docker buildx build'), 'image after npm');
    const tags = [...(builds(calls)[0] ?? '').matchAll(/--tag (\S+)/g)].map((m) => m[1]);
    assert.deepEqual(tags, [`${IMAGE}:1.1.0`, `${IMAGE}:latest`]);
  });

  it('pushes no image and asks nothing of Docker for a release of plugins alone', () => {
    const versions = { ...RELEASED, a: '0.2.0' };
    const repo = repository(versions);
    const { status, output, calls } = release(repo, [], {
      published: [`${CORE}@1.0.0`, `${B}@0.1.0`],
      images: [`${IMAGE}:1.0.0`],
    });

    assert.equal(status, 0, output);
    assert.deepEqual(publishes(calls), ['plugin-a']);
    assert.ok(
      calls.every((c) => !c.startsWith('docker') || c.startsWith('docker manifest')),
      calls.join('\n'),
    );
  });

  it('pushes only the image when every version is on npm but the image is missing', () => {
    const repo = repository();
    const { status, output, calls } = release(repo, [], { ...allReleased(), images: [] });

    assert.equal(status, 0, output);
    assert.deepEqual(publishes(calls), []);
    assert.deepEqual(gatesRun(calls), GATES);
    assert.equal(builds(calls).length, 1, calls.join('\n'));
  });

  it('passes a custom tag through to the image', () => {
    const repo = repository(BUMPED);
    const { status, output, calls } = release(repo, ['beta'], { images: [] });

    assert.equal(status, 0, output);
    assert.match(builds(calls)[0] ?? '', /--tag ghcr\.io\/geekitycom\/cms:beta/);
  });

  it('refuses a custom tag when there is no image to push', () => {
    const versions = { ...RELEASED, a: '0.2.0' };
    const repo = repository(versions);
    const { status, output, calls } = release(repo, ['beta'], {
      published: [`${CORE}@1.0.0`, `${B}@0.1.0`],
      images: [`${IMAGE}:1.0.0`],
    });

    assert.notEqual(status, 0, output);
    assert.match(output, /no image to push/);
    assert.deepEqual(gatesRun(calls), []);
  });
});

describe('release.ts refusals before the gates', () => {
  it('refuses a version whose release tag does not exist', () => {
    const repo = repository(BUMPED, [`v${BUMPED.cms}`, `plugin-b-v${BUMPED.b}`]);
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /tag plugin-a-v0\.2\.0 does not exist/);
    assert.deepEqual(gatesRun(calls), []);
    assert.deepEqual(publishes(calls), []);
  });

  it('refuses a tag that is not in the history of HEAD', () => {
    const repo = repository(BUMPED, [`v${BUMPED.cms}`, `plugin-b-v${BUMPED.b}`]);
    git(repo, 'checkout', '-q', '-b', 'elsewhere');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: elsewhere');
    git(repo, 'tag', 'plugin-a-v0.2.0');
    git(repo, 'checkout', '-q', 'main');
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /tag plugin-a-v0\.2\.0 is not in the history of HEAD/);
    assert.deepEqual(gatesRun(calls), []);
  });

  it('refuses a package that changed after its tag, and names it', () => {
    const repo = repository(BUMPED);
    fs.writeFileSync(path.join(repo, 'packages', 'plugin-a', 'later.txt'), 'later\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'feat(plugin-a): later');
    git(repo, 'push', '-q');
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /packages\/plugin-a has changed since plugin-a-v0\.2\.0/);
    assert.doesNotMatch(output, /packages\/cms has changed/);
    assert.deepEqual(gatesRun(calls), []);
  });

  it('refuses a dirty working tree', () => {
    const repo = repository(BUMPED);
    fs.writeFileSync(path.join(repo, 'stray.txt'), 'stray\n');
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /working tree is not clean/);
    assert.deepEqual(gatesRun(calls), []);
  });

  it('refuses a branch other than main', () => {
    const repo = repository(BUMPED);
    git(repo, 'checkout', '-q', '-b', 'topic');
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /on topic, not main/);
    assert.deepEqual(gatesRun(calls), []);
  });

  it('refuses a main that is not level with origin', () => {
    const repo = repository(BUMPED);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: local only');
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /not level with origin\/main/);
    assert.deepEqual(gatesRun(calls), []);
  });

  it('refuses when nobody is logged in to npm', () => {
    const repo = repository(BUMPED);
    const { status, output, calls } = release(repo, [], { images: [], loggedOut: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /npm login/);
    assert.deepEqual(gatesRun(calls), []);
  });
});

describe('release.ts failures after the preflight', () => {
  for (const [position, gate] of GATES.entries()) {
    it(`publishes nothing and builds nothing when ${gate} fails`, () => {
      const repo = repository(BUMPED);
      const { status, output, calls } = release(repo, [], { images: [], failGate: gate });

      assert.notEqual(status, 0, output);
      assert.deepEqual(gatesRun(calls), GATES.slice(0, position + 1));
      assert.deepEqual(publishes(calls), []);
      assert.deepEqual(builds(calls), []);
    });
  }

  it('publishes nothing, core included, when a plugin tarball has no bundle', () => {
    const repo = repository(BUMPED);
    fs.rmSync(path.join(repo, 'packages', 'plugin-b', 'dist'), { recursive: true });
    git(repo, 'commit', '-q', '-am', 'chore: lose the bundle');
    git(repo, 'tag', '-f', 'plugin-b-v0.2.0');
    git(repo, 'push', '-q');
    const { status, output, calls } = release(repo, [], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /@geekity\/plugin-b@0\.2\.0: it has no dist\/bundle\/index\.js/);
    assert.deepEqual(publishes(calls), []);
    assert.deepEqual(builds(calls), []);
  });

  it('stops at a failed publish, says what reached npm, and builds no image', () => {
    const repo = repository(BUMPED);
    const { status, output, calls } = release(repo, [], { images: [], failPublish: 'plugin-a' });

    assert.notEqual(status, 0, output);
    assert.deepEqual(publishes(calls), ['cms', 'plugin-a']);
    assert.match(output, /Published @geekity\/cms@1\.1\.0/);
    assert.match(output, /pnpm release/);
    assert.deepEqual(builds(calls), []);
  });

  it('says npm has the release and how to finish when the image fails', () => {
    const repo = repository(BUMPED);
    const { status, output } = release(repo, ['beta'], { images: [], buildFails: true });

    assert.notEqual(status, 0, output);
    assert.match(output, /pnpm docker:build-push -- --skip-gates beta/);
  });
});

describe('release.ts --dry-run', () => {
  it('lists each package and the image with the reason, and checks and runs nothing', () => {
    const repo = repository({ ...BUMPED, b: '0.1.0' });
    const { status, output, calls } = release(repo, ['--dry-run'], {
      published: [`${B}@0.1.0`],
      images: [],
    });

    assert.equal(status, 0, output);
    assert.match(output, /@geekity\/cms@1\.1\.0 +not on npm; tag v1\.1\.0/);
    assert.match(output, /@geekity\/plugin-a@0\.2\.0 +not on npm; tag plugin-a-v0\.2\.0/);
    assert.match(output, /@geekity\/plugin-b@0\.1\.0 +already on npm/);
    assert.match(output, /ghcr\.io\/geekitycom\/cms:1\.1\.0 +push: no image for 1\.1\.0 yet/);
    assert.match(output, new RegExp(GATES.join(' ')));
    assert.ok(output.indexOf('@geekity/cms@1.1.0') < output.indexOf('@geekity/plugin-a@0.2.0'));
    assert.deepEqual(
      calls.filter((c) => !c.startsWith('npm view') && !c.startsWith('docker manifest')),
      [],
    );
  });

  it('shows a refusal and exits non-zero', () => {
    const repo = repository(BUMPED, [`v${BUMPED.cms}`]);
    const { status, output } = release(repo, ['--dry-run'], { images: [] });

    assert.notEqual(status, 0, output);
    assert.match(output, /tag plugin-a-v0\.2\.0 does not exist/);
  });

  it('runs every gate the image script runs on its own', () => {
    const repo = repository();
    const docker = spawnSync(
      'bash',
      [path.join(repo, 'scripts', 'docker-build-push.sh'), '--dry-run'],
      {
        cwd: repo,
        encoding: 'utf8',
      },
    );
    const dockerGates = /Would run the quality gates: (.+)/.exec(docker.stdout)?.[1]?.split(' ');
    const image = /Image: +(\S+)/.exec(docker.stdout)?.[1];

    assert.ok(dockerGates !== undefined, docker.stdout + docker.stderr);
    for (const gate of dockerGates) assert.ok(GATES.includes(gate), gate);
    assert.equal(image, IMAGE);
  });
});

describe('release.ts arguments', () => {
  it('refuses to run from anywhere but the repository root', () => {
    const repo = repository();
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.ts')], {
      cwd: path.join(repo, 'packages'),
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repository root/);
  });

  it('rejects an unknown option and a second custom tag', () => {
    const repo = repository();

    assert.match(release(repo, ['--skip-gates']).output, /unknown option: --skip-gates/);
    assert.match(release(repo, ['beta', 'gamma']).output, /only one custom tag/);
  });
});
