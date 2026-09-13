/**
 * The conversation under an entry, in the andrewshell.org design
 * (decision-16, TASK-84).
 *
 * The source theme draws two things below a post. Reactions are a
 * `div.reactions-section` of one `div.reaction-group` per kind — likes,
 * boosts, mentions — each a `h2.reaction-title` of the label and the count
 * beside a `div.facepile` of small round avatars, with an emoji badge and the
 * name where a reaction has no avatar. Comments are `div#comments.comments-area`
 * with a counted `h2.comments-title` over an `ol.comment-list` of
 * `li.comment.h-entry`, each an `article.comment-body` holding a
 * `footer.comment-meta`, the `div.comment-content.e-content` and, on a comment
 * left here, the Reply link; answers nest in `ol.children`. A post that has
 * comments and is no longer taking them says so.
 *
 * All of it is asserted over HTTP against the packaged theme, because the
 * markup is what a reader and a microformats parser get.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { COMMENT_FIELDS } from '../comments/submission.ts';
import { CONTACT_FIELDS } from '../contact/form.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** What the site's clock says while these tests run. */
const NOW = '2026-09-13T12:00:00Z';

/** Where the site lives, which is what a post's ActivityStreams id is built on. */
const BASE_URL = 'https://blog.example';

/** The open post everything below answers. */
const HELLO = `${BASE_URL}/2026/09/hello/`;

/** The ids of the comments the file holds, and the note the inbox logged. */
const ADA = '00000000-0000-4000-8000-000000000001';
const GRACE = '00000000-0000-4000-8000-000000000002';
const MENTION = '00000000-0000-4000-8000-000000000003';
const CLOSED_COMMENT = '00000000-0000-4000-8000-000000000004';
const NOTE = 'https://remote.example/notes/1';

/** The page a webmention came from. */
const SOURCE_PAGE = 'https://grace.example/2026/09/about-that/';

/**
 * Four documents: an open post, a closed one that has been commented on, a
 * closed one that has only been liked, and a page asking for a contact form.
 */
const CONTENT: Record<string, string> = {
  'posts/hello.md': [
    '---',
    'title: Hello',
    "date: '2026-09-10T09:00:00Z'",
    'permalink: /2026/09/hello/',
    '---',
    '',
    'Words.',
    '',
  ].join('\n'),
  'posts/closed.md': [
    '---',
    'title: Closed',
    "date: '2026-09-09T09:00:00Z'",
    'permalink: /2026/09/closed/',
    'comments: false',
    '---',
    '',
    'Words.',
    '',
  ].join('\n'),
  'posts/quiet.md': [
    '---',
    'title: Quiet',
    "date: '2026-09-08T09:00:00Z'",
    'permalink: /2026/09/quiet/',
    'comments: false',
    '---',
    '',
    'Words.',
    '',
  ].join('\n'),
  'pages/write.md': [
    '---',
    'title: Write to me',
    'permalink: /write/',
    'contact: true',
    '---',
    '',
    'Say hello.',
    '',
  ].join('\n'),
};

/** One entry of a comment file, with the fields a reader never sees left out. */
function entry(values: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name: 'Somebody', url: null, email: null, avatar: null },
    content: { markdown: '', html: '' },
    submitted: '2026-09-11T10:00:00.000Z',
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/**
 * A CMS wearing the packaged theme, with a conversation on two of its posts.
 *
 * The open post has a native comment with an answer under it, a fediverse
 * reply, a webmention mention, two likes and a boost. One liker follows the
 * site and so has an avatar; the other does not, which is the emoji badge.
 */
async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-conversation-markup-content-');
  const dataDir = await box.dir('geekity-conversation-markup-data-');

  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify({ title: 'A Site' }, null, 2),
    '_data/comments/hello.json': JSON.stringify({
      post: '/2026/09/hello/',
      comments: [
        entry({
          id: ADA,
          author: { name: 'Ada Lovelace', url: 'https://ada.example/', email: null, avatar: null },
          content: { markdown: 'Approved words.', html: '<p>Approved words.</p>' },
        }),
        entry({
          id: GRACE,
          inReplyTo: ADA,
          author: { name: 'Grace Hopper', url: null, email: null, avatar: null },
          content: { markdown: 'Answering Ada.', html: '<p>Answering Ada.</p>' },
          submitted: '2026-09-11T11:00:00.000Z',
        }),
        entry({
          id: MENTION,
          source: 'webmention',
          kind: 'mention',
          author: {
            name: 'Grace Hopper',
            url: 'https://grace.example/',
            email: null,
            avatar: 'https://grace.example/avatar.png',
          },
          content: { markdown: 'Wrote about this', html: '<p>Wrote about this</p>' },
          submitted: '2026-09-11T12:00:00.000Z',
          url: SOURCE_PAGE,
        }),
      ],
    }),
    '_data/comments/closed.json': JSON.stringify({
      post: '/2026/09/closed/',
      comments: [
        entry({
          id: CLOSED_COMMENT,
          author: { name: 'Ada Lovelace', url: null, email: null, avatar: null },
          content: { markdown: 'Said while it was open.', html: '<p>Said while it was open.</p>' },
        }),
      ],
    }),
  });

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date(NOW),
  });

  // One of the likers follows the site, so the site knows a name and an
  // avatar for them; the other is a stranger with neither.
  cms.admin.putFollower({
    username: 'ada',
    actorId: 'https://remote.example/users/ada',
    inboxId: 'https://remote.example/users/ada/inbox',
    sharedInboxId: null,
    handle: '@ada@remote.example',
    name: 'Ada Lovelace',
    iconUrl: 'https://remote.example/avatars/ada.png',
    url: 'https://remote.example/@ada',
  });

  logReply(cms, { id: NOTE, inReplyTo: HELLO, url: 'https://remote.example/@ada/1' });
  logReaction(cms, 'Like', {
    id: 'https://remote.example/likes/1',
    actor: 'https://remote.example/users/ada',
    object: HELLO,
  });
  logReaction(cms, 'Like', {
    id: 'https://remote.example/likes/2',
    actor: 'https://remote.example/users/bob',
    object: HELLO,
  });
  logReaction(cms, 'Announce', {
    id: 'https://remote.example/boosts/1',
    actor: 'https://remote.example/users/cal',
    object: HELLO,
  });
  // And one like on the closed post nobody has commented on since.
  logReaction(cms, 'Like', {
    id: 'https://remote.example/likes/3',
    actor: 'https://remote.example/users/ada',
    object: `${BASE_URL}/2026/09/quiet/`,
  });

  return cms;
}

/** Log one fediverse reply, the way the inbox logs one. */
function logReply(cms: Cms, options: { id: string; inReplyTo: string; url: string }): void {
  const actor = 'https://remote.example/users/bob';
  const activityId = `${options.id}/activity`;

  cms.admin.logInboxActivity({
    activityId,
    activityType: 'Create',
    actorId: actor,
    objectId: options.id,
    json: JSON.stringify({
      id: activityId,
      type: 'Create',
      actor,
      object: {
        id: options.id,
        type: 'Note',
        attributedTo: actor,
        content: '<p>Federated words.</p>',
        inReplyTo: options.inReplyTo,
        published: '2026-09-11T13:00:00Z',
        url: options.url,
      },
    }),
  });
}

/** Log a like or a boost of an object. */
function logReaction(
  cms: Cms,
  type: 'Like' | 'Announce',
  options: { id: string; actor: string; object: string },
): void {
  cms.admin.logInboxActivity({
    activityId: options.id,
    activityType: type,
    actorId: options.actor,
    objectId: options.object,
    json: JSON.stringify({ id: options.id, type, actor: options.actor, object: options.object }),
  });
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/**
 * The `div.reactions-section` of a page: everything from it to whatever comes
 * next, which is the comments area or the end of the page.
 *
 * Sliced rather than matched, because the section is divs inside divs and a
 * regular expression cannot count them.
 */
function reactions(html: string): string {
  const start = html.indexOf('<div class="reactions-section">');
  if (start < 0) return '';
  const rest = html.slice(start);
  const comments = rest.indexOf('<div id="comments"');
  return rest.slice(0, comments < 0 ? rest.indexOf('</main>') : comments);
}

/** One reaction group by its microformats class, up to the next group. */
function group(html: string, kind: string): string {
  const start = html.indexOf(`<div class="reaction-group ${kind}">`);
  if (start < 0) return '';
  const rest = html.slice(start + 1);
  const next = rest.indexOf('<div class="reaction-group ');
  return next < 0 ? rest : rest.slice(0, next);
}

/** The `div#comments.comments-area` of a page. */
function comments(html: string): string {
  const start = html.indexOf('<div id="comments" class="comments-area">');
  if (start < 0) return '';
  return html.slice(start, html.indexOf('</main>', start));
}

/** One comment of the list, from its `li` to the end of its article. */
function comment(html: string, id: string): string {
  const start = html.indexOf(`id="comment-${id}"`);
  if (start < 0) return '';
  return html.slice(start, html.indexOf('</article>', start));
}

describe('the reactions under a post (AC #1)', () => {
  it('groups the likes, the boosts and the mentions, each counted', async () => {
    const html = await body(await site(), '/2026/09/hello/');
    const section = reactions(html);

    assert.notEqual(section, '', `no reactions section on the page: ${html}`);
    assert.match(group(section, 'p-like'), /<h2 class="reaction-title">Likes \(2\)<\/h2>/);
    assert.match(group(section, 'p-repost'), /<h2 class="reaction-title">Boosts \(1\)<\/h2>/);
    assert.match(group(section, 'p-mention'), /<h2 class="reaction-title">Mentions \(1\)<\/h2>/);
    assert.doesNotMatch(section, /<details/, 'the disclosure groups are gone');
  });

  it('is a facepile of avatars, and a badge and a name for whoever has none', async () => {
    const html = await body(await site(), '/2026/09/hello/');
    const likes = group(reactions(html), 'p-like');

    assert.match(likes, /<div class="facepile">/, 'the likers are not a facepile');
    // The follower the site knows: a link to their profile around their photo.
    assert.match(
      likes,
      /<a class="u-url" href="https:\/\/remote\.example\/@ada"[^>]*>\s*<img class="avatar u-photo" src="https:\/\/remote\.example\/avatars\/ada\.png" alt="Ada Lovelace" width="32" height="32" loading="lazy">/,
      `the known liker is not a linked round avatar: ${likes}`,
    );
    // The stranger: the emoji badge and the only name there is for them.
    assert.match(likes, /<span class="reaction-icon" aria-hidden="true">/, 'no badge without one');
    assert.match(likes, /<span class="reaction-name">@bob@remote\.example<\/span>/);
  });

  it('points a mention at the page it came from', async () => {
    const html = await body(await site(), '/2026/09/hello/');

    assert.match(group(reactions(html), 'p-mention'), new RegExp(`href="${SOURCE_PAGE}"`));
  });

  it('prints no group for a kind nothing has', async () => {
    const html = await body(await site(), '/2026/09/quiet/');
    const section = reactions(html);

    assert.match(section, /<h2 class="reaction-title">Likes \(1\)<\/h2>/);
    assert.doesNotMatch(section, /p-repost/, 'a post nobody boosted has no boost group');
    assert.doesNotMatch(section, /p-mention/, 'and no mention group');
  });
});

describe('the comments under a post (AC #2)', () => {
  it('is a comments-area with the count and the title over the list', async () => {
    const html = await body(await site(), '/2026/09/hello/');
    const area = comments(html);

    assert.notEqual(area, '', `no comments area on the page: ${html}`);
    assert.match(
      area,
      /<h2 class="comments-title">\s*3 comments on &ldquo;<span>Hello<\/span>&rdquo;\s*<\/h2>/,
      `the title does not count the three answers: ${area}`,
    );
    assert.match(area, /<ol class="comment-list">/);
  });

  it('says One comment where there is one', async () => {
    const html = await body(await site(), '/2026/09/closed/');

    assert.match(
      comments(html),
      /One comment on &ldquo;<span>Closed<\/span>&rdquo;/,
      'a single comment is not counted in words',
    );
  });

  it('marks a comment up the way the source theme does', async () => {
    const html = await body(await site(), '/2026/09/hello/');
    const said = comment(comments(html), ADA);

    assert.match(said, /class="comment h-entry comment-comment"/, 'the item is not an h-entry');
    assert.match(said, /<article class="comment-body">/);
    assert.match(said, /<footer class="comment-meta">/);
    assert.match(said, /<div class="comment-author vcard p-author h-card">/);
    assert.match(
      said,
      /<b class="fn p-name"><a class="url u-url" href="https:\/\/ada\.example\/"[^>]*>Ada Lovelace<\/a><\/b>/,
      `the author is not a linked fn p-name: ${said}`,
    );
    assert.match(
      said,
      /<div class="comment-metadata">\s*<a class="u-url" href="[^"]*#comment-00000000-0000-4000-8000-000000000001"><time class="dt-published" datetime="2026-09-11T10:00:00\.000Z">11 September 2026<\/time><\/a>/,
      `the permalink does not wrap a dt-published time: ${said}`,
    );
    assert.match(said, /<div class="comment-content e-content">\s*<p>Approved words\.<\/p>/);
  });

  it('nests an answer in an ol.children inside what it answers', async () => {
    const area = comments(await body(await site(), '/2026/09/hello/'));

    const first = area.indexOf('Approved words.');
    const nested = area.indexOf('<ol class="children">');
    assert.ok(nested > first, `the answer is not in a children list: ${area}`);
    assert.ok(nested < area.indexOf('Answering Ada.'), 'the answer is beside rather than under');
  });

  it('offers Reply on a comment left here and on nothing else', async () => {
    const area = comments(await body(await site(), '/2026/09/hello/'));

    assert.match(
      comment(area, ADA),
      new RegExp(`<div class="reply"><a[^>]*href="/2026/09/hello/\\?reply_to=${ADA}#respond"`),
      `a comment left here has no Reply link: ${area}`,
    );
    assert.doesNotMatch(
      comment(area, NOTE),
      /class="reply"/,
      'a fediverse reply is not answered here',
    );
  });

  it('offers Reply on nothing at all once the post is closed', async () => {
    const area = comments(await body(await site(), '/2026/09/closed/'));

    assert.doesNotMatch(area, /class="reply"/, 'a closed post still offers a Reply link');
  });
});

describe('a post that has stopped taking comments (AC #3)', () => {
  it('says so when it has some', async () => {
    const area = comments(await body(await site(), '/2026/09/closed/'));

    assert.match(area, /<p class="no-comments">Comments are closed\.<\/p>/);
  });

  it('says nothing when it has none', async () => {
    const html = await body(await site(), '/2026/09/quiet/');

    assert.doesNotMatch(html, /no-comments/, 'a post nobody commented on announces nothing');
    assert.doesNotMatch(html, /comments-area/, 'and draws no comments area either');
  });

  it('says nothing on a post that is still open', async () => {
    const html = await body(await site(), '/2026/09/hello/');

    assert.doesNotMatch(html, /no-comments/, 'an open post is not closed');
  });
});

describe('the forms (AC #4)', () => {
  it('draws the comment form as a comment-respond with everything it had', async () => {
    const html = await body(await site(), '/2026/09/hello/');

    assert.match(html, /<section class="comment-respond" id="respond">/, 'not a comment-respond');
    assert.match(html, /<h2 class="comment-reply-title">Leave a comment<\/h2>/);
    for (const field of [
      COMMENT_FIELDS.post,
      COMMENT_FIELDS.loaded,
      COMMENT_FIELDS.inReplyTo,
      COMMENT_FIELDS.trap,
      COMMENT_FIELDS.name,
      COMMENT_FIELDS.email,
      COMMENT_FIELDS.url,
      COMMENT_FIELDS.body,
    ]) {
      assert.match(html, new RegExp(`name="${field}"`), `the form lost ${field}`);
    }
    assert.match(html, /class="comment-trap"/, 'the honeypot is gone');
    assert.match(html, /<p class="form-submit">/, 'the button is not in a form-submit');
  });

  it('gives the contact form the same form styling and every field', async () => {
    const html = await body(await site(), '/write/');

    assert.match(html, /class="comment-respond contact-form" id="contact"/, 'not the same form');
    for (const field of [
      CONTACT_FIELDS.page,
      CONTACT_FIELDS.loaded,
      CONTACT_FIELDS.trap,
      CONTACT_FIELDS.name,
      CONTACT_FIELDS.email,
      CONTACT_FIELDS.subject,
      CONTACT_FIELDS.message,
    ]) {
      assert.match(html, new RegExp(`name="${field}"`), `the form lost ${field}`);
    }
    assert.match(html, /class="contact-trap"/, 'the honeypot is gone');
  });
});

describe('the stylesheet (AC #5)', () => {
  it('styles the comments and the reactions the way the source theme does', async () => {
    const css = await body(await site(), '/theme/style.css');

    for (const rule of [
      '.comments-area',
      '.comments-title',
      '.comment-list',
      '.comment-list .children',
      '.comment-body',
      '.comment-author',
      '.comment-metadata',
      '.comment-content',
      '.reply',
      '.no-comments',
      '.comment-respond',
      '.reactions-section',
      '.reaction-group',
      '.reaction-title',
      '.facepile',
      '.reaction-icon',
    ]) {
      assert.ok(css.includes(`${rule} {`) || css.includes(`${rule},`), `no rule for ${rule}`);
    }
    assert.ok(!css.includes('.conversation '), 'the old conversation rules are still there');
    assert.ok(!css.includes('.comment-replies'), 'the old nested list rules are still there');
  });
});
