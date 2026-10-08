/**
 * The bundle every plugin package ships beside its compiled `dist/`
 * (decision-33): `dist/bundle/index.js`, one ES module with every dependency
 * inlined, whose default export is the plugin, and `dist/bundle/plugin.json`
 * beside it. A folder install on Docker has no `node_modules` to resolve
 * against, so the bundle must import nothing but Node's own modules, and
 * `geekity plugin add` copies that folder and nothing else.
 *
 * `plugin.json` is written from the `geekity` field of package.json:
 *
 *   "geekity": { "plugin": true, "hostApi": 1, "requires": { "@geekity/plugin-llm": "^0.1.0" } }
 *
 * It carries the package's name and version, the host API version, and the
 * ranges of `@geekity/cms` and of each required plugin, which the registry
 * checks for a folder install as npm checks peer dependencies. The build
 * fails when the package is not marked a plugin, when a required package is
 * not also a peer dependency, when the bundled plugin's name, version, host
 * API or requires differ from package.json, and on a native module, which a
 * bundle cannot carry.
 *
 * Run from the plugin package's directory, as its `build` script does:
 *
 *   node ../../scripts/build-plugin-bundle.js
 *
 * esbuild is resolved from the plugin package, which lists it as a dev
 * dependency.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const CORE = '@geekity/cms';

/** Packages that exist to load a compiled addon. */
const NATIVE_LOADERS = [
  'bindings',
  'node-gyp-build',
  'prebuild-install',
  '@mapbox/node-pre-gyp',
  'node-addon-api',
  'nan',
];

const packageDir = process.cwd();
const require = createRequire(path.join(packageDir, 'package.json'));
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`${manifest.name ?? packageDir}: ${message}`);
  process.exit(1);
}

const declared = manifest.geekity;
if (declared?.plugin !== true || !Number.isInteger(declared.hostApi)) {
  fail(
    'package.json needs "geekity": { "plugin": true, "hostApi": <number>, "requires": { ... } } to build a plugin bundle.',
  );
}
const requires = declared.requires ?? {};
const peers = manifest.peerDependencies ?? {};
if (peers[CORE] === undefined)
  fail(`${CORE} must be a peer dependency, with the range it targets.`);
for (const name of Object.keys(requires)) {
  if (peers[name] === undefined) {
    fail(`it requires ${name}, which is not a peer dependency. Add it to peerDependencies.`);
  }
}

const { build } = await import(pathToFileURL(require.resolve('esbuild')).href);

const outdir = path.join(packageDir, 'dist', 'bundle');
const outfile = path.join(outdir, 'index.js');

const result = await build({
  entryPoints: [path.join(packageDir, 'src', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // A dependency written as CommonJS calls `require` for Node's own modules,
  // which an ES module does not have until it is given one.
  banner: {
    js: "import { createRequire as __geekityRequire } from 'node:module';\nconst require = __geekityRequire(import.meta.url);",
  },
  plugins: [refuseNativeModules()],
  logLevel: 'silent',
}).catch((error) => error);
if (result instanceof Error) {
  fail(
    `the bundle did not build:\n${(result.errors ?? []).map((e) => `  ${e.text}`).join('\n') || result.message}`,
  );
}

const plugin = (await import(`${pathToFileURL(outfile).href}?built=${String(Date.now())}`)).default;
for (const [key, expected] of [
  ['name', manifest.name],
  ['version', manifest.version],
  ['hostApi', declared.hostApi],
  ['requires', requires],
]) {
  const actual = plugin?.[key] ?? (key === 'requires' ? {} : undefined);
  if (!isDeepStrictEqual(actual, expected)) {
    fail(
      `the bundled plugin's ${key} is ${JSON.stringify(actual)}, and package.json says ${JSON.stringify(expected)}.`,
    );
  }
}

await writeFile(
  path.join(outdir, 'plugin.json'),
  `${JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      hostApi: declared.hostApi,
      peerDependencies: { [CORE]: publishedRange(CORE, peers[CORE]), ...requires },
    },
    null,
    2,
  )}\n`,
);

console.log(`bundled ${path.relative(packageDir, outdir)}/index.js and plugin.json`);

/** A `workspace:` range as `pnpm publish` writes it into the published package.json. */
function publishedRange(name, range) {
  if (!range.startsWith('workspace:')) return range;
  const version = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version;
  const wanted = range.slice('workspace:'.length);
  if (wanted === '^' || wanted === '~') return `${wanted}${version}`;
  if (wanted === '*') return version;
  return wanted;
}

/** Fail the build on a compiled addon, or on a package that exists to load one. */
function refuseNativeModules() {
  const native = new Map();

  /** The name of the package the file belongs to when that package is native. */
  function nativePackage(file) {
    for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
      if (native.has(dir)) return native.get(dir);
      const packageJson = path.join(dir, 'package.json');
      if (!existsSync(packageJson)) continue;
      const found = JSON.parse(readFileSync(packageJson, 'utf8'));
      if (typeof found.name !== 'string') continue;
      const dependencies = Object.keys(found.dependencies ?? {});
      const isNative =
        existsSync(path.join(dir, 'binding.gyp')) ||
        found.gypfile === true ||
        dependencies.some((dependency) => NATIVE_LOADERS.includes(dependency));
      native.set(dir, isNative ? found.name : undefined);
      return native.get(dir);
    }
    return undefined;
  }

  const refusal = (what) =>
    `${what} is a native module, which a bundle cannot carry. A plugin that needs one is installed with npm by a site with its own server.`;

  return {
    name: 'refuse-native-modules',
    setup(build) {
      build.onResolve({ filter: /\.node$/ }, (args) => ({
        errors: [{ text: refusal(path.basename(args.path)) }],
      }));
      build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        if (!args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const name = nativePackage(args.path);
        return name === undefined ? undefined : { errors: [{ text: refusal(name) }] };
      });
    },
  };
}
