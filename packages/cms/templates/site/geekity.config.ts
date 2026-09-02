import { defineConfig } from '@geekity/cms';

export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  themeDir: 'theme',
  baseUrl: 'http://localhost:3000',
  watch: true,
});
