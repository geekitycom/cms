import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convert, type LinkMode } from '../src/index.ts';

const lines = (...text: string[]): string => `${text.join('\n')}\n`;

// md2gemini's README shows every link mode converting this text.
const twoParagraphs = [
  'This is a paragraph with an [inline](https://example.com) link.',
  'Here is [another](https://example.org/) link, part of the same paragraph.',
  '',
  'This is a second paragraph, with a different [link](https://duck.com) in it.',
].join('\n');

describe('link modes', () => {
  it('numbers links and lists them after their paragraph by default', () => {
    assert.equal(
      convert(twoParagraphs),
      lines(
        'This is a paragraph with an inline[1] link. Here is another[2] link, part of the same paragraph.',
        '',
        '=> https://example.com 1: https://example.com',
        '=> https://example.org/ 2: https://example.org/',
        '',
        'This is a second paragraph, with a different link[3] in it.',
        '',
        '=> https://duck.com 3: https://duck.com',
      ),
    );
  });

  it('numbers links and lists them all at the end in at-end mode', () => {
    assert.equal(
      convert(twoParagraphs, { links: 'at-end' }),
      lines(
        'This is a paragraph with an inline[1] link. Here is another[2] link, part of the same paragraph.',
        '',
        'This is a second paragraph, with a different link[3] in it.',
        '',
        '=> https://example.com 1: https://example.com',
        '=> https://example.org/ 2: https://example.org/',
        '=> https://duck.com 3: https://duck.com',
      ),
    );
  });

  it('keeps the text and repeats it as the label after the paragraph in copy mode', () => {
    assert.equal(
      convert(twoParagraphs, { links: 'copy' }),
      lines(
        'This is a paragraph with an inline link. Here is another link, part of the same paragraph.',
        '',
        '=> https://example.com inline',
        '=> https://example.org/ another',
        '',
        'This is a second paragraph, with a different link in it.',
        '',
        '=> https://duck.com link',
      ),
    );
  });

  it('breaks the paragraph around each link in newline mode', () => {
    assert.equal(
      convert(twoParagraphs, { links: 'newline' }),
      lines(
        'This is a paragraph with an',
        '=> https://example.com inline',
        'link.',
        'Here is',
        '=> https://example.org/ another',
        'link, part of the same paragraph.',
        '',
        'This is a second paragraph, with a different',
        '=> https://duck.com link',
        'in it.',
      ),
    );
  });

  it('keeps only the link text in off mode', () => {
    assert.equal(
      convert(twoParagraphs, { links: 'off' }),
      lines(
        'This is a paragraph with an inline link. Here is another link, part of the same paragraph.',
        '',
        'This is a second paragraph, with a different link in it.',
      ),
    );
  });

  it('lists the links of a list, a quote and a heading after the whole block', () => {
    const markdown = [
      '## See [the docs](/docs/)',
      '',
      '- one [a](/a/) and [b](/b/)',
      '- two',
      '',
      '> quoted [c](/c/)',
    ].join('\n');
    assert.equal(
      convert(markdown),
      lines(
        '## See the docs[1]',
        '',
        '=> /docs/ 1: /docs/',
        '',
        '* one a[2] and b[3]',
        '* two',
        '',
        '=> /a/ 2: /a/',
        '=> /b/ 3: /b/',
        '',
        '> quoted c[4]',
        '',
        '=> /c/ 4: /c/',
      ),
    );
  });

  it('keeps the text in newline mode where a line cannot break, and lists the link after the block', () => {
    assert.equal(
      convert('## See [the docs](/docs/)\n\n> A ![cat](/c.jpg) and [more](/m/).', {
        links: 'newline',
      }),
      lines(
        '## See the docs',
        '',
        '=> /docs/ the docs',
        '',
        '> A and more.',
        '',
        '=> /c.jpg cat [IMG]',
        '=> /m/ more',
      ),
    );
  });

  it('applies the rewrite function to every link, image and listed link', () => {
    const markdown = [
      'Read [the page](/about/index.md) and [elsewhere](https://example.com/x.md).',
      '',
      '![A cat](/cat.md)',
      '',
      '- [Post](/post/index.md)',
    ].join('\n');
    const rewriteLink = (url: string) => (url.startsWith('/') ? url.replace(/\.md$/, '.gmi') : url);
    assert.equal(
      convert(markdown, { rewriteLink }),
      lines(
        'Read the page[1] and elsewhere[2].',
        '',
        '=> /about/index.gmi 1: /about/index.gmi',
        '=> https://example.com/x.md 2: https://example.com/x.md',
        '',
        '=> /cat.gmi A cat [IMG]',
        '',
        '=> /post/index.gmi Post',
      ),
    );
  });

  it('turns a bare URL into a link, as the site does', () => {
    assert.equal(
      convert('See https://example.com for more.'),
      lines(
        'See https://example.com[1] for more.',
        '',
        '=> https://example.com 1: https://example.com',
      ),
    );
  });
});

describe('a list of links', () => {
  const archive = [
    '- [First post](/a/) 2026-10-01',
    '- [Second post](/b/) — a short note',
    '- 2026-09-01 [Third](/c/)',
  ].join('\n');

  for (const mode of ['paragraph', 'at-end', 'copy', 'newline'] satisfies LinkMode[]) {
    it(`becomes plain => lines in ${mode} mode`, () => {
      assert.equal(
        convert(archive, { links: mode }),
        lines(
          '=> /a/ First post 2026-10-01',
          '=> /b/ Second post — a short note',
          '=> /c/ 2026-09-01 Third',
        ),
      );
    });
  }

  it('stays a list of text in off mode', () => {
    assert.equal(
      convert(archive, { links: 'off' }),
      lines('* First post 2026-10-01', '* Second post — a short note', '* 2026-09-01 Third'),
    );
  });

  it('uses the URL when the link has no text', () => {
    assert.equal(
      convert('- [](https://example.com)'),
      lines('=> https://example.com https://example.com'),
    );
  });

  it('is an ordinary list when an item holds two links', () => {
    assert.equal(
      convert('- [a](/a/)\n- [b](/b/) or [c](/c/)'),
      lines('* a[1]', '* b[2] or c[3]', '', '=> /a/ 1: /a/', '=> /b/ 2: /b/', '=> /c/ 3: /c/'),
    );
  });

  it('is an ordinary list when an item has text beyond a short note', () => {
    const long =
      'a note that runs on well past a date or a few words of description into a sentence';
    assert.equal(
      convert(`- [a](/a/)\n- [b](/b/) ${long}`),
      lines('* a[1]', `* b[2] ${long}`, '', '=> /a/ 1: /a/', '=> /b/ 2: /b/'),
    );
  });

  it('is an ordinary list when an item has no link', () => {
    assert.equal(convert('- [a](/a/)\n- plain'), lines('* a[1]', '* plain', '', '=> /a/ 1: /a/'));
  });
});

describe('a paragraph that is one link', () => {
  it('becomes a link line labelled with its text in every mode but off', () => {
    for (const mode of ['paragraph', 'at-end', 'copy', 'newline'] satisfies LinkMode[]) {
      assert.equal(
        convert('[Written by Ada](/author/ada/)', { links: mode }),
        lines('=> /author/ada/ Written by Ada'),
      );
    }
  });

  it('stays text in off mode', () => {
    assert.equal(
      convert('[Written by Ada](/author/ada/)', { links: 'off' }),
      lines('Written by Ada'),
    );
  });

  it('is an ordinary paragraph when it has text beside the link', () => {
    assert.equal(
      convert('By [Ada](/author/ada/)'),
      lines('By Ada[1]', '', '=> /author/ada/ 1: /author/ada/'),
    );
  });
});

describe('a Markdown file with no links', () => {
  const markdown = '# Title\n\nJust text, *nothing* to follow.\n\n- one\n- two';

  for (const mode of ['paragraph', 'at-end', 'copy', 'newline', 'off'] satisfies LinkMode[]) {
    it(`converts the same way in ${mode} mode`, () => {
      assert.equal(
        convert(markdown, { links: mode }),
        lines('# Title', '', 'Just text, *nothing* to follow.', '', '* one', '* two'),
      );
    });
  }

  it('converts empty input to nothing', () => {
    assert.equal(convert(''), '');
  });
});
