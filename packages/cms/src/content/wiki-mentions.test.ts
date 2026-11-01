import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { linkMention, mentionTargetOf, unlinkedMention } from './wiki-mentions.ts';
import type { MentionTarget } from './wiki-mentions.ts';

const GABE: MentionTarget = mentionTargetOf({
  type: 'wiki',
  slug: 'gabe-newport',
  title: 'Gabe Newport',
  permalink: '/wiki/gabe-newport/',
  extra: { aliases: ['Gabe', 'The Captain'] },
});

function mentioned(body: string, target: MentionTarget = GABE): string | undefined {
  return unlinkedMention(body, target)?.text;
}

function linked(body: string, target: MentionTarget = GABE): string | undefined {
  const mention = unlinkedMention(body, target);
  return mention === undefined ? undefined : linkMention(body, mention, target);
}

describe('mentionTargetOf', () => {
  it('names the title and the aliases, and the slugs and paths they claim', () => {
    assert.deepEqual(GABE, {
      names: ['Gabe Newport', 'Gabe', 'The Captain'],
      slugs: ['gabe-newport', 'gabe', 'the-captain'],
      paths: ['/wiki/gabe-newport/', '/wiki/gabe/', '/wiki/the-captain/'],
    });
  });
});

describe('unlinkedMention', () => {
  it('finds the title or an alias as a whole word, in any case', () => {
    assert.equal(mentioned('And then Gabe fell in the well.'), 'Gabe');
    assert.equal(mentioned('and then gabe fell'), 'gabe');
    assert.equal(mentioned('THE CAPTAIN spoke.'), 'THE CAPTAIN');
    assert.equal(mentioned("Gabe's hat"), 'Gabe');
    assert.equal(mentioned('(Gabe)'), 'Gabe');
  });

  it('does not take part of a longer word', () => {
    assert.equal(mentioned('Gaben and Gabes and McGabe and Gabe_x'), undefined);
    assert.equal(mentioned('Gabé'), undefined);
  });

  it('gives the first mention with where it is', () => {
    const body = 'First line.\n\nThen Gabe, and Gabe again.';
    assert.deepEqual(unlinkedMention(body, GABE), { from: 18, to: 22, text: 'Gabe' });
  });

  it('takes the longest name where names overlap', () => {
    assert.equal(mentioned('Then Gabe Newport arrived.'), 'Gabe Newport');
    assert.equal(mentioned('Then gabe  newport arrived.'), 'gabe  newport');
  });

  it('does not run a name across a line break', () => {
    assert.equal(mentioned('Then Gabe\nNewport arrived.'), 'Gabe');
  });

  it('is nothing when the body already links to the page by its slug or an alias', () => {
    assert.equal(mentioned('[[Gabe Newport]] and Gabe.'), undefined);
    assert.equal(mentioned('[[gabe]] and Gabe.'), undefined);
    assert.equal(mentioned('[[The Captain|him]] and Gabe.'), undefined);
    assert.equal(mentioned('[[Gabe#Early life]] and Gabe.'), undefined);
    assert.equal(mentioned('[him](/wiki/gabe/) and Gabe.'), undefined);
    assert.equal(mentioned('[him](https://blog.example/wiki/gabe-newport/) and Gabe.'), undefined);
  });

  it('still counts an escaped wiki link as text', () => {
    assert.equal(mentioned('\\[[Other]] and Gabe.'), 'Gabe');
  });

  it('does not count a link to another wiki page', () => {
    assert.equal(mentioned('[[Gabriel]] and Gabe.'), 'Gabe');
  });

  describe('leaves out what is not prose', () => {
    const cases: Record<string, string> = {
      'a Markdown link': '[Gabe](https://example.com/) went.',
      'an image': '![Gabe at sea](/media/gabe.jpg) went.',
      'a reference link': '[Gabe][1] went.\n\n[1]: https://example.com/',
      'a collapsed reference link': '[Gabe][] went.\n\n[gabe]: https://example.com/',
      'a shortcut reference link': '[Gabe] went.\n\n[gabe]: https://example.com/',
      'a reference definition': '[x]: https://example.com/Gabe',
      'a wiki link to another page': '[[Gabe Smith]] went.',
      'the label of a wiki link to another page': '[[Smith|Gabe]] went.',
      'a code span': 'Run `gabe --help` now.',
      'a double-backtick code span': 'Run ``gabe ` here`` now.',
      'a fenced code block': '```\nGabe\n```\n',
      'a tilde fence': '~~~js\nconst Gabe = 1;\n~~~\n',
      'a fence in a list': '- item\n\n  ```\n  Gabe\n  ```\n',
      'an indented code block': 'Text.\n\n    Gabe\n',
      'an HTML tag': '<span title="Gabe">x</span>',
      'an HTML link': '<a href="/x">Gabe</a> went.',
      'an HTML block': '<div>\nGabe\n</div>\n',
      'an autolink': '<https://example.com/gabe>',
      'a bare URL': 'See https://example.com/gabe for more.',
      'a www address': 'See www.gabe.example for more.',
      'an email address': 'Mail gabe@example.com today.',
      'a fediverse handle': 'Follow @gabe@example.social today.',
    };
    for (const [what, body] of Object.entries(cases)) {
      it(what, () => {
        assert.equal(mentioned(body), undefined, body);
      });
    }
  });

  it('finds a mention after what it leaves out', () => {
    assert.equal(mentioned('`Gabe` and [Gabe](/x) then gabe.'), 'gabe');
    assert.deepEqual(unlinkedMention('`Gabe` and gabe', GABE), { from: 11, to: 15, text: 'gabe' });
  });

  it('counts an unclosed backtick as text', () => {
    assert.equal(mentioned('A ` and Gabe.'), 'Gabe');
  });

  it('skips a name that cannot be written inside a wiki link', () => {
    const target = mentionTargetOf({
      type: 'wiki',
      slug: 'odd',
      title: 'Odd',
      permalink: '/wiki/odd/',
      extra: { aliases: ['A|B', 'C]D'] },
    });
    assert.equal(mentioned('A|B and C]D', target), undefined);
  });
});

describe('linkMention', () => {
  it('wraps only the first mention as written and leaves the rest byte for byte', () => {
    const body = "Gabe's hat.\r\nThen GABE and Gabe Newport.  \n\n```\nGabe\n```\n";
    assert.equal(
      linked(body),
      "[[Gabe]]'s hat.\r\nThen GABE and Gabe Newport.  \n\n```\nGabe\n```\n",
    );
  });

  it('keeps the case as written', () => {
    assert.equal(linked('then the captain said'), 'then [[the captain]] said');
  });

  it('wraps the longest name', () => {
    assert.equal(linked('Then Gabe Newport arrived.'), 'Then [[Gabe Newport]] arrived.');
  });

  it('names the page when the text would lead somewhere else', () => {
    const target = mentionTargetOf({
      type: 'wiki',
      slug: 'gabe',
      title: 'Gabriel Newport',
      permalink: '/wiki/gabe/',
      extra: {},
    });
    assert.equal(
      linked('Then Gabriel Newport arrived.', target),
      'Then [[gabe|Gabriel Newport]] arrived.',
    );
  });

  it('names the page when the text has a hash in it', () => {
    const target = mentionTargetOf({
      type: 'wiki',
      slug: 'c-sharp',
      title: 'C Sharp',
      permalink: '/wiki/c-sharp/',
      extra: { aliases: ['C#'] },
    });
    assert.equal(linked('I wrote C# once.', target), 'I wrote [[c-sharp|C#]] once.');
  });
});
