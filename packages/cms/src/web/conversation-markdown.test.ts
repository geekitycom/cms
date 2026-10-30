/**
 * A post's and a page's conversation in their Markdown (TASK-476): the
 * replies threaded as the HTML threads them, the likes, boosts and mentions,
 * and where the comment and contact forms are, linked to the HTML page.
 *
 * Asserted over HTTP against the packaged theme, from the same comment file
 * and inbox the HTML tests in `conversation-markup.test.ts` read.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { shared } from './__testing__/shared.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-13T12:00:00Z';
const BASE_URL = 'https://blog.example';
const HELLO = `${BASE_URL}/2026/09/hello/`;

const ADA = '0000000000000001';
const GRACE = '0000000000000002';
const MENTION = '0000000000000003';
const CLOSED_COMMENT = '0000000000000004';
const HELD = '0000000000000005';
const UNDER_HELD = '0000000000000006';
const PENDING = '0000000000000007';
const SPAM = '0000000000000008';
const WEBMENTION_REPLY = '0000000000000009';

const NOTE = 'https://remote.example/notes/1';
const WITHDRAWN = 'https://remote.example/notes/2';

function document(file: string, lines: readonly string[]): Record<string, string> {
  return { [file]: ['---', ...lines, '---', '', 'Words.', ''].join('\n') };
}

const CONTENT: Record<string, string> = {
  ...document('posts/hello.md', [
    'title: Hello',
    "date: '2026-09-10T09:00:00Z'",
    'permalink: /2026/09/hello/',
  ]),
  ...document('posts/closed.md', [
    'title: Closed',
    "date: '2026-09-09T09:00:00Z'",
    'permalink: /2026/09/closed/',
    'comments: false',
  ]),
  ...document('posts/quiet.md', [
    'title: Quiet',
    "date: '2026-09-08T09:00:00Z'",
    'permalink: /2026/09/quiet/',
  ]),
  ...document('pages/write.md', ['title: Write to me', 'permalink: /write/', 'contact: true']),
};

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

function said(html: string): { markdown: string; html: string } {
  return { markdown: html, html };
}

const COMMENTS = {
  post: '/2026/09/hello/',
  comments: [
    entry({
      id: ADA,
      author: { name: 'Ada [Lovelace]', url: 'https://ada.example/', email: null, avatar: null },
      content: said(
        '<p>Approved <em>words</em>.</p>\n<p>A second <a href="https://ada.example/x" rel="nofollow ugc">paragraph</a>.</p>',
      ),
    }),
    entry({
      id: GRACE,
      inReplyTo: ADA,
      author: { name: 'Grace Hopper', url: null, email: null, avatar: null },
      content: said('<p>Answering Ada.</p>'),
      submitted: '2026-09-11T11:00:00.000Z',
    }),
    entry({
      id: HELD,
      status: 'pending',
      author: { name: 'Held Back', url: null, email: null, avatar: null },
      content: said('<p>Held words.</p>'),
      submitted: '2026-09-11T10:30:00.000Z',
    }),
    entry({
      id: UNDER_HELD,
      inReplyTo: HELD,
      content: said('<p>Under a held one.</p>'),
      submitted: '2026-09-11T10:45:00.000Z',
    }),
    entry({
      id: PENDING,
      status: 'pending',
      author: { name: 'Pending Person', url: null, email: null, avatar: null },
      content: said('<p>Pending words.</p>'),
    }),
    entry({
      id: SPAM,
      status: 'spam',
      author: { name: 'Spammer', url: 'https://spam.example/', email: null, avatar: null },
      content: said('<p>Spam words.</p>'),
    }),
    entry({
      id: MENTION,
      source: 'webmention',
      kind: 'mention',
      author: { name: 'Grace Hopper', url: 'https://grace.example/', email: null, avatar: null },
      content: said('<p>Wrote about this</p>'),
      submitted: '2026-09-11T12:00:00.000Z',
      url: 'https://grace.example/2026/09/about-that/',
    }),
    entry({
      id: WEBMENTION_REPLY,
      source: 'webmention',
      author: { name: 'Grace Hopper', url: 'https://grace.example/', email: null, avatar: null },
      content: said('<p>Replied from my site.</p>'),
      submitted: '2026-09-11T12:30:00.000Z',
      url: 'https://grace.example/2026/09/reply/',
    }),
  ],
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

async function site(theme?: Record<string, string>): Promise<Cms> {
  const contentDir = await box.dir('geekity-conversation-md-content-');
  const dataDir = await box.dir('geekity-conversation-md-data-');
  const themesDir = await box.dir('geekity-conversation-md-themes-');

  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify({ title: 'A Site', ...(theme ? { theme: 'mine' } : {}) }),
    '_data/comments/hello.json': JSON.stringify(COMMENTS),
    '_data/comments/closed.json': JSON.stringify({
      post: '/2026/09/closed/',
      comments: [
        entry({
          id: CLOSED_COMMENT,
          author: { name: 'Ada Lovelace', url: null, email: null, avatar: null },
          content: said('<p>Said while it was open.</p>'),
        }),
      ],
    }),
  });
  if (theme !== undefined) {
    await writeTree(path.join(themesDir, 'mine'), {
      'theme.json': JSON.stringify({ name: 'mine', kind: 'site' }),
      ...theme,
    });
  }

  const cms = await box.open({
    contentDir,
    dataDir,
    themesDir,
    baseUrl: BASE_URL,
    now: () => new Date(NOW),
  });

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

  logReply(cms, {
    id: NOTE,
    content: '<p>Federated words.</p>',
    url: 'https://remote.example/@bob/1',
  });
  logReply(cms, {
    id: WITHDRAWN,
    content: '<p>Withdrawn words.</p>',
    url: 'https://remote.example/@bob/2',
  });
  cms.admin.logInboxActivity({
    activityId: 'https://remote.example/deletes/1',
    activityType: 'Delete',
    actorId: 'https://remote.example/users/bob',
    objectId: WITHDRAWN,
    json: JSON.stringify({
      type: 'Delete',
      actor: 'https://remote.example/users/bob',
      object: { id: WITHDRAWN, type: 'Tombstone' },
    }),
  });
  logReaction(cms, 'Like', 'https://remote.example/likes/1', 'https://remote.example/users/ada');
  logReaction(cms, 'Like', 'https://remote.example/likes/2', 'https://remote.example/users/bob');
  logReaction(
    cms,
    'Announce',
    'https://remote.example/boosts/1',
    'https://remote.example/users/cal',
  );

  return cms;
}

const sharedSite = shared(site);

function logReply(cms: Cms, options: { id: string; content: string; url: string }): void {
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
        content: options.content,
        inReplyTo: HELLO,
        published: '2026-09-11T13:00:00Z',
        url: options.url,
      },
    }),
  });
}

function logReaction(cms: Cms, type: 'Like' | 'Announce', id: string, actor: string): void {
  cms.admin.logInboxActivity({
    activityId: id,
    activityType: type,
    actorId: actor,
    objectId: HELLO,
    json: JSON.stringify({ id, type, actor, object: HELLO }),
  });
}

async function get(
  cms: Cms,
  pathname: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await cms.app.request(pathname, { headers });
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response;
}

async function text(cms: Cms, pathname: string): Promise<string> {
  return (await get(cms, pathname)).text();
}

function sectionFrom(markdown: string, heading: string, end = '## Feeds'): string {
  const start = markdown.indexOf(heading);
  assert.ok(start >= 0, `no ${heading} in:\n${markdown}`);
  return markdown.slice(start, markdown.indexOf(end, start)).trim();
}

describe('the conversation in a post’s Markdown (TASK-476)', () => {
  it('threads the comments, webmentions and fediverse replies as the HTML does (AC #1, #3)', async () => {
    const cms = await site();
    const html = await text(cms, '/2026/09/hello/');
    assert.match(html, /<h2 class="comments-title">5 replies<\/h2>/);

    assert.equal(
      sectionFrom(await text(cms, '/2026/09/hello/index.md'), '## 5 replies', '## Leave a comment'),
      [
        '## 5 replies',
        '',
        `- [Ada \\[Lovelace\\]](https://ada.example/), [11 September 2026](/comment/${ADA}/index.md)`,
        '',
        '  Approved _words_.',
        '',
        '  A second [paragraph](https://ada.example/x).',
        '',
        `  - Grace Hopper, [11 September 2026](/comment/${GRACE}/index.md)`,
        '',
        '    Answering Ada.',
        '',
        '- This comment is no longer shown.',
        '',
        `  - Somebody, [11 September 2026](/comment/${UNDER_HELD}/index.md)`,
        '',
        '    Under a held one.',
        '',
        '- [Grace Hopper](https://grace.example/), [11 September 2026](https://grace.example/2026/09/reply/), via webmention',
        '',
        '  Replied from my site.',
        '',
        '- [@bob@remote.example](https://remote.example/users/bob), [11 September 2026](https://remote.example/@bob/1), via the fediverse',
        '',
        '  Federated words.',
      ].join('\n'),
    );
  });

  it('leaves out everything the HTML hides (AC #3)', async () => {
    const cms = await sharedSite();
    const markdown = await text(cms, '/2026/09/hello/index.md');
    for (const hidden of ['Held words', 'Held Back', 'Pending', 'Spam', 'Withdrawn words']) {
      assert.doesNotMatch(markdown, new RegExp(hidden), `${hidden} reached the Markdown`);
    }
  });

  it('lists the likes, boosts and mentions as the HTML’s facepiles do (AC #2)', async () => {
    const cms = await sharedSite();
    assert.equal(
      sectionFrom(await text(cms, '/2026/09/hello/index.md'), '## Likes', '## 5 replies'),
      [
        '## Likes (2)',
        '',
        '- [Ada Lovelace](https://remote.example/@ada)',
        '- [@bob@remote.example](https://remote.example/users/bob)',
        '',
        '## Boosts (1)',
        '',
        '- [@cal@remote.example](https://remote.example/users/cal)',
        '',
        '## Mentions (1)',
        '',
        '- [Grace Hopper](https://grace.example/2026/09/about-that/)',
      ].join('\n'),
    );
  });

  it('says where the comment form is and links the HTML page (AC #4)', async () => {
    const cms = await site();
    assert.equal(
      sectionFrom(await text(cms, '/2026/09/hello/index.md'), '## Leave a comment'),
      [
        '## Leave a comment',
        '',
        '[Leave a comment on the web page](https://blog.example/2026/09/hello/#respond)',
        '',
        'Or reply from your own site and send a [webmention](https://indieweb.org/Webmention).',
      ].join('\n'),
    );
    const quiet = await text(cms, '/2026/09/quiet/index.md');
    assert.match(
      quiet,
      /\[Leave a comment on the web page\]\(https:\/\/blog\.example\/2026\/09\/quiet\/#respond\)/,
    );
    assert.doesNotMatch(quiet, /## Likes|replies|One reply/);
  });

  it('says comments are closed under a closed post’s replies, and offers no form', async () => {
    const cms = await sharedSite();
    const closed = await text(cms, '/2026/09/closed/index.md');
    assert.equal(
      sectionFrom(closed, '## One reply'),
      [
        '## One reply',
        '',
        `- Ada Lovelace, [11 September 2026](/comment/${CLOSED_COMMENT}/index.md)`,
        '',
        '  Said while it was open.',
        '',
        'Comments are closed.',
      ].join('\n'),
    );
    assert.doesNotMatch(closed, /Leave a comment/);
  });

  it('says where the contact form is and links the HTML page (AC #4)', async () => {
    const cms = await sharedSite();
    assert.equal(
      sectionFrom(await text(cms, '/write/index.md'), '## Send a message'),
      [
        '## Send a message',
        '',
        '[Send a message on the web page](https://blog.example/write/#contact)',
      ].join('\n'),
    );
  });

  it('gives the conversation and the forms to both partials, so a site theme writes its own (AC #5)', async () => {
    const partial = [
      '{% for reply in conversation.replies %}r {{ reply.author.label }} {{ reply.source }} {{ reply.withheld }} {{ reply.replies.length }} {{ reply.text }}\n{% endfor %}',
      '{% for like in conversation.likes %}l {{ like.label }} {{ like.url }}\n{% endfor %}',
      'c {{ conversation.counts.replies }} {{ commentForm.url }} {{ contactForm.url }} {{ webmention }}',
    ].join('\n');
    const cms = await site({
      'partials/markdown-header.md.njk': partial,
      'partials/markdown-footer.md.njk': partial,
    });
    const parts =
      (await text(cms, '/2026/09/hello/index.md')).split('\n---\n')[1]?.split('Words.') ?? [];
    assert.equal(parts.length, 2);
    for (const part of parts) {
      assert.match(part, /^r Ada \[Lovelace\] comment {2}1 Approved _words_\.$/m);
      assert.match(part, /^r {3}true 1 $/m);
      assert.match(part, /^l Ada Lovelace https:\/\/remote\.example\/@ada$/m);
      assert.match(
        part,
        /^c 5 https:\/\/blog\.example\/2026\/09\/hello\/#respond {2}\/_geekity\/webmention$/m,
      );
    }
    const write = (await text(cms, '/write/index.md')).split('\n---\n')[1] ?? '';
    assert.match(write, /^c {3}https:\/\/blog\.example\/write\/#contact/m);
  });

  it('is a new Markdown when a reply arrives, and is never a stale 304 (caching)', async () => {
    const cms = await sharedSite();
    const first = await get(cms, '/2026/09/hello/index.md');
    const etag = first.headers.get('etag');
    assert.ok(etag !== null);
    assert.equal(first.headers.get('last-modified'), null, 'no date agrees with the conversation');

    logReply(cms, {
      id: 'https://remote.example/notes/3',
      content: '<p>Arrived later.</p>',
      url: 'https://remote.example/@bob/3',
    });

    const again = await get(cms, '/2026/09/hello/index.md', { 'if-none-match': etag });
    assert.notEqual(again.headers.get('etag'), etag);
    assert.match(await again.text(), /Arrived later\./);
    await get(cms, '/2026/09/hello/index.md', {
      'if-modified-since': new Date('2030-01-01').toUTCString(),
    });
  });
});

describe('a comment’s own page in Markdown (TASK-477)', () => {
  it('answers .md and Accept text/markdown with the comment and its place in the thread', async () => {
    const cms = await sharedSite();
    const byPath = await get(cms, `/comment/${GRACE}/index.md`);
    const byAccept = await get(cms, `/comment/${GRACE}/`, { accept: 'text/markdown' });
    for (const response of [byPath, byAccept]) {
      assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
      assert.equal(response.headers.get('vary'), 'Accept, Accept-Encoding');
    }
    const markdown = await byPath.text();
    assert.equal(await byAccept.text(), markdown);

    assert.equal(
      markdown.slice(0, markdown.indexOf('## Feeds')).trim(),
      [
        '---',
        'title: Grace Hopper on Hello',
        `permalink: /comment/${GRACE}/`,
        'author: Grace Hopper',
        'date: 2026-09-11T11:00:00.000Z',
        'home: /index.md',
        '---',
        '',
        '# Comment by Grace Hopper on Hello',
        '',
        'On [Hello](/2026/09/hello/index.md), 10 September 2026',
        '',
        '> Words.',
        '',
        `In reply to [Ada \\[Lovelace\\]](https://ada.example/), [11 September 2026](/comment/${ADA}/index.md)`,
        '',
        '> Approved _words_.',
        '>',
        '> A second [paragraph](https://ada.example/x).',
        '',
        `Grace Hopper, [11 September 2026](/comment/${GRACE}/index.md)`,
        '',
        'Answering Ada.',
        '',
        `[The whole conversation on Hello](/2026/09/hello/index.md#comment-${GRACE})`,
      ].join('\n'),
    );
  });

  it('lists the replies to the comment as the HTML does', async () => {
    const cms = await sharedSite();
    const html = await text(cms, `/comment/${ADA}/`);
    assert.match(html, /<h2 class="comments-title">Replies<\/h2>/);

    assert.equal(
      sectionFrom(
        await text(cms, `/comment/${ADA}/index.md`),
        '## Replies',
        '[The whole conversation',
      ),
      [
        '## Replies',
        '',
        `- Grace Hopper, [11 September 2026](/comment/${GRACE}/index.md)`,
        '',
        '  Answering Ada.',
      ].join('\n'),
    );
  });

  it('stands a hidden comment in the thread without its words', async () => {
    const cms = await sharedSite();
    const markdown = await text(cms, `/comment/${UNDER_HELD}/index.md`);
    assert.match(
      markdown,
      /\n> Words\.\n\nIn reply to a comment that is no longer shown\.\n\nSomebody, \[11 September 2026\]/,
    );
    assert.doesNotMatch(markdown, /Held words|Held Back/);
  });

  it('advertises its Markdown, and answers as the HTML does for a comment nobody may see', async () => {
    const cms = await sharedSite();
    const html = await get(cms, `/comment/${GRACE}/`);
    assert.equal(
      html.headers.get('link'),
      `</comment/${GRACE}/index.md>; rel="alternate"; type="text/markdown", </comment/${GRACE}/index.gmi>; rel="alternate"; type="text/gemini"`,
    );
    const markdown = await get(cms, `/comment/${GRACE}/index.md`);
    assert.equal(
      markdown.headers.get('link'),
      `</comment/${GRACE}/>; rel="alternate"; type="text/html", </comment/${GRACE}/index.gmi>; rel="alternate"; type="text/gemini"`,
    );
    assert.ok(markdown.headers.get('etag') !== null);

    for (const hidden of [PENDING, HELD, SPAM]) {
      assert.equal((await cms.app.request(`/comment/${hidden}/index.md`)).status, 404, hidden);
    }
    const refused = await cms.app.request(`/comment/${GRACE}/`, {
      headers: { accept: 'image/png' },
    });
    assert.equal(refused.status, 406);
  });
});
