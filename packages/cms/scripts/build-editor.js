/**
 * Bundle the admin editor's browser code into `admin/static/editor.js`.
 *
 * There is no bundler anywhere else in this repository and no CDN in the
 * admin: it has to work on a laptop with no network, and a `<script>` pointing
 * at somebody else's server is a dependency the site cannot see. So CodeMirror
 * is a devDependency, esbuild flattens it into one file, and that file ships in
 * the package's `admin/` directory like the stylesheet next to it.
 *
 * The bundle is a build product. It is gitignored, it is written by
 * `pnpm build` — which the root `prepare` script runs, so it exists after an
 * install and before a publish — and `files` in package.json already ships
 * everything under `admin/`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  absWorkingDir: packageDir,
  entryPoints: ['editor/main.ts'],
  outfile: 'admin/static/editor.js',
  bundle: true,
  // A module, because the template loads it with `type="module"`.
  format: 'esm',
  // The browsers that ship the CSS and the JavaScript CodeMirror 6 expects.
  target: ['es2022', 'chrome111', 'edge111', 'firefox113', 'safari16.4'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});

const [output] = Object.entries(result.metafile.outputs);
if (output !== undefined) {
  const [file, { bytes }] = output;
  console.log(`editor bundle: ${file} (${(bytes / 1024).toFixed(0)} kB)`);
}
