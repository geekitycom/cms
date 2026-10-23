import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addedWords, wordCount } from './words.ts';

describe('wordCount', () => {
  it('counts nothing in an empty or blank body', () => {
    assert.equal(wordCount(''), 0);
    assert.equal(wordCount('  \n\n\t '), 0);
  });

  it('counts words across lines and paragraphs', () => {
    assert.equal(wordCount('One two\nthree.\n\nFour, five!'), 5);
  });

  it('does not count Markdown markers', () => {
    assert.equal(wordCount('# A heading\n\n- item\n\n---\n\n> quoted words'), 5);
    assert.equal(wordCount('1. first\n2) second\n- [x] done\n- [ ] open'), 4);
    assert.equal(wordCount('| a | b |\n|---|---|\n| c | d |'), 4);
  });

  it('counts a word once however it is marked up', () => {
    assert.equal(wordCount('**bold** and _quiet_ and ~~gone~~'), 5);
  });

  it('does not count link or image targets', () => {
    assert.equal(wordCount('[my post](https://example.com/a/b)'), 2);
    assert.equal(wordCount('[my post](https://example.com/a/b "A title")'), 2);
    assert.equal(wordCount('![a red door](/media/door-2026.jpg)'), 3);
    assert.equal(wordCount('See [the docs][docs].\n\n[docs]: https://example.com/docs'), 3);
  });

  it('does not count HTML tags or comments', () => {
    assert.equal(wordCount('<p class="lead">Hello <b>there</b></p>'), 2);
    assert.equal(wordCount('<div>one</div><div>two</div>'), 2);
    assert.equal(wordCount('Before <!-- a hidden note --> after'), 2);
  });

  it('counts the text inside inline code and code blocks', () => {
    assert.equal(wordCount('Run `pnpm build` first'), 4);
    assert.equal(wordCount('Write `<b>bold</b>` here'), 3);
    assert.equal(wordCount('Code:\n\n```js\nconst total = 1;\n```\n\nDone.'), 5);
    assert.equal(wordCount('~~~\n1. not a list\n<b>kept</b>\n~~~'), 5);
  });

  it('counts words in other scripts and numbers', () => {
    assert.equal(wordCount('café naïve 2026 Ελλάδα 東京 Москва'), 6);
  });

  it('does not count runs of only emoji or punctuation', () => {
    assert.equal(wordCount('🎉 🚀🔥 -- … !!'), 0);
    assert.equal(wordCount('Ship it 🚀'), 2);
  });
});

describe('addedWords', () => {
  it('credits nothing for an unchanged or empty body', () => {
    assert.equal(addedWords('', ''), 0);
    const body = 'A short post.\n\nWith [a link](https://example.com).';
    assert.equal(addedWords(body, body), 0);
  });

  it('credits the whole body when there was nothing before', () => {
    const body = '# Title\n\nSome [linked](https://example.com) words 🚀 in 東京.';
    assert.equal(addedWords('', body), wordCount(body));
  });

  it('credits the words a later body inserts', () => {
    assert.equal(addedWords('One two three.', 'One two and a half three.'), 3);
    assert.equal(addedWords('One two three.', 'Zero one two three. Four five.'), 3);
  });

  it('credits nothing for a deletion', () => {
    assert.equal(addedWords('One two three four.', 'One four.'), 0);
    assert.equal(addedWords('One two three.', ''), 0);
  });

  it('credits one for replacing one word with another', () => {
    assert.equal(addedWords('The red door.', 'The blue door.'), 1);
  });

  it('credits nothing for markup, punctuation or case changes alone', () => {
    assert.equal(addedWords('the red door', 'The Red Door'), 0);
    assert.equal(addedWords('The red door', 'The **red** door.'), 0);
    assert.equal(addedWords('See the docs', 'See [the docs](https://example.com)'), 0);
  });

  it('credits a moved paragraph', () => {
    assert.equal(addedWords('Alpha beta.\n\nGamma delta.', 'Gamma delta.\n\nAlpha beta.'), 2);
  });

  it('credits a full rewrite of a long body without a quadratic diff', () => {
    const before = Array.from({ length: 5000 }, (_, i) => `old${i}`).join(' ');
    const after = Array.from({ length: 5000 }, (_, i) => `new${i}`).join(' ');
    const start = performance.now();
    assert.equal(addedWords(before, after), 5000);
    assert.ok(performance.now() - start < 200);
  });

  it('adds one sentence to a 10,000-word body in well under 50 ms', () => {
    const paragraph = 'The quick brown fox jumps over the lazy dog near the river bank.\n\n';
    const body = paragraph.repeat(Math.ceil(10_000 / wordCount(paragraph)));
    assert.ok(wordCount(body) >= 10_000);
    const middle = body.indexOf('\n\n', body.length / 2);
    const edited = `${body.slice(0, middle)} A brand new sentence lands here. ${body.slice(middle)}`;
    addedWords(body, edited);

    const start = performance.now();
    const added = addedWords(body, edited);
    const elapsed = performance.now() - start;

    assert.equal(added, 6);
    assert.ok(elapsed < 25, `took ${elapsed.toFixed(1)} ms`);
  });
});
