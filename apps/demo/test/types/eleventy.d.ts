/**
 * Minimal typings for the bits of Eleventy's programmatic API the demo's
 * compatibility test uses.
 *
 * `@11ty/eleventy` 3.x ships no declarations of its own. The same declaration
 * lives in `packages/cms/test/types/eleventy.d.ts`; an ambient module cannot
 * be shared across two TypeScript projects without publishing it, and neither
 * copy is worth a package of its own for a surface this small.
 */
declare module '@11ty/eleventy' {
  export interface EleventyOptions {
    /** Path to the config file, relative to the working directory. */
    configPath?: string;
    /** Silence the build summary Eleventy otherwise writes to stdout. */
    quietMode?: boolean;
  }

  export default class Eleventy {
    constructor(input?: string, output?: string, options?: EleventyOptions);
    /** Build the site and write it to the output directory. */
    write(): Promise<unknown>;
  }
}
