import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ownParagraph } from './own-paragraph.ts';

const URL = 'https://youtu.be/dQw4w9WgXcQ';

function inserted(doc: string, at: number, to = at): string {
  const change = ownParagraph(doc, at, to, URL);
  return doc.slice(0, change.from) + change.insert + doc.slice(change.to);
}

describe('ownParagraph', () => {
  it('fills an empty body with the line and a blank line to go on writing after', () => {
    assert.equal(inserted('', 0), `${URL}\n\n`);
  });

  it('starts a paragraph of its own after text on the cursor line', () => {
    assert.equal(inserted('Some words.', 11), `Some words.\n\n${URL}\n\n`);
  });

  it('splits a paragraph the cursor is inside', () => {
    assert.equal(inserted('One two.', 4), `One \n\n${URL}\n\ntwo.`);
  });

  it('adds no extra blank lines where there already are some', () => {
    assert.equal(inserted('One.\n\n\n\nTwo.', 6), `One.\n\n${URL}\n\nTwo.`);
  });

  it('completes a blank line that has only one newline before it', () => {
    assert.equal(inserted('One.\n', 5), `One.\n\n${URL}\n\n`);
  });

  it('replaces the selection', () => {
    assert.equal(inserted('Keep this. Drop.', 11, 16), `Keep this. \n\n${URL}\n\n`);
  });

  for (const [doc, at] of [
    ['One.', 4],
    ['One.\n', 5],
    ['One two.', 4],
    ['One.\n\n\n\nTwo.', 6],
  ] as const) {
    it(`leaves the cursor past the blank line after the URL in ${JSON.stringify(doc)}`, () => {
      const change = ownParagraph(doc, at, at, URL);
      const result = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
      assert.ok(result.slice(0, change.cursor).endsWith(`${URL}\n\n`));
    });
  }
});
