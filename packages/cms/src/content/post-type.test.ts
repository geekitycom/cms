import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CitedPage } from './citation.ts';
import type { Document } from './document.ts';
import { parseDocument } from './parser.ts';
import { discoverPostType, postLabel, postTypeOf, replyTarget, showsTitle } from './post-type.ts';

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
    assert.equal(showsTitle(document), true);
  });

  it('shows its title only when the title is its own, as a note/article would', () => {
    assert.equal(showsTitle(post(`in-reply-to: ${target}\n`, 'Agreed.')), false);
    assert.equal(showsTitle(post(`title: Agreed\nin-reply-to: ${target}\n`, 'Agreed.')), false);
  });

  it('names its target only when the target is a valid URL', () => {
    assert.equal(replyTarget(post(`in-reply-to: ${target}\n`, 'Agreed.')), target);
    assert.equal(replyTarget(post('in-reply-to: example.com/post\n', 'Agreed.')), undefined);
    assert.equal(replyTarget(post('', 'Agreed.')), undefined);
  });
});

describe('a photo post (AC #3)', () => {
  const target = 'https://example.com/post';

  it('is a post with a photo and no name, ahead of the note/article tail', () => {
    assert.equal(discoverPostType({ photo: ['/uploads/a.jpg'] }), 'photo');
    assert.equal(
      discoverPostType({ photo: ['/uploads/a.jpg'], content: 'At the beach.' }),
      'photo',
    );
  });

  it('is not made by an empty photo list', () => {
    assert.equal(discoverPostType({ photo: [], content: 'At the beach.' }), 'note');
  });

  it('gives way to a reply, which comes first in the spec’s order', () => {
    assert.equal(
      discoverPostType({ 'in-reply-to': target, photo: ['/uploads/a.jpg'], content: 'Same.' }),
      'reply',
    );
    assert.equal(
      postTypeOf(post(`in-reply-to: ${target}\nphoto:\n  - url: /uploads/a.jpg\n`, 'Same.')),
      'reply',
    );
  });

  it('reads the photo key of a document', () => {
    assert.equal(postTypeOf(post('photo:\n  - url: /uploads/a.jpg\n    alt: A\n', '')), 'photo');
    assert.equal(postTypeOf(post('photo:\n  - url: not-a-url\n', 'Words.')), 'note');
  });
});

describe('a repost, a like and a bookmark (TASK-169 AC #2)', () => {
  const target = 'https://example.com/post';
  const other = 'https://example.org/elsewhere';

  it('types a post by each citation of a valid URL', () => {
    assert.equal(discoverPostType({ 'repost-of': target }), 'repost');
    assert.equal(discoverPostType({ 'like-of': target }), 'like');
    assert.equal(discoverPostType({ 'bookmark-of': target, content: 'Read later.' }), 'bookmark');
  });

  it('is not made by a citation that is not an http or https URL', () => {
    assert.equal(discoverPostType({ 'like-of': 'not a url', content: 'Hm.' }), 'note');
    assert.equal(discoverPostType({ 'repost-of': 'mailto:a@example.com', content: 'Hm.' }), 'note');
    assert.equal(discoverPostType({ 'bookmark-of': 'ftp://x.example/', content: 'Hm.' }), 'note');
  });

  it('follows the spec’s order: repost, then like, then reply, then photo', () => {
    const everything = {
      'repost-of': target,
      'like-of': other,
      'in-reply-to': target,
      photo: ['/uploads/a.jpg'],
      'bookmark-of': other,
      name: 'A title',
      content: 'Some words.',
    };
    assert.equal(discoverPostType(everything), 'repost');
    assert.equal(discoverPostType({ ...everything, 'repost-of': undefined }), 'like');
    assert.equal(
      discoverPostType({ ...everything, 'repost-of': undefined, 'like-of': undefined }),
      'reply',
    );
  });

  it('puts bookmark, which the spec does not type, after photo and ahead of the tail', () => {
    assert.equal(discoverPostType({ 'bookmark-of': target, photo: ['/uploads/a.jpg'] }), 'photo');
    assert.equal(discoverPostType({ 'bookmark-of': target, 'in-reply-to': other }), 'reply');
    assert.equal(
      discoverPostType({ 'bookmark-of': target, name: 'On gardens', content: 'Tomatoes.' }),
      'bookmark',
    );
  });

  it('reads the citation keys of a document', () => {
    assert.equal(postTypeOf(post(`like-of: ${target}\n`, '')), 'like');
    assert.equal(postTypeOf(post(`repost-of: ${target}\n`, '')), 'repost');
    assert.equal(postTypeOf(post(`bookmark-of: ${target}\n`, 'Worth a read.')), 'bookmark');
    assert.equal(postTypeOf(post('like-of: somewhere\n', 'Words.')), 'note');
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

describe('showsTitle (TASK-256)', () => {
  const target = 'https://example.com/post';

  for (const [kind, key] of [
    ['repost', 'repost-of'],
    ['like', 'like-of'],
    ['bookmark', 'bookmark-of'],
  ] as const) {
    it(`shows the title of a titled ${kind} with no words, and keeps its type`, () => {
      const document = post(`title: Scientific Calculator\n${key}: ${target}\n`, '');
      assert.equal(showsTitle(document), true);
      assert.equal(postTypeOf(document), kind);
    });
  }

  it('shows the title of a titled note with no words, still typed a note', () => {
    const document = post('title: Scientific Calculator\n', '');
    assert.equal(showsTitle(document), true);
    assert.equal(postTypeOf(document), 'note');
  });

  it('shows no title a post does not have', () => {
    assert.equal(showsTitle(post(`repost-of: ${target}\n`, '')), false);
    assert.equal(showsTitle(post('title: "  "\n', 'Coffee first.')), false);
  });

  it('shows no title that only repeats the opening words', () => {
    const document = post('title: Coffee first\n', '**Coffee** _first_. Then the inbox.');
    assert.equal(showsTitle(document), false);
    assert.equal(postTypeOf(document), 'note');
    assert.equal(showsTitle(post('title: Short\ndescription: Short and sweet.\n', '')), false);
  });

  it('shows a title of its own over words', () => {
    assert.equal(showsTitle(post('title: On gardens\n', 'The tomatoes came in late.')), true);
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

describe('postLabel of a post with no title and no words (TASK-261)', () => {
  const target = 'https://www.youtube.com/watch?v=abc';
  const named = { name: 'RuneScape: 4th MMO teaser' };
  const stored =
    (context: CitedPage) =>
    (url: string): CitedPage | undefined =>
      url === target ? context : undefined;

  it('is the verb and the cited title of a like, repost, bookmark or reply', () => {
    const cases: [string, string][] = [
      [`like-of: ${target}\n`, 'Liked RuneScape: 4th MMO teaser'],
      [`repost-of: ${target}\n`, 'Reposted RuneScape: 4th MMO teaser'],
      [`bookmark-of: ${target}\n`, 'Bookmarked RuneScape: 4th MMO teaser'],
      [`in-reply-to: ${target}\n`, 'Reply to RuneScape: 4th MMO teaser'],
    ];
    for (const [frontMatter, label] of cases) {
      assert.equal(postLabel(post(frontMatter, ''), stored(named)), label);
    }
  });

  it('names the host the way the citation line does when nothing was fetched', () => {
    assert.equal(postLabel(post(`like-of: ${target}\n`, '')), 'Liked a page on www.youtube.com');
    assert.equal(
      postLabel(post(`repost-of: ${target}\n`, ''), stored({ picture: { kind: 'photo' } })),
      'Reposted an image from www.youtube.com',
    );
    assert.equal(
      postLabel(post(`bookmark-of: ${target}\n`, ''), stored({ author: { name: 'Jagex' } })),
      'Bookmarked a post by Jagex',
    );
  });

  it('labels a photo post with no words and no alt text Photo', () => {
    assert.equal(postLabel(post('photo: /uploads/2026/10/a.jpg\n', '')), 'Photo');
  });

  it('labels a photo post with no words by its first photo’s alt text (TASK-264)', () => {
    const photos = (first: string): string =>
      `photo:\n  - ${first}\n  - url: /uploads/2026/10/b.jpg\n    alt: The second one\n`;
    assert.equal(postLabel(post(photos('url: /uploads/2026/10/a.jpg\n    alt: Greg'), '')), 'Greg');
    assert.equal(
      postLabel(
        post(
          photos(
            'url: /uploads/2026/10/a.jpg\n    alt: One two three four five six seven eight nine ten eleven',
          ),
          '',
        ),
      ),
      'One two three four five six seven eight nine ten …',
    );
    assert.equal(postLabel(post(photos('/uploads/2026/10/a.jpg'), '')), 'Photo');
    assert.equal(postLabel(post(photos("url: /uploads/2026/10/a.jpg\n    alt: ' '"), '')), 'Photo');
  });

  it('keeps the first words of a like that has them', () => {
    assert.equal(postLabel(post(`like-of: ${target}\n`, 'So good.'), stored(named)), 'So good.');
  });

  it('keeps Untitled for a post with nothing to name it by', () => {
    assert.equal(postLabel(post('', '')), 'Untitled');
  });
});

describe('a read (TASK-229)', () => {
  const target = 'https://them.example/2026/09/their-post/';

  it('calls a post with read-of and a known read-status a read', () => {
    assert.equal(
      discoverPostType({ 'read-of': 'The Left Hand of Darkness', 'read-status': 'to-read' }),
      'read',
    );
    assert.equal(discoverPostType({ 'read-of': 'A Book', 'read-status': 'abandoned' }), 'note');
    assert.equal(discoverPostType({ 'read-status': 'finished', content: 'Done.' }), 'note');
  });

  it('puts read after photo and ahead of bookmark and the tail', () => {
    const read = { 'read-of': 'A Book', 'read-status': 'reading' } as const;
    assert.equal(discoverPostType({ ...read, photo: ['/uploads/a.jpg'] }), 'photo');
    assert.equal(discoverPostType({ ...read, 'in-reply-to': target }), 'reply');
    assert.equal(discoverPostType({ ...read, 'bookmark-of': target }), 'read');
    assert.equal(discoverPostType({ ...read, name: 'On books', content: 'Pages.' }), 'read');
  });

  it('reads both from the front matter', () => {
    assert.equal(
      postTypeOf(post('read-of:\n  name: A Book\n  author: Someone\nread-status: finished\n', '')),
      'read',
    );
  });
});

describe('an RSVP (TASK-198 AC #3)', () => {
  const event = 'https://events.example/2026/10/indieweb-camp';

  it('is a post with a valid rsvp value, ahead of everything else the spec types', () => {
    for (const rsvp of ['yes', 'no', 'maybe', 'interested']) {
      assert.equal(discoverPostType({ rsvp, 'in-reply-to': event }), 'rsvp');
    }
    assert.equal(
      discoverPostType({
        rsvp: 'yes',
        'in-reply-to': event,
        'repost-of': event,
        'like-of': event,
        photo: ['/uploads/a.jpg'],
        name: 'A title',
        content: 'Some words.',
      }),
      'rsvp',
    );
  });

  it('is not made by a value the spec does not list', () => {
    assert.equal(discoverPostType({ rsvp: 'perhaps', 'in-reply-to': event }), 'reply');
    assert.equal(discoverPostType({ rsvp: '', 'in-reply-to': event }), 'reply');
  });

  it('reads the rsvp key of a document, in any case', () => {
    assert.equal(postTypeOf(post(`in-reply-to: ${event}\nrsvp: maybe\n`, '')), 'rsvp');
    assert.equal(postTypeOf(post(`in-reply-to: ${event}\nrsvp: Yes\n`, '')), 'rsvp');
    assert.equal(postTypeOf(post(`in-reply-to: ${event}\nrsvp: true\n`, 'Hm.')), 'reply');
  });

  it('is labelled after the event when it has no words', () => {
    const rsvp = post(`in-reply-to: ${event}\nrsvp: yes\n`, '');
    assert.equal(
      postLabel(rsvp, () => ({ name: 'IndieWeb Camp' })),
      'Going to IndieWeb Camp',
    );
    assert.equal(postLabel(rsvp), 'Going to a page on events.example');
  });
});
