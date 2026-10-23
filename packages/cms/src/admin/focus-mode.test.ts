import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FOCUS_OFF,
  focusStep,
  isFocusShortcut,
  outsideOf,
  wordCount,
  wordsLabel,
} from './focus-mode.ts';
import type { FocusState, KeyPress } from './focus-mode.ts';

describe('wordCount', () => {
  it('counts nothing in an empty or blank body', () => {
    assert.equal(wordCount(''), 0);
    assert.equal(wordCount('  \n\n\t '), 0);
  });

  it('counts words across lines and paragraphs', () => {
    assert.equal(wordCount('One two\nthree.\n\nFour, five!'), 5);
  });

  it('does not count Markdown marks standing on their own', () => {
    assert.equal(wordCount('# A heading\n\n- item\n\n---\n\n> quoted words'), 5);
  });

  it('counts a word once however it is marked up', () => {
    assert.equal(wordCount('**bold** and _quiet_ and `code`'), 5);
    assert.equal(wordCount('[two words](https://example.com/a-long-path)'), 2);
  });

  it('counts words in other scripts and numbers', () => {
    assert.equal(wordCount('café naïve 2026 Ελλάδα'), 4);
  });
});

describe('wordsLabel', () => {
  it('says word for one and words otherwise', () => {
    assert.equal(wordsLabel(0), '0 words');
    assert.equal(wordsLabel(1), '1 word');
    assert.equal(wordsLabel(2), '2 words');
  });

  it('groups thousands', () => {
    assert.equal(wordsLabel(12345), '12,345 words');
  });
});

describe('isFocusShortcut', () => {
  const press = (over: Partial<KeyPress>): KeyPress => ({
    key: 'F',
    code: 'KeyF',
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    ...over,
  });

  it('is Ctrl+Shift+F and Cmd+Shift+F', () => {
    assert.equal(isFocusShortcut(press({ ctrlKey: true })), true);
    assert.equal(isFocusShortcut(press({ metaKey: true })), true);
  });

  it('is the F key on a layout that types something else there', () => {
    assert.equal(isFocusShortcut(press({ ctrlKey: true, key: 'А' })), true);
  });

  it('is not F alone, Shift+F, Ctrl+F or Ctrl+Alt+Shift+F', () => {
    assert.equal(isFocusShortcut(press({ shiftKey: false })), false);
    assert.equal(isFocusShortcut(press({})), false);
    assert.equal(isFocusShortcut(press({ ctrlKey: true, shiftKey: false, key: 'f' })), false);
    assert.equal(isFocusShortcut(press({ ctrlKey: true, altKey: true })), false);
  });

  it('is not another letter', () => {
    assert.equal(isFocusShortcut(press({ ctrlKey: true, key: 'G', code: 'KeyG' })), false);
  });
});

describe('focusStep', () => {
  const ROOM = { blocked: false, canFullscreen: true };
  const on = (fullscreen: 'asked' | 'on' | 'window'): FocusState => ({ on: true, fullscreen });

  describe('entering', () => {
    it('enters by the button and asks for fullscreen', () => {
      assert.deepEqual(focusStep(FOCUS_OFF, { type: 'button', ...ROOM }), {
        state: on('asked'),
        effects: ['enter', 'request-fullscreen'],
      });
    });

    it('enters by the shortcut the same way', () => {
      assert.deepEqual(focusStep(FOCUS_OFF, { type: 'shortcut', ...ROOM }), {
        state: on('asked'),
        effects: ['enter', 'request-fullscreen'],
      });
    });

    it('fills the window without asking where fullscreen is not available', () => {
      assert.deepEqual(
        focusStep(FOCUS_OFF, { type: 'button', blocked: false, canFullscreen: false }),
        { state: on('window'), effects: ['enter'] },
      );
    });

    it('refuses while an offer of unsaved changes waits for a choice, and says why', () => {
      for (const type of ['button', 'shortcut'] as const) {
        assert.deepEqual(focusStep(FOCUS_OFF, { type, blocked: true, canFullscreen: true }), {
          state: FOCUS_OFF,
          effects: ['explain-blocked'],
        });
      }
    });
  });

  describe('fullscreen answers', () => {
    it('is in fullscreen once the browser grants it', () => {
      assert.deepEqual(focusStep(on('asked'), { type: 'fullscreen-on' }), {
        state: on('on'),
        effects: [],
      });
    });

    it('stays in the mode, filling the window, when the browser refuses', () => {
      assert.deepEqual(focusStep(on('asked'), { type: 'fullscreen-refused' }), {
        state: on('window'),
        effects: [],
      });
    });

    it('gives fullscreen back when it is granted after the mode was left', () => {
      assert.deepEqual(focusStep(FOCUS_OFF, { type: 'fullscreen-on' }), {
        state: FOCUS_OFF,
        effects: ['exit-fullscreen'],
      });
    });

    it('ignores a refusal that arrives after the mode was left', () => {
      assert.deepEqual(focusStep(FOCUS_OFF, { type: 'fullscreen-refused' }), {
        state: FOCUS_OFF,
        effects: [],
      });
    });
  });

  describe('leaving', () => {
    for (const type of ['escape', 'exit'] as const) {
      it(`leaves by ${type}, ending browser fullscreen too`, () => {
        assert.deepEqual(focusStep(on('on'), { type }), {
          state: FOCUS_OFF,
          effects: ['leave', 'exit-fullscreen'],
        });
      });

      it(`leaves by ${type} from the window-filling fallback`, () => {
        assert.deepEqual(focusStep(on('window'), { type }), {
          state: FOCUS_OFF,
          effects: ['leave'],
        });
      });
    }

    it('leaves by the shortcut', () => {
      assert.deepEqual(focusStep(on('on'), { type: 'shortcut', ...ROOM }), {
        state: FOCUS_OFF,
        effects: ['leave', 'exit-fullscreen'],
      });
    });

    it('ends a fullscreen request still in flight', () => {
      assert.deepEqual(focusStep(on('asked'), { type: 'exit' }), {
        state: FOCUS_OFF,
        effects: ['leave', 'exit-fullscreen'],
      });
    });

    it('leaves when the browser leaves fullscreen, without asking it to again', () => {
      assert.deepEqual(focusStep(on('on'), { type: 'fullscreen-off' }), {
        state: FOCUS_OFF,
        effects: ['leave'],
      });
    });

    it('does nothing for Escape, Exit or leaving fullscreen when the mode is off', () => {
      for (const type of ['escape', 'exit', 'fullscreen-off'] as const) {
        assert.deepEqual(focusStep(FOCUS_OFF, { type }), { state: FOCUS_OFF, effects: [] });
      }
    });

    it('ignores fullscreen ending in the window-filling fallback, which never had it', () => {
      assert.deepEqual(focusStep(on('window'), { type: 'fullscreen-off' }), {
        state: on('window'),
        effects: [],
      });
    });
  });
});

describe('outsideOf', () => {
  interface Node {
    readonly name: string;
    readonly children: Node[];
    parent: Node | null;
  }
  function node(name: string, ...children: Node[]): Node {
    const made: Node = { name, children, parent: null };
    for (const child of children) child.parent = made;
    return made;
  }
  const tree = {
    parentOf: (n: Node) => n.parent,
    childrenOf: (n: Node) => n.children,
  };
  const names = (nodes: readonly Node[]) => nodes.map((n) => n.name).sort();

  const title = node('title', node('title-input'));
  const body = node('body', node('codemirror'));
  const status = node('status');
  const card = node('card', title, node('sections'), body, node('tools'), status);
  const column = node('column', card, node('also'));
  const form = node('form', column, node('sidebar'));
  const main = node('main', node('heading'), node('banner'), form, node('scripts'));
  const root = node(
    'body-element',
    node('skip-link'),
    node('admin-bar'),
    node('drawer-side'),
    main,
  );

  it('hides every sibling along the way to what is kept, and nothing inside it', () => {
    assert.deepEqual(
      names(outsideOf(root, [title, body, status], tree)),
      [
        'admin-bar',
        'also',
        'banner',
        'drawer-side',
        'heading',
        'scripts',
        'sections',
        'sidebar',
        'skip-link',
        'tools',
      ].sort(),
    );
  });

  it('hides nothing when the root itself is kept', () => {
    assert.deepEqual(outsideOf(root, [root], tree), []);
  });

  it('ignores a kept node that is not under the root', () => {
    const stray = node('stray');
    assert.deepEqual(names(outsideOf(card, [title, stray], tree)), [
      'body',
      'sections',
      'status',
      'tools',
    ]);
  });
});
