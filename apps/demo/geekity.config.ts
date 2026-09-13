import { defineConfig } from '@geekity/cms';

/**
 * Every value here is optional and every value can be overridden by an
 * environment variable at boot. See the README for the full table.
 */
export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  themesDir: 'themes',
  baseUrl: 'http://localhost:3000',
});
