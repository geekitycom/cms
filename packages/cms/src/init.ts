import { createRequire } from 'node:module';
import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The scaffolding `geekity init` copies, resolved from this module rather than
 * from the working directory so it is found whether the CLI is running from
 * `src/` under tsx or from `dist/` inside `node_modules`.
 */
export const SITE_TEMPLATE_DIR: string = fileURLToPath(
  new URL('../templates/site/', import.meta.url),
);

/**
 * `.gitignore` cannot be shipped under its own name: npm rewrites a
 * `.gitignore` inside a package to `.npmignore` when it packs it, so the
 * template carries it as `gitignore` and init renames it back.
 */
const DOTFILES: ReadonlyMap<string, string> = new Map([['gitignore', '.gitignore']]);

/** What {@link initSite} was asked to do. */
export interface InitSiteOptions {
  /** Directory to create, absolute or relative to {@link InitSiteOptions.cwd}. */
  directory: string;
  /** Directory relative paths resolve against. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Version of `@geekity/cms` the generated `package.json` depends on. Defaults
   * to the version of the package this module was loaded from, so a site is
   * pinned to the CLI that scaffolded it.
   */
  version?: string;
  /** Package name for the generated manifest. Defaults to the directory's name. */
  name?: string;
}

/** Where a site was created and what it holds. */
export interface InitSiteResult {
  /** Absolute path of the new site. */
  directory: string;
  /** Files written, site-relative and sorted, for the command to print. */
  files: readonly string[];
}

/** Thrown when the target directory already holds something. */
export class DirectoryNotEmptyError extends Error {
  override readonly name = 'DirectoryNotEmptyError';

  constructor(readonly directory: string) {
    super(
      `${directory} is not empty. geekity init only writes into a new or empty directory, so it can never overwrite a site you already have.`,
    );
  }
}

/**
 * Create a new site.
 *
 * The template is copied as it is; only `package.json` and
 * `pnpm-workspace.yaml` are generated, because a nested manifest or workspace
 * file inside `templates/` would be picked up by the workspace and by every
 * tool that walks for one.
 */
export async function initSite(options: InitSiteOptions): Promise<InitSiteResult> {
  const cwd = options.cwd ?? process.cwd();
  const directory = path.resolve(cwd, options.directory);

  if (!(await isEmptyOrMissing(directory))) throw new DirectoryNotEmptyError(directory);

  await copyTemplate('.', directory);

  for (const [packed, real] of DOTFILES) {
    await rename(path.join(directory, packed), path.join(directory, real));
  }

  const manifest = siteManifest({
    name: options.name ?? path.basename(directory),
    version: options.version ?? ownManifest().version,
  });
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(directory, 'pnpm-workspace.yaml'), pnpmSettings(), 'utf8');

  return { directory, files: (await readdir(directory)).sort() };
}

/** What {@link seedStarterContent} needs to know. */
export interface SeedStarterContentOptions {
  /** The site's content directory, absolute. */
  contentDir: string;
  /** The resolved base URL, written into the seeded `site.json` as its `url`. */
  baseUrl: string;
}

/**
 * Fill a missing or empty content directory with the starter site: the same
 * `content/` that `geekity init` writes, copied from the same template by the
 * same routine. `geekity serve` calls it when `seedContent` is on, which is
 * how the Docker image boots a new box with an empty content volume.
 *
 * A directory counts as empty only when it has no entries at all. Anything
 * else, even a lone dotfile, is left exactly as it is, so a mounted site is
 * never written over. Returns whether it seeded.
 */
export async function seedStarterContent(options: SeedStarterContentOptions): Promise<boolean> {
  const { contentDir, baseUrl } = options;
  if (!(await isEmptyOrMissing(contentDir))) return false;

  await copyTemplate('content', contentDir);

  // The template's url is the localhost default. The settings screen shows
  // this value, so it should be the address the site is actually served at.
  const siteJson = path.join(contentDir, '_data', 'site.json');
  const settings = JSON.parse(await readFile(siteJson, 'utf8')) as Record<string, unknown>;
  settings['url'] = baseUrl;
  await writeFile(siteJson, `${JSON.stringify(settings, undefined, 2)}\n`, 'utf8');

  return true;
}

/**
 * Copy part of the site template, `.` for the whole of it, into a directory,
 * creating the directory first. The one copy routine both {@link initSite}
 * and {@link seedStarterContent} go through.
 */
async function copyTemplate(part: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await cp(path.join(SITE_TEMPLATE_DIR, part), destination, { recursive: true });
}

/**
 * pnpm settings a new site starts with, as `pnpm-workspace.yaml`.
 *
 * pnpm reads its settings from this file even for a single package, and from
 * version 11 reads nothing else: the `pnpm` field in `package.json` is
 * ignored. Two things are settled here so a fresh install runs quietly and
 * unattended. Other package managers ignore the file.
 */
export function pnpmSettings(): string {
  return [
    '# pnpm settings for this site. Other package managers ignore this file.',
    '',
    '# tsx pulls in esbuild, whose install script pnpm blocks until it is',
    '# allowed by name.',
    'allowBuilds:',
    '  esbuild: true',
    '',
    '# nunjucks names chokidar an optional peer and only reaches for it when a',
    "# FileSystemLoader is built with `watch: true`. The CMS's loader never is.",
    'peerDependencyRules:',
    '  allowedVersions:',
    "    nunjucks>chokidar: '5'",
    '',
  ].join('\n');
}

/**
 * The manifest a new site starts life with.
 *
 * The three devDependencies are the TypeScript toolchain the template needs:
 * `tsx` runs `server.ts` and loads a TypeScript config for the bin, and
 * `typescript` plus `@types/node` are what type checking the site takes. Their
 * ranges are this package's own, so a site starts on the versions the CMS was
 * built and tested against rather than on a range frozen in the source.
 */
export function siteManifest(options: { name: string; version: string }): Record<string, unknown> {
  const toolchain = ownManifest().devDependencies ?? {};

  return {
    name: options.name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch server.ts',
      start: 'tsx server.ts',
      sync: 'geekity sync',
    },
    dependencies: {
      '@geekity/cms': `^${options.version}`,
    },
    devDependencies: {
      '@types/node': toolchain['@types/node'] ?? '^24.0.0',
      tsx: toolchain['tsx'] ?? '^4.20.0',
      typescript: toolchain['typescript'] ?? '^5.9.0',
    },
  };
}

/** True when the directory does not exist, or exists with nothing in it. */
async function isEmptyOrMissing(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length === 0;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') return true;
    throw error;
  }
}

/** This package's own manifest, read from beside the module that is running. */
export function ownManifest(): {
  version: string;
  devDependencies?: Record<string, string>;
} {
  const require = createRequire(import.meta.url);
  return require('../package.json') as {
    version: string;
    devDependencies?: Record<string, string>;
  };
}
