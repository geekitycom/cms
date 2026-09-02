/**
 * markdown-it-footnote ships no types, and the DefinitelyTyped package pulls in
 * a second, incompatible copy of the markdown-it types. One line is cheaper.
 */
declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';

  const footnotePlugin: (md: MarkdownIt) => void;
  export default footnotePlugin;
}
