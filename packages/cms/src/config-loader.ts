import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveConfig } from './config.ts';
import type { GeekityConfig, ResolvedConfig } from './config.ts';

export const CONFIG_FILENAMES = ['geekity.config.ts', 'geekity.config.js', 'geekity.config.mjs'];

/** Extensions that need TypeScript support in the loader. */
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);

/**
 * Load a config module, returning `{}` when the site has no config file.
 *
 * A TypeScript config is imported directly first. That is all it takes on Node
 * 24, which strips types without a flag, and inside this repository, where
 * the CLI already runs under tsx. A Node started with stripping disabled — and
 * any file carrying TypeScript syntax that stripping cannot erase — falls back to
 * registering tsx from the *site's* own dependencies, which is where a site
 * scaffolded by `geekity init` has it. A site with neither writes
 * `geekity.config.js` instead; it is in the candidate list for exactly that.
 */
export async function loadConfig(
  cwd: string,
  configPath: string | undefined,
): Promise<GeekityConfig> {
  const candidates =
    configPath === undefined
      ? CONFIG_FILENAMES.map((name) => path.resolve(cwd, name))
      : [path.resolve(cwd, configPath)];

  for (const candidate of candidates) {
    const href = pathToFileURL(candidate).href;
    let module: { default?: GeekityConfig };
    try {
      module = (await import(href)) as { default?: GeekityConfig };
    } catch (error) {
      if (isModuleNotFound(error, candidate)) continue;
      if (!needsTypeScriptLoader(error, candidate)) throw error;

      await registerTypeScriptLoader(cwd, candidate);
      module = (await import(href)) as { default?: GeekityConfig };
    }
    return module.default ?? {};
  }

  if (configPath !== undefined) {
    throw new Error(`Config file not found: ${path.resolve(cwd, configPath)}`);
  }
  return {};
}

export async function loadResolvedConfig(
  configPath: string | undefined,
  adjust: (config: GeekityConfig) => GeekityConfig = (config) => config,
): Promise<ResolvedConfig> {
  return resolveConfig(adjust(await loadConfig(process.cwd(), configPath)));
}

/**
 * The site's own tsx, as the directory the package was installed into, or
 * `undefined` when the site does not have one.
 *
 * Node's resolver is deliberately not asked: this has to be the tsx the *site*
 * installed, and a resolver anchored anywhere else — or patched by a tsx that
 * is already loaded, which is what happens inside this repository — would
 * happily answer with somebody else's copy.
 */
export function findSiteTsx(cwd: string): string | undefined {
  let directory = path.resolve(cwd);

  for (;;) {
    const candidate = path.join(directory, 'node_modules', 'tsx');
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Teach this process to import TypeScript, using the tsx installed alongside
 * the site.
 *
 * tsx is the site's rather than this package's because the CMS does not depend
 * on it at runtime: a site that runs `server.ts` already has it, and a site
 * that does not want it writes its config in JavaScript instead.
 */
export async function registerTypeScriptLoader(cwd: string, configFile: string): Promise<void> {
  const tsx = findSiteTsx(cwd);
  if (tsx === undefined) {
    throw new Error(
      `Could not load ${configFile}: this Node cannot import TypeScript on its own and tsx is ` +
        'not installed in this site. Either add it (pnpm add -D tsx), or write the config as ' +
        'geekity.config.js instead.',
    );
  }

  const fromTsx = createRequire(path.join(tsx, 'package.json'));
  const api = (await import(pathToFileURL(fromTsx.resolve('tsx/esm/api')).href)) as {
    register(): unknown;
  };
  api.register();
}

/**
 * Whether an import failed because the loader could not handle TypeScript.
 *
 * `ERR_UNKNOWN_FILE_EXTENSION` is Node before type stripping was on by
 * default; `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` is a file using `enum` or
 * `namespace`, which stripping refuses because erasing it is not enough.
 */
function needsTypeScriptLoader(error: unknown, candidate: string): boolean {
  if (!TYPESCRIPT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ERR_UNKNOWN_FILE_EXTENSION' || code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX';
}

function isModuleNotFound(error: unknown, candidate: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
    String((error as { message?: string }).message ?? '').includes(candidate)
  );
}
