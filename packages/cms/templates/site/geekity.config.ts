import { defineConfig } from '@geekity/cms';

export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  // Where your own themes go: one folder each, `themes/<name>/`, holding a
  // `theme.json` and only the templates and assets that theme changes. This
  // directory is not scaffolded, because a site has one once it writes a theme
  // and not before. Which theme the site wears is a setting rather than a
  // path — `theme` in `content/_data/site.json`, and Appearance > Themes in
  // the admin — and with no theme chosen every page comes from the theme
  // inside @geekity/cms.
  themesDir: 'themes',
  baseUrl: 'http://localhost:3000',
  watch: true,
  sessionLifetime: 60 * 60 * 24 * 14,
  loginAttempts: 5,
  loginLockout: 15 * 60,
  trustProxy: false,
});
