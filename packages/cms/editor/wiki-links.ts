import { syntaxTree } from '@codemirror/language';
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import type { PluginValue, ViewUpdate } from '@codemirror/view';

import { wikiLinksIn } from '../src/content/wiki-link-syntax.ts';

/** Markdown nodes whose text is shown as written, where `[[` is not a link. */
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'HTMLBlock']);

const LINK = Decoration.mark({ class: 'cm-wiki-link' });
/** The punctuation colour the Markdown highlighting gives a link's brackets. */
const BRACKETS = Decoration.mark({ class: 'cm-md-mark' });
/** CodeMirror's own class, so a wiki link's brackets match like any others. */
const MATCHED = Decoration.mark({ class: 'cm-matchingBracket' });

/**
 * Mark each `[[wiki link]]` in view, underline the ones whose page `existing`
 * does not have, and match a link's `[[` with its `]]` when the cursor is at
 * either. The links are found by the same code the server renders them with,
 * so what is marked here is what becomes a link.
 */
export function wikiLinkMarks(existing: ReadonlySet<string>): ViewPlugin<PluginValue> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = marks(view, existing);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = marks(update.view, existing);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** The slugs on `#editor-enhance`, or none when the page carries none. */
export function wikiSlugsOf(tools: HTMLElement): Set<string> {
  try {
    const value: unknown = JSON.parse(tools.dataset['wikiSlugs'] ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((slug) => typeof slug === 'string') : []);
  } catch {
    return new Set();
  }
}

function marks(view: EditorView, existing: ReadonlySet<string>): DecorationSet {
  const { state } = view;
  const head = state.selection.main.head;
  const found: ReturnType<Decoration['range']>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      for (const span of wikiLinksIn(line.text)) {
        const start = line.from + span.from;
        const end = line.from + span.to;
        if (inCode(state, start)) continue;
        found.push(
          (existing.has(span.slug) ? LINK : missing(span.slug)).range(start, end),
          BRACKETS.range(start, start + 2),
          BRACKETS.range(end - 2, end),
        );
        const atOpen = head >= start && head <= start + 2;
        const atClose = head >= end - 2 && head <= end;
        if (atOpen || atClose) {
          found.push(MATCHED.range(start, start + 2), MATCHED.range(end - 2, end));
        }
      }
      if (line.to >= to || line.number === state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(found, true);
}

/**
 * The mark for a link to a page not written yet. The underline is dashed as
 * well as coloured, and the title says it in words, so it is not colour alone.
 */
function missing(slug: string): Decoration {
  const hint = `No wiki page “${slug}” yet`;
  return Decoration.mark({
    class: 'cm-wiki-link cm-wiki-link-missing',
    attributes: { title: hint, 'aria-description': hint },
  });
}

function inCode(state: EditorView['state'], pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); ;) {
    if (CODE.has(node.name)) return true;
    const parent = node.parent;
    if (parent === null) return false;
    node = parent;
  }
}
