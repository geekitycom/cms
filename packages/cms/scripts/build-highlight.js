/**
 * Bundle highlight.js into `themes/default/static/highlight.js`, the default
 * theme's code highlighter.
 *
 * The CMS renders a fenced block as `pre > code.language-x` and highlights
 * nothing (decision-16): highlighting is a theme's business, on the client. The
 * default theme does it with highlight.js, self-hosted — there is no CDN
 * anywhere in this project, because a `<script>` pointing at somebody else's
 * server is a dependency the site cannot see, and because a site should keep
 * working on a laptop with no network.
 *
 * Unlike the editor bundle next door, this one is committed to git. A site
 * installs `@geekity/cms` and gets the file inside `themes/`, with no build
 * step of its own; `files` in package.json already ships everything under
 * `themes/`. Rebuilding it is one command:
 *
 *     pnpm --filter @geekity/cms build:highlight
 *
 * Run that after bumping the pinned `highlight.js` devDependency or changing
 * {@link LANGUAGES}, and commit what it writes.
 * `src/web/highlight-bundle.test.ts` fails when the committed file was built
 * from a different version of highlight.js than the one installed, so a bump
 * without a rebuild does not go unnoticed.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The grammars in the bundle: the languages this project's author writes in,
 * and no more. highlight.js has nearly two hundred; every one of them is bytes
 * every reader of a page with code on it downloads, so the list is deliberate.
 * A site that writes in something else rebuilds with its own list, or drops the
 * bundle and overrides the `scripts` block — see the theme README.
 *
 * Aliases come with the grammar, so `js`, `ts`, `html`, `yml` and `sh` all
 * resolve without being named here.
 */
const LANGUAGES = [
  'bash',
  'css',
  'diff',
  'dockerfile',
  'go',
  'ini',
  'javascript',
  'json',
  'markdown',
  'nginx',
  'php',
  'python',
  'rust',
  'shell',
  'sql',
  'typescript',
  'xml',
  'yaml',
];

/**
 * The entry point, generated rather than kept as a file, so {@link LANGUAGES}
 * is the only place the list is written down.
 *
 * What it does on a page: highlight every `pre code` whose `language-` class
 * names a grammar in the bundle, and nothing else. Auto-detection is off —
 * `languages: []` leaves `highlightAuto` no candidates — and a block naming a
 * language that is not here is skipped rather than passed to `highlight`,
 * which throws on one it does not know. Either way the element keeps its class
 * and its plain text, which is what the renderer wrote.
 */
const entry = `
import hljs from 'highlight.js/lib/core';
${LANGUAGES.map((name) => `import ${identifier(name)} from 'highlight.js/lib/languages/${name}';`).join('\n')}

${LANGUAGES.map((name) => `hljs.registerLanguage('${name}', ${identifier(name)});`).join('\n')}

hljs.configure({ languages: [] });

function highlightAll() {
  for (const element of document.querySelectorAll('pre code[class*="language-"]')) {
    const named = /(?:^|\\s)language-([^\\s]+)/.exec(element.getAttribute('class') || '');
    const language = named && named[1];
    if (!language || !hljs.getLanguage(language)) continue;
    hljs.highlightElement(element);
  }
}

window.hljs = hljs;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', highlightAll, { once: true });
} else {
  highlightAll();
}
`;

/** A language name as a JavaScript identifier: \`php\` stays, \`c-like\` would not. */
function identifier(name) {
  return `lang_${name.replace(/\W/g, '_')}`;
}

const result = await build({
  absWorkingDir: packageDir,
  stdin: {
    contents: entry,
    resolveDir: packageDir,
    sourcefile: 'highlight-entry.js',
    loader: 'js',
  },
  outfile: 'themes/default/static/highlight.js',
  bundle: true,
  // A plain script, not a module: the theme loads it with `defer`, which a
  // module would ignore in favour of its own deferred semantics anyway, and a
  // script is one fewer thing that can go wrong behind an old proxy.
  format: 'iife',
  target: ['es2020', 'chrome91', 'edge91', 'firefox90', 'safari15'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});

const [output] = Object.entries(result.metafile.outputs);
if (output !== undefined) {
  const [file, { bytes }] = output;
  console.log(`highlight bundle: ${file} (${(bytes / 1024).toFixed(0)} kB)`);
}
