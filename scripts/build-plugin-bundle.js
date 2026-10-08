/**
 * The bundle every plugin package ships beside its compiled `dist/`
 * (decision-33): `dist/bundle/index.js`, one ES module with every dependency
 * inlined, whose default export is the plugin. A folder install on Docker has
 * no `node_modules` to resolve against, so the bundle must import nothing but
 * Node's own modules.
 *
 * Run from the plugin package's directory, as its `build` script does:
 *
 *   node ../../scripts/build-plugin-bundle.js
 *
 * esbuild is resolved from the plugin package, which lists it as a dev
 * dependency.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDir = process.cwd();
const require = createRequire(path.join(packageDir, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('esbuild')).href);

const outfile = path.join(packageDir, 'dist', 'bundle', 'index.js');

await build({
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
  logLevel: 'warning',
});

console.log(`bundled ${path.relative(packageDir, outfile)}`);
