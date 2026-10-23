import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convert } from '../src/index.ts';

const lines = (...text: string[]): string => `${text.join('\n')}\n`;

describe('headings', () => {
  it('keeps the first three levels and clamps deeper ones to ###', () => {
    assert.equal(
      convert('# One\n\n## Two\n\n### Three\n\n#### Four\n\n###### Six\n\nSetext\n------'),
      lines('# One', '', '## Two', '', '### Three', '', '### Four', '', '### Six', '', '## Setext'),
    );
  });
});

describe('inline markup', () => {
  const markdown = 'Some *em*, _also_, **strong**, ~~gone~~ and `code`.';

  it('is kept by default', () => {
    assert.equal(convert(markdown), lines(markdown));
  });

  it('is removed with the plain option', () => {
    assert.equal(
      convert(markdown, { plain: true }),
      lines('Some em, also, strong, gone and code.'),
    );
  });

  it('turns a hard line break into a new line', () => {
    assert.equal(convert('one  \ntwo'), lines('one', 'two'));
  });
});

describe('HTML', () => {
  const markdown = 'A <b>bold</b> word.\n\n<div class="x">\nblock\n</div>\n\nAfter.';

  it('is kept by default', () => {
    assert.equal(
      convert(markdown),
      lines('A <b>bold</b> word.', '', '<div class="x">', 'block', '</div>', '', 'After.'),
    );
  });

  it('loses its inline tags with the plain option', () => {
    assert.equal(
      convert(markdown, { plain: true }),
      lines('A bold word.', '', '<div class="x">', 'block', '</div>', '', 'After.'),
    );
  });

  it('is stripped inline and as blocks with the stripHtml option', () => {
    assert.equal(convert(markdown, { stripHtml: true }), lines('A bold word.', '', 'After.'));
  });
});

describe('tables', () => {
  const table = ['| Name | Qty |', '| :--- | --: |', '| Apple | 3 |', '| *Kiwi* | 12 |'].join('\n');

  it('become a preformatted block with table alt text', () => {
    assert.equal(
      convert(table, { plain: true }),
      lines(
        '```table',
        '┌───────┬─────┐',
        '│ Name  │ Qty │',
        '╞═══════╪═════╡',
        '│ Apple │   3 │',
        '│ Kiwi  │  12 │',
        '└───────┴─────┘',
        '```',
      ),
    );
  });

  it('take their alt text from the tableTag option', () => {
    assert.match(convert(table, { tableTag: '' }), /^```\n┌/);
    assert.match(convert(table, { tableTag: 'stock' }), /^```stock\n┌/);
  });

  it('centre a centred column and list the links of their cells after the table', () => {
    assert.equal(
      convert('| a |\n| :-: |\n| [x](/x/) |\n| wide cell |'),
      lines(
        '```table',
        '┌───────────┐',
        '│     a     │',
        '╞═══════════╡',
        '│   x[1]    │',
        '│ wide cell │',
        '└───────────┘',
        '```',
        '',
        '=> /x/ 1: /x/',
      ),
    );
  });
});

describe('code', () => {
  it('keeps a fenced block with its language as alt text', () => {
    assert.equal(
      convert('```js\nconst a = 1;\n\nconst b = 2;\n```'),
      lines('```js', 'const a = 1;', '', 'const b = 2;', '```'),
    );
  });

  it('gives a block without a language the codeTag alt text', () => {
    assert.equal(convert('```\nx\n```'), lines('```', 'x', '```'));
    assert.equal(convert('    indented', { codeTag: 'code' }), lines('```code', 'indented', '```'));
  });
});

describe('images', () => {
  it('become => lines with their alt text and an image marker', () => {
    assert.equal(convert('![A cat](/cat.jpg)'), lines('=> /cat.jpg A cat [IMG]'));
  });

  it('take their marker from the imageTag option', () => {
    assert.equal(convert('![A cat](/cat.jpg)', { imageTag: '' }), lines('=> /cat.jpg A cat'));
    assert.equal(convert('![](/cat.jpg)', { imageTag: '(image)' }), lines('=> /cat.jpg (image)'));
  });

  it('break the paragraph they sit in', () => {
    assert.equal(
      convert('Look ![cat](/c.jpg) here.'),
      lines('Look', '=> /c.jpg cat [IMG]', 'here.'),
    );
  });

  it('keep the link around them as a second line', () => {
    assert.equal(
      convert('[![A cat](/small.jpg)](/large.jpg)'),
      lines('=> /small.jpg A cat [IMG]', '=> /large.jpg A cat'),
    );
  });
});

describe('blockquotes', () => {
  it('become > lines', () => {
    assert.equal(
      convert('> Quoted\n> text\n>\n> more\n>\n> > nested'),
      lines('> Quoted text', '>', '> more', '>', '> > nested'),
    );
  });
});

describe('lists', () => {
  it('flatten nesting with indentation', () => {
    assert.equal(
      convert('- one\n  - two\n    - three\n- four'),
      lines('* one', '  * two', '    * three', '* four'),
    );
  });

  it('take their indentation from the indent option', () => {
    assert.equal(convert('- one\n  - two', { indent: '\t' }), lines('* one', '\t* two'));
  });

  it('number ordered items as text', () => {
    assert.equal(convert('3. c\n4. d\n   1. inner'), lines('3. c', '4. d', '  1. inner'));
  });

  it('indent a second paragraph of an item', () => {
    assert.equal(convert('- first\n\n  second\n- next'), lines('* first', '  second', '* next'));
  });

  it('draw GFM checklist boxes', () => {
    assert.equal(convert('- [ ] todo\n- [x] done'), lines('* ☐ todo', '* ☑ done'));
  });

  it('leave checklist boxes as written when checklist is off', () => {
    assert.equal(
      convert('- [ ] todo\n- [x] done', { checklist: false }),
      lines('* [ ] todo', '* [x] done'),
    );
  });
});

describe('footnotes', () => {
  it('keep their references and gather their notes at the end', () => {
    assert.equal(
      convert(
        'Text with a note.[^n] And [a link](/a/).\n\n[^n]: The note, with [another](/b/).\n\nAfter.',
      ),
      lines(
        'Text with a note.[^1] And a link[1].',
        '',
        '=> /a/ 1: /a/',
        '',
        'After.',
        '',
        '[^1]: The note, with another[2].',
        '',
        '=> /b/ 2: /b/',
      ),
    );
  });
});

describe('front matter', () => {
  const yaml = '---\ntitle: Hello\n---\n\n# Hi';
  const toml = '+++\ntitle = "Hello"\n+++\n\n# Hi';

  it('is stripped when asked', () => {
    assert.equal(convert(yaml, { stripFrontMatter: true }), lines('# Hi'));
    assert.equal(convert(toml, { stripFrontMatter: true }), lines('# Hi'));
  });

  it('is left to the Markdown parser otherwise', () => {
    assert.notEqual(convert(yaml), lines('# Hi'));
  });
});

describe('thematic breaks', () => {
  it('become a line of dashes', () => {
    assert.equal(convert('a\n\n***\n\nb'), lines('a', '', '---', '', 'b'));
  });
});
