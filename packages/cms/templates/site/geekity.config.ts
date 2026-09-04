import { defineConfig } from '@geekity/cms';

export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  themeDir: 'theme',
  baseUrl: 'http://localhost:3000',
  watch: true,
  sessionLifetime: 60 * 60 * 24 * 14,
  loginAttempts: 5,
  loginLockout: 15 * 60,
  trustProxy: false,
});
