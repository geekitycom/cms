import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole workspace (decision-8).
 *
 * Type-checked rules need a TypeScript program, which the project service
 * builds from the nearest `tsconfig.json` — `packages/cms/tsconfig.json` for
 * the package and its tests, `apps/demo/tsconfig.json` for the demo site. Any
 * `.ts` file outside those projects has to be listed in `ignores` below, or the
 * parser has nothing to type it with.
 *
 * A note on TypeScript versions: TypeScript 7 is a native compiler and no
 * longer ships the JavaScript compiler API that typescript-eslint reads types
 * through. The workspace root therefore keeps TypeScript 6 as a lint-only
 * dependency while each package builds and type checks with TypeScript 7, which
 * is the side-by-side arrangement TypeScript 7 documents. Drop the root pin
 * once typescript-eslint supports TypeScript 7.
 */
export default tseslint.config(
  {
    name: 'geekity/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/_site/**',
      '**/data/**',
      // A build product: esbuild's output, written by `pnpm build` from
      // packages/cms/editor/, which is linted as source instead.
      'packages/cms/admin/static/editor.js',
      // The other esbuild output: the default theme's highlight.js bundle,
      // written by `pnpm --filter @geekity/cms build:highlight`. Unlike the
      // editor's it is committed, so it has to be named here; the source it is
      // built from is the entry inside scripts/build-highlight.js.
      'packages/cms/themes/default/static/highlight.js',
      'backlog/**',
      // Content, not code: fixtures are stored exactly as the document writer
      // emits them, so nothing may rewrite them.
      'packages/cms/test/fixtures/**',
      // Scaffolding that `geekity init` copies into a new site. It imports
      // `@geekity/cms` by package name, which only resolves once it has been
      // copied out, so there is no project here to type check it against.
      'packages/cms/templates/**',
    ],
  },

  {
    name: 'geekity/javascript',
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    name: 'geekity/typescript',
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      // The linter reads types through TypeScript 6 while the packages compile
      // with TypeScript 7, so the two do not always agree on which assertions
      // are redundant. Every assertion this rule flagged is deliberate — it
      // narrows an `unknown` row out of node:sqlite, or keys a generic record —
      // and removing them made `pnpm typecheck` fail. Turn the rule back on
      // when the linter and the compiler run the same TypeScript.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // `_` marks a binding that exists only to be destructured past, which is
      // how the store drops columns it does not return.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // A promise whose result is deliberately dropped says so with `void`.
      // The exception is node:test, whose `describe` and `it` return promises
      // the runner itself awaits; a test file that had to `void` every one of
      // them would be unreadable for no gain.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['after', 'afterEach', 'before', 'beforeEach', 'describe', 'it', 'test'],
            },
          ],
        },
      ],
    },
  },

  {
    // The admin editor's browser code. It has a tsconfig of its own — the DOM
    // lib and no node types — because it is bundled by esbuild rather than
    // compiled with the server, and `globals.node` above would let a `process`
    // or a `Buffer` through the linter into a page.
    name: 'geekity/editor-client',
    files: ['packages/cms/editor/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  {
    // The admin's hand-written browser scripts, served as they are. Same
    // reasoning as the block above: `globals.node` would let a `process`
    // through the linter into a page. `editor.js` beside them is esbuild's
    // output and is ignored; its source is linted as TypeScript.
    name: 'geekity/admin-static',
    files: ['packages/cms/admin/static/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser,
    },
  },

  {
    name: 'geekity/tests',
    files: ['**/*.test.ts', 'packages/cms/test/**/*.ts'],
    rules: {
      // Tests reach into JSON bodies, template output and third-party build
      // tools, none of which arrive typed. Asserting on `any` is the point.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Last, so it can switch off every rule prettier already decides.
  prettierConfig,
);
