/**
 * Release every package in release-please-config.json: publish each one whose
 * version is not on npm yet, then push the image of @geekity/cms when its
 * version has none.
 *
 * Nothing in CI publishes, on purpose: a release reaches npm when a maintainer
 * decides it should, and GitHub's runners are amd64 only, so they could build
 * only half of the image a site may need. The usual order is: merge the
 * release pull request, `git pull --prune --tags` on main, then run this.
 *
 * Whether a package needs releasing is read from the registries, not from the
 * commit, so running it again after a failure carries on where the last run
 * stopped. A version is published only from a checkout whose HEAD has the
 * version's release tag in its history and whose package folder is unchanged
 * since that tag, so what reaches npm is exactly what was released.
 *
 * Usage (from the repository root):
 *
 *   node scripts/release.ts [--dry-run] [CUSTOM_TAG]
 *   pnpm release [CUSTOM_TAG]
 *   pnpm release:dry-run
 *
 * CUSTOM_TAG is one more tag for the image. --dry-run prints the plan and the
 * steps, and checks no login and runs no gate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const IMAGE = 'ghcr.io/geekitycom/cms';
const CORE = '@geekity/cms';
const BRANCH = 'main';
const DOCKER_SCRIPT = 'scripts/docker-build-push.sh';
const GATES = ['lint', 'format:check', 'typecheck', 'test', 'test:11ty'];

export interface WorkspacePackage {
  /** The package folder, relative to the repository root. */
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  /** The tag release-please gives this version: `v1.2.0` or `plugin-llm-v0.2.0`. */
  readonly tag: string;
  readonly plugin: boolean;
  /** The other workspace packages it needs at run time, which publish first. */
  readonly dependsOn: readonly string[];
}

/**
 * Where a version's release tag stands relative to HEAD. Only `released` may
 * be published: the tag exists, HEAD descends from it, and the package folder
 * is the same at both.
 */
export type TagState = 'released' | 'missing' | 'not-in-history' | 'changed';

export interface Facts {
  /** Names of the packages whose current version npm already has. */
  readonly published: ReadonlySet<string>;
  readonly tags: ReadonlyMap<string, TagState>;
  /** The registry has an image for core's current version. */
  readonly imageExists: boolean;
}

export interface ReleasePlan {
  /** In the order to publish them: every package after what it depends on. */
  readonly publish: readonly WorkspacePackage[];
  readonly alreadyPublished: readonly WorkspacePackage[];
  readonly image: { readonly push: boolean; readonly ref: string };
  readonly refusals: readonly string[];
}

interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  geekity?: { plugin?: boolean; requires?: Record<string, string> };
}

interface PackageSettings {
  component?: string;
  'include-component-in-tag'?: boolean;
}

interface ReleasePleaseConfig {
  'include-component-in-tag'?: boolean;
  packages: Record<string, PackageSettings>;
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The packages release-please versions, in the order its config lists them. */
export function readWorkspace(root: string): WorkspacePackage[] {
  const config = readJson(path.join(root, 'release-please-config.json')) as ReleasePleaseConfig;
  const entries = Object.entries(config.packages).map(([dir, settings]) => ({
    dir,
    settings,
    manifest: readJson(path.join(root, dir, 'package.json')) as Manifest,
  }));
  const names = new Set(entries.map((entry) => entry.manifest.name));

  return entries.map(({ dir, settings, manifest }) => {
    const withComponent =
      settings['include-component-in-tag'] ?? config['include-component-in-tag'] ?? true;
    if (withComponent && settings.component === undefined) {
      fail(`${dir} has no component in release-please-config.json to tag it with`);
    }
    const needs = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.geekity?.requires ?? {}),
    ];
    return {
      dir,
      name: manifest.name,
      version: manifest.version,
      tag: withComponent ? `${settings.component}-v${manifest.version}` : `v${manifest.version}`,
      plugin: manifest.geekity?.plugin === true,
      dependsOn: [...new Set(needs)].filter((name) => name !== manifest.name && names.has(name)),
    };
  });
}

/** Every package after the packages it depends on, and in the given order otherwise. */
export function releaseOrder(packages: readonly WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const ordered: WorkspacePackage[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];

  function visit(pkg: WorkspacePackage): void {
    if (done.has(pkg.name)) return;
    if (visiting.includes(pkg.name)) {
      const cycle = [...visiting.slice(visiting.indexOf(pkg.name)), pkg.name];
      fail(`the packages depend on each other in a cycle: ${cycle.join(' → ')}`);
    }
    visiting.push(pkg.name);
    for (const name of pkg.dependsOn) {
      const dependency = byName.get(name);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.pop();
    done.add(pkg.name);
    ordered.push(pkg);
  }

  for (const pkg of packages) visit(pkg);
  return ordered;
}

function refusal(pkg: WorkspacePackage, state: Exclude<TagState, 'released'>): string {
  const what = `${pkg.name}@${pkg.version}`;
  switch (state) {
    case 'missing':
      return `${what}: tag ${pkg.tag} does not exist. Run git pull --prune --tags; if release-please did not tag the release, tag it by hand as the README's Releasing section describes.`;
    case 'not-in-history':
      return `${what}: tag ${pkg.tag} is not in the history of HEAD. Pull main and try again.`;
    case 'changed':
      return `${what}: ${pkg.dir} has changed since ${pkg.tag}, so what would be published is not what was released. Merge the next release pull request and release that.`;
  }
}

/** What to publish and push, given what the registries and git say. */
export function planRelease(packages: readonly WorkspacePackage[], facts: Facts): ReleasePlan {
  const ordered = releaseOrder(packages);
  const core = ordered.find((p) => p.name === CORE);
  if (core === undefined) fail(`${CORE} is not in release-please-config.json`);

  const publish = ordered.filter((p) => !facts.published.has(p.name));
  const image = { push: !facts.imageExists, ref: `${IMAGE}:${core.version}` };
  const mustBeReleased = new Set(publish);
  if (image.push) mustBeReleased.add(core);

  const refusals: string[] = [];
  for (const pkg of ordered) {
    if (!mustBeReleased.has(pkg)) continue;
    const state = facts.tags.get(pkg.name) ?? 'missing';
    if (state !== 'released') refusals.push(refusal(pkg, state));
  }

  return {
    publish,
    alreadyPublished: ordered.filter((p) => facts.published.has(p.name)),
    image,
    refusals,
  };
}

/**
 * What is wrong with a packed tarball, unpacked into `dir`: a manifest for
 * another version, a plugin with no bundle for `geekity plugin add` to
 * install, or a plugin.json whose peer ranges are not the ones npm will see.
 */
export function tarballProblems(pkg: WorkspacePackage, dir: string): string[] {
  const problems: string[] = [];
  const mismatch = (file: string): void => {
    const found = readJson(path.join(dir, file)) as Partial<Manifest>;
    if (found.name !== pkg.name || found.version !== pkg.version) {
      problems.push(`${file} is ${String(found.name)}@${String(found.version)}`);
    }
  };

  mismatch('package.json');
  if (!pkg.plugin) return problems;
  for (const file of ['dist/bundle/index.js', 'dist/bundle/plugin.json']) {
    if (!fs.existsSync(path.join(dir, file))) problems.push(`it has no ${file}`);
  }
  if (!fs.existsSync(path.join(dir, 'dist/bundle/plugin.json'))) return problems;
  mismatch('dist/bundle/plugin.json');
  const packed = (readJson(path.join(dir, 'package.json')) as Partial<Manifest>).peerDependencies;
  const bundled = (readJson(path.join(dir, 'dist/bundle/plugin.json')) as Partial<Manifest>)
    .peerDependencies;
  if (!isDeepStrictEqual(packed, bundled)) {
    problems.push(
      `dist/bundle/plugin.json has peer ranges ${JSON.stringify(bundled)}, and package.json has ${JSON.stringify(packed)}`,
    );
  }
  return problems;
}

class ReleaseError extends Error {}

function fail(message: string): never {
  throw new ReleaseError(message);
}

function log(message: string): void {
  console.log(`\x1b[1m==> ${message}\x1b[0m`);
}

interface Captured {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function capture(command: string, args: readonly string[]): Captured {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error !== undefined) fail(`could not run ${command}: ${result.error.message}`);
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function step(command: string, args: readonly string[]): boolean {
  return spawnSync(command, args, { stdio: 'inherit' }).status === 0;
}

const git = (...args: string[]): Captured => capture('git', args);

function onNpm(pkg: WorkspacePackage): boolean {
  const found = capture('npm', ['view', `${pkg.name}@${pkg.version}`, 'version']);
  if (found.ok) return found.stdout !== '';
  if (/\bE404\b/.test(found.stderr)) return false;
  return fail(`could not ask npm about ${pkg.name}@${pkg.version}:\n${found.stderr}`);
}

function imageExists(ref: string): boolean {
  const found = capture('docker', ['manifest', 'inspect', ref]);
  if (found.ok) return true;
  if (/manifest unknown|no such manifest|not found/i.test(found.stderr)) return false;
  return fail(`could not ask the registry about ${ref}:\n${found.stderr}`);
}

function tagState(pkg: WorkspacePackage): TagState {
  if (!git('rev-parse', '--quiet', '--verify', `refs/tags/${pkg.tag}`).ok) return 'missing';
  if (!git('merge-base', '--is-ancestor', pkg.tag, 'HEAD').ok) return 'not-in-history';
  if (!git('diff', '--quiet', pkg.tag, 'HEAD', '--', pkg.dir).ok) return 'changed';
  return 'released';
}

function gatherFacts(packages: readonly WorkspacePackage[]): Facts {
  const core = packages.find((p) => p.name === CORE);
  return {
    published: new Set(packages.filter(onNpm).map((p) => p.name)),
    tags: new Map(packages.map((p) => [p.name, tagState(p)])),
    imageExists: core === undefined || imageExists(`${IMAGE}:${core.version}`),
  };
}

function printPlan(plan: ReleasePlan): void {
  const rows: [string, string][] = [
    ...plan.publish.map((p): [string, string] => [
      `${p.name}@${p.version}`,
      `not on npm; tag ${p.tag} is the release to publish`,
    ]),
    ...plan.alreadyPublished.map((p): [string, string] => [
      `${p.name}@${p.version}`,
      'already on npm',
    ]),
    [
      plan.image.ref,
      plan.image.push
        ? `push: no image for ${plan.image.ref.split(':').at(-1) ?? ''} yet`
        : 'skip: already in the registry',
    ],
  ];
  const width = Math.max(...rows.map(([what]) => what.length));
  for (const [what, why] of rows) console.log(`  ${what.padEnd(width)}  ${why}`);
}

function printSteps(plan: ReleasePlan, dockerArgs: readonly string[]): void {
  const tag = dockerArgs.length > 0 ? ` ${dockerArgs.join(' ')}` : '';
  log('Dry run: nothing was checked, built, published or pushed');
  console.log('A real run would, stopping at the first failure:');
  console.log(`  1. Check HEAD is ${BRANCH}, clean and level with its upstream, and npm whoami`);
  if (plan.image.push) console.log(`     ${DOCKER_SCRIPT} --check-only${tag}`);
  console.log(`  2. Run the quality gates once: ${GATES.join(' ')}`);
  console.log('  3. Pack each package and check each tarball');
  console.log(
    `  4. npm publish --access public, in order: ${plan.publish.map((p) => p.name).join(', ') || 'nothing'}`,
  );
  console.log(
    plan.image.push ? `  5. ${DOCKER_SCRIPT} --skip-gates${tag}` : '  5. No image to push',
  );
}

function preflight(plan: ReleasePlan, dockerArgs: readonly string[]): void {
  log(`Checking HEAD is ${BRANCH}, clean and level with its upstream`);
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD').stdout || 'a detached HEAD';
  if (branch !== BRANCH) fail(`you are on ${branch}, not ${BRANCH}`);
  if (git('status', '--porcelain').stdout !== '') {
    fail('the working tree is not clean; commit or stash your changes and try again');
  }
  const upstream = git('rev-parse', '--abbrev-ref', '@{upstream}');
  if (!upstream.ok) fail(`${BRANCH} has no upstream to compare with`);
  if (git('rev-parse', 'HEAD').stdout !== git('rev-parse', '@{upstream}').stdout) {
    fail(
      `${BRANCH} is not level with ${upstream.stdout}; run git pull --prune --tags and try again`,
    );
  }

  log('Checking who is logged in to npm');
  const who = capture('npm', ['whoami']);
  if (!who.ok || who.stdout === '')
    fail("nobody is logged in to npm; run 'npm login' and try again");
  console.log(`Logged in as ${who.stdout}`);

  if (plan.image.push && !step('bash', [DOCKER_SCRIPT, '--check-only', ...dockerArgs])) {
    fail('the Docker preflight checks failed; nothing was published or pushed');
  }
}

function runGates(): void {
  for (const gate of GATES) {
    log(`Quality gate: pnpm ${gate}`);
    if (!step('pnpm', [gate]))
      fail(`quality gate 'pnpm ${gate}' failed; nothing was published or pushed`);
  }
  if (git('status', '--porcelain').stdout !== '') {
    fail('the quality gates changed files in the working tree; nothing was published or pushed');
  }
}

function packAll(packages: readonly WorkspacePackage[]): Map<WorkspacePackage, string> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'geekity-release-'));
  const tarballs = new Map<WorkspacePackage, string>();
  const problems: string[] = [];
  for (const pkg of packages) {
    log(`Packing ${pkg.name}@${pkg.version}`);
    const destination = path.join(scratch, path.basename(pkg.dir));
    fs.mkdirSync(destination);
    const packed = capture('pnpm', ['--dir', pkg.dir, 'pack', '--pack-destination', destination]);
    const file = fs.readdirSync(destination).find((name) => name.endsWith('.tgz'));
    if (!packed.ok || file === undefined)
      fail(`pnpm pack failed for ${pkg.name}:\n${packed.stderr}`);
    const tarball = path.join(destination, file);
    if (!capture('tar', ['-xzf', tarball, '-C', destination]).ok)
      fail(`could not unpack ${tarball}`);
    for (const problem of tarballProblems(pkg, path.join(destination, 'package'))) {
      problems.push(`${pkg.name}@${pkg.version}: ${problem}`);
    }
    tarballs.set(pkg, tarball);
  }
  if (problems.length > 0) {
    fail(
      `the packed tarballs are not fit to publish, so nothing was published:\n  ${problems.join('\n  ')}`,
    );
  }
  return tarballs;
}

function publishAll(tarballs: ReadonlyMap<WorkspacePackage, string>): void {
  const done: string[] = [];
  for (const [pkg, tarball] of tarballs) {
    log(`Publishing ${pkg.name}@${pkg.version}`);
    if (!step('npm', ['publish', tarball, '--access', 'public'])) {
      fail(
        [
          done.length > 0 ? `Published ${done.join(', ')}.` : 'Nothing was published.',
          `Publishing ${pkg.name}@${pkg.version} failed, so nothing after it was published and no image was pushed.`,
          'Fix what went wrong and run pnpm release again: it publishes only what npm does not have yet.',
        ].join('\n'),
      );
    }
    done.push(`${pkg.name}@${pkg.version}`);
  }
}

interface Arguments {
  dryRun: boolean;
  customTag: string | undefined;
}

function parseArguments(argv: readonly string[]): Arguments {
  const parsed: Arguments = { dryRun: false, customTag: undefined };
  for (const arg of argv) {
    if (arg === '--dry-run') parsed.dryRun = true;
    // pnpm passes the -- in `pnpm release -- beta` through.
    else if (arg === '--') continue;
    else if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    else if (parsed.customTag !== undefined) {
      fail(`only one custom tag may be given (got '${parsed.customTag}' and '${arg}')`);
    } else parsed.customTag = arg;
  }
  return parsed;
}

function main(argv: readonly string[]): void {
  const { dryRun, customTag } = parseArguments(argv);
  const dockerArgs = customTag === undefined ? [] : [customTag];
  const root = path.resolve(import.meta.dirname, '..');
  if (fs.realpathSync(process.cwd()) !== fs.realpathSync(root)) {
    fail(`run this from the repository root (${root}), for example with pnpm release`);
  }

  log('Asking npm and the registry what is not released yet');
  const packages = readWorkspace(root);
  const plan = planRelease(packages, gatherFacts(packages));
  printPlan(plan);
  if (plan.refusals.length > 0) fail(`cannot release:\n  ${plan.refusals.join('\n  ')}`);
  if (plan.publish.length === 0 && !plan.image.push) {
    log('Nothing to release: every version is on npm and the image is in the registry');
    return;
  }
  if (customTag !== undefined && !plan.image.push) {
    fail(`a custom image tag was given, but there is no image to push for ${plan.image.ref}`);
  }
  if (dryRun) {
    printSteps(plan, dockerArgs);
    return;
  }

  preflight(plan, dockerArgs);
  runGates();
  publishAll(packAll(plan.publish));

  if (plan.image.push && !step('bash', [DOCKER_SCRIPT, '--skip-gates', ...dockerArgs])) {
    fail(
      [
        plan.publish.length > 0
          ? 'npm has every package of this release, but the image build and push failed.'
          : 'The image build and push failed.',
        'Fix what went wrong, then finish the release with:',
        `  pnpm docker:build-push -- --skip-gates${customTag === undefined ? '' : ` ${customTag}`}`,
      ].join('\n'),
    );
  }
  log('Released');
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    console.error(`\x1b[31merror:\x1b[0m ${error.message}`);
    process.exit(1);
  }
}
