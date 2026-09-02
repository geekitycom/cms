/**
 * gray-matter ships a `gray-matter.d.ts` but never points `types` at it, and
 * there is no DefinitelyTyped package. Declare the slice the parser uses.
 *
 * Note that `matter`, `language` and `orig` are non-enumerable on the returned
 * object and vanish when gray-matter serves a cached result, so they are left
 * out here on purpose.
 */
declare module 'gray-matter' {
  interface GrayMatterFile {
    /** The parsed front matter. */
    data: Record<string, unknown>;
    /** Everything after the closing delimiter. */
    content: string;
    /** True when the delimiters were there but held nothing. */
    isEmpty: boolean;
  }

  interface GrayMatterOptions {
    /** Opening and closing fences. Defaults to `---`. */
    delimiters?: string | [string, string];
    /** Front-matter language. Defaults to `yaml`. */
    language?: string;
  }

  function matter(input: string, options?: GrayMatterOptions): GrayMatterFile;
  export default matter;
}
