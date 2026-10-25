import { createRequire } from 'node:module';

/** The published version of `@geekity/cms`. */
export const PACKAGE_VERSION = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;
