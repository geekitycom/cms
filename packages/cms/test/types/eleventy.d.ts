/**
 * Minimal typings for the bits of Eleventy's programmatic API the
 * compatibility test uses. `@11ty/eleventy` 3.x ships no declarations of its
 * own, and only this test imports it, so the surface stays small on purpose.
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
