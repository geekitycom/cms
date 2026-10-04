/**
 * Turndown's API as `content.ts` uses it. `@types/turndown` is written
 * against the browser's DOM types, which this server package does not load,
 * so the node a rule receives is described here by the parts read of it: in
 * Node it is a domino node.
 */
declare module 'turndown' {
  export interface TurndownNode {
    readonly nodeName: string;
    readonly nodeType: number;
    nodeValue: string | null;
    readonly parentNode: TurndownNode | null;
    readonly nextSibling: TurndownNode | null;
    readonly childNodes: ArrayLike<TurndownNode>;
    readonly children: ArrayLike<TurndownNode>;
    readonly ownerDocument: { createTextNode(text: string): TurndownNode } | null;
    readonly outerHTML: string;
    getAttribute(name: string): string | null;
    cloneNode(deep: boolean): TurndownNode;
    insertBefore(node: TurndownNode, before: TurndownNode): void;
    appendChild(node: TurndownNode): void;
  }

  export interface Options {
    headingStyle?: 'setext' | 'atx';
    codeBlockStyle?: 'indented' | 'fenced';
    bulletListMarker?: '-' | '+' | '*';
    emDelimiter?: '_' | '*';
  }

  export interface Rule {
    filter: string | string[] | ((node: TurndownNode) => boolean);
    replacement: (content: string, node: TurndownNode, options: Options) => string;
  }

  export default class TurndownService {
    constructor(options?: Options);
    addRule(key: string, rule: Rule): this;
    escape(text: string): string;
    turndown(html: string): string;
  }
}
