import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from './document.ts';
import { parseDocument } from './parser.ts';
import { discoverPostType, isNamed, postLabel, postTypeOf, replyTarget } from './post-type.ts';

function post(frontMatter: string, body: string): Document {
  return parseDocument(`---\n${frontMatter}date: 2026-09-20T09:00:00Z\n---\n\n${body}\n`, {
    path: 'posts/2026-09-20-a-post.md',
  });
}

describe('discoverPostType', () => {
  it('calls a post with a name that is not a prefix of its content an article', () => {
    assert.equal(
      discoverPostType({ name: 'On gardens', content: 'The tomatoes came in late.' }),
      'article',
    );
  });

  it('calls a post with no name a note', () => {
    assert.equal(discoverPostType({ content: 'Coffee first.' }), 'note');
  });

  it('calls a post whose name is empty or only whitespace a note', () => {
    assert.equal(discoverPostType({ name: '', content: 'Coffee first.' }), 'note');
    assert.equal(discoverPostType({ name: '  \n\t ', content: 'Coffee first.' }), 'note');
  });

  it('calls a post whose name is a prefix of its content a note', () => {
    assert.equal(
      discoverPostType({ name: 'Coffee first', content: 'Coffee first. Then the inbox.' }),
      'note',
    );
  });

  it('applies the prefix rule to characters, not words', () => {
    assert.equal(discoverPostType({ name: 'Coff', content: 'Coffee first.' }), 'note');
  });

  it('calls a name equal to the whole content a note', () => {
    assert.equal(discoverPostType({ name: 'Coffee first.', content: 'Coffee first.' }), 'note');
  });

  it('trims and collapses whitespace in the name and the content before comparing', () => {
    assert.equal(
      discoverPostType({
        name: '  Coffee \n\t first  ',
        content: '\n  Coffee   first.\n\nThen    the inbox.',
      }),
      'note',
    );
  });

  it('does not treat a name that only matches once whitespace is dropped as a prefix', () => {
    assert.equal(discoverPostType({ name: 'Coffeefirst', content: 'Coffee first.' }), 'article');
  });

  it('compares against the summary when the content is empty', () => {
    assert.equal(
      discoverPostType({ name: 'Short', content: '   ', summary: 'Short and sweet.' }),
      'note',
    );
    assert.equal(
      discoverPostType({ name: 'On gardens', content: '', summary: 'The tomatoes came in late.' }),
      'article',
    );
  });

  it('prefers the content to the summary when both are there', () => {
    assert.equal(
      discoverPostType({
        name: 'Coffee',
        content: 'Tea, actually.',
        summary: 'Coffee, it says here.',
      }),
      'article',
    );
  });

  it('calls a post with a name but neither content nor summary a note', () => {
    assert.equal(discoverPostType({ name: 'On gardens' }), 'note');
    assert.equal(discoverPostType({ name: 'On gardens', content: '', summary: ' ' }), 'note');
  });
});

describe('a reply', () => {
  const target = 'https://example.com/post';

  it('is a post whose in-reply-to is a valid URL, ahead of the note/article tail', () => {
    assert.equal(discoverPostType({ 'in-reply-to': target, content: 'Agreed.' }), 'reply');
    assert.equal(
      discoverPostType({ 'in-reply-to': target, name: 'On gardens', content: 'The tomatoes.' }),
      'reply',
    );
  });

  it('is not made by an in-reply-to that is not an http or https URL', () => {
    for (const value of [
      '',
      '   ',
      'example.com/post',
      '/2026/09/a-post/',
      'mailto:a@b.example',
      'not a url',
    ]) {
      assert.equal(discoverPostType({ 'in-reply-to': value, content: 'Agreed.' }), 'note', value);
    }
  });

  it('is still a reply with a title and a photo', () => {
    const document = post(
      `title: On gardens\nin-reply-to: ${target}\n`,
      '![Tomatoes](/uploads/2026/09/tomatoes.jpg)\n\nThe tomatoes came in late.',
    );
    assert.equal(postTypeOf(document), 'reply');
    assert.equal(isNamed(document), true);
  });

  it('is named only when its title is its own, as a note/article would be', () => {
    assert.equal(isNamed(post(`in-reply-to: ${target}\n`, 'Agreed.')), false);
    assert.equal(isNamed(post(`title: Agreed\nin-reply-to: ${target}\n`, 'Agreed.')), false);
  });

  it('names its target only when the target is a valid URL', () => {
    assert.equal(replyTarget(post(`in-reply-to: ${target}\n`, 'Agreed.')), target);
    assert.equal(replyTarget(post('in-reply-to: example.com/post\n', 'Agreed.')), undefined);
    assert.equal(replyTarget(post('', 'Agreed.')), undefined);
  });
});

describe('postTypeOf', () => {
  it('reads an untitled post as a note', () => {
    assert.equal(postTypeOf(post('', 'Coffee first.')), 'note');
  });

  it('reads a titled post as an article', () => {
    assert.equal(postTypeOf(post('title: On gardens\n', 'The tomatoes came in late.')), 'article');
  });

  it('compares the title with the text of the rendered body, not its Markdown', () => {
    assert.equal(
      postTypeOf(post('title: Coffee first\n', '**Coffee** _first_. Then the [inbox](/inbox/).')),
      'note',
    );
  });

  it('falls back to the description when the body is empty', () => {
    assert.equal(postTypeOf(post('title: Short\ndescription: Short and sweet.\n', '')), 'note');
  });
});

describe('postLabel', () => {
  it('is the title of a post that has one', () => {
    assert.equal(postLabel(post('title: On gardens\n', 'The tomatoes.')), 'On gardens');
  });

  it('is the whole text of a short untitled post', () => {
    assert.equal(postLabel(post('', 'Coffee **first**.')), 'Coffee first.');
  });

  it('cuts a long untitled post to its first words', () => {
    assert.equal(
      postLabel(post('', 'One two three four five six seven eight nine ten eleven twelve.')),
      'One two three four five six seven eight nine ten …',
    );
  });
});
