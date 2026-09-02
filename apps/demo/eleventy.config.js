/**
 * The demo site, built by Eleventy instead of served by the CMS.
 *
 * A site of your own copies `packages/cms/docs/eleventy.config.example.js` to
 * `eleventy.config.js` in its root and owns the copy; that is what the file's
 * own header tells you to do, and it is why the example carries no imports.
 * The demo re-exports it instead, for one reason: a copy here could drift from
 * the documented one without anything noticing, and the whole point of this
 * app is to be the place where drift is noticed.
 *
 * `pnpm --filter demo build:11ty` writes `_site/`, which is gitignored.
 * `pnpm --filter demo test:11ty` builds the same directory in a temporary one
 * and compares every URL with the permalink the CMS computes for the same
 * file.
 */
export { default } from '../../packages/cms/docs/eleventy.config.example.js';
