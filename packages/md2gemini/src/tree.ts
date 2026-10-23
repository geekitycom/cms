import type { Token } from 'markdown-it';

/**
 * A markdown-it token with the tokens it encloses. markdown-it emits a flat
 * stream in which `_open` and `_close` tokens bracket their contents; nesting
 * it lets each element be rendered from its own children.
 */
export interface Node {
  readonly type: string;
  readonly token: Token;
  readonly children: readonly Node[];
}

export function nest(tokens: readonly Token[]): Node[] {
  const root: Node[] = [];
  const open: Node[][] = [root];
  for (const token of tokens) {
    const siblings = open.at(-1)!;
    if (token.nesting === 1) {
      const children: Node[] = [];
      siblings.push({ type: token.type.replace(/_open$/, ''), token, children });
      open.push(children);
    } else if (token.nesting === -1) {
      open.pop();
    } else {
      siblings.push({ type: token.type, token, children: nest(token.children ?? []) });
    }
  }
  return root;
}

export function find(nodes: readonly Node[], type: string): Node | undefined {
  return nodes.find((node) => node.type === type);
}

export function count(nodes: readonly Node[], types: ReadonlySet<string>): number {
  return nodes.reduce(
    (total, node) => total + (types.has(node.type) ? 1 : 0) + count(node.children, types),
    0,
  );
}
