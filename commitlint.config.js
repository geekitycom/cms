/**
 * Conventional Commits, enforced by the husky `commit-msg` hook (decision-7).
 *
 * release-please reads these messages to work out the next version and to
 * write the changelog, so `feat` and `fix` are load-bearing: `feat` takes a
 * minor, `fix` a patch, and `feat!` or a `BREAKING CHANGE:` footer a major.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    /**
     * A scope is optional — an empty scope passes — but a commit that names one
     * has to name one of these:
     *
     * - `cms`     the published @geekity/cms package
     * - `demo`    apps/demo
     * - `deps`    dependency bumps
     * - `ci`      GitHub Actions and other automation
     * - `docs`    README, CLAUDE.md and the docs directory
     * - `release` release-please and publishing
     */
    'scope-enum': [2, 'always', ['cms', 'demo', 'deps', 'ci', 'docs', 'release']],
  },
};
