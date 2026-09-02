/**
 * What the husky `pre-commit` hook runs, on staged files only (decision-8).
 *
 * Anything prettier must not touch — `backlog/`, the content fixtures, the
 * demo's content — is listed in `.prettierignore`, which prettier applies to
 * paths named on the command line too, so a staged Backlog task passes through
 * untouched. `--no-warn-ignored` keeps eslint quiet about the same files.
 */
export default {
  '*.{ts,mts,cts,js,mjs,cjs}': ['eslint --fix --no-warn-ignored', 'prettier --write'],
  '*.{json,md,yml,yaml,css}': ['prettier --write --ignore-unknown'],
};
