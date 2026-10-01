import { defineConfig } from '@geekity/cms';

/**
 * Every value here is optional and every value can be overridden by an
 * environment variable at boot. See the README for the full table.
 *
 * `playground/` is a gitignored copy of `content/`, made by `playground.ts`
 * before `pnpm dev` and `pnpm start`, so what the admin writes stays local.
 */
export default defineConfig({
  port: 3000,
  contentDir: 'playground',
  dataDir: 'data',
  themesDir: 'themes',
  baseUrl: 'http://localhost:3000',
});
