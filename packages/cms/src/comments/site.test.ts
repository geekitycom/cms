import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { databaseFiles } from '../cache.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { COMMENT_FIELDS, MINIMUM_SUBMIT_SECONDS } from './submission.ts';
import type { CommentChecker, CommentSubmission, CommentVerdict } from './submission.ts';
import { COMMENT_POST_PATH } from './form.ts';
import { commentsFile, updateComment } from './records.ts';

/**
 * Comments as a reader meets them: a form under an open post, a moderation
 * queue behind it, and a page that shows what a moderator let through.
 *
 * Everything here goes through the app, because that is what the acceptance
 * criteria are about — the form being absent, the submission being refused,
 * the comment appearing — and none of those is a fact about a function.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Where the site is, so the object ids in the tests are stable. */
const BASE_URL = 'https://blog.example';

/** The post every case below comments on, dated the day before "now". */
const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

/** The moment the site's clock is stopped at. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** A CMS over one post, with the clock stopped so the closing window is testable. */
async function site(
  files: Record<string, string> = { 'posts/2026-09-19-hello-world.md': POST },
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await temporaryDir('geekity-comment-content-');
  const dataDir = await temporaryDir('geekity-comment-data-');

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const instance = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir, dataDir };
}

/** One submitted form, with everything a valid submission needs. */
function submission(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [COMMENT_FIELDS.post]: 'hello-world',
    [COMMENT_FIELDS.name]: 'Ada Lovelace',
    [COMMENT_FIELDS.email]: 'ada@example.com',
    [COMMENT_FIELDS.url]: 'https://ada.example/',
    [COMMENT_FIELDS.body]: 'Good post. See <https://example.com/x>.',
    [COMMENT_FIELDS.inReplyTo]: '',
    [COMMENT_FIELDS.trap]: '',
    // Long enough ago to be a form somebody actually filled in.
    [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
    ...overrides,
  };
}

/** Post a comment form. */
async function submit(cms: Cms, fields: Record<string, string>): Promise<Response> {
  return await cms.app.request(COMMENT_POST_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Approve a comment the way the moderation screen does. */
async function approve(cms: Cms, id: string): Promise<void> {
  await updateComment({ admin: cms.admin, contentDir: cms.config.contentDir }, id, {
    status: 'approved',
  });
}

/** The post's page as HTML. */
async function postPage(cms: Cms, query = ''): Promise<string> {
  const response = await cms.app.request(`/2026/09/hello-world/${query}`);
  assert.equal(response.status, 200);
  return await response.text();
}

describe('the comment form', () => {
  it('is under an open post, with a honeypot nobody can see', async () => {
    const { cms } = await site();

    const html = await postPage(cms);

    assert.match(html, /id="respond"/);
    assert.match(html, new RegExp(`action="${COMMENT_POST_PATH}"`));
    assert.match(html, new RegExp(`name="${COMMENT_FIELDS.trap}"`));
    assert.match(html, /class="comment-trap"/);
  });

  it('is absent from a page, which is standing content', async () => {
    const { cms } = await site({ 'pages/about.md': '---\ntitle: About\n---\n\nMe.\n' });

    const response = await cms.app.request('/about/');
    assert.ok(!(await response.text()).includes('id="respond"'), 'no form on a page');
  });
});

describe('leaving a comment', () => {
  it('holds it for a moderator, and shows it once approved', async () => {
    const { cms, contentDir } = await site();

    const posted = await submit(cms, submission());
    assert.equal(posted.status, 303);
    assert.match(posted.headers.get('location') ?? '', /\?comment=pending#respond$/);

    // Held: on the page it is not, in the file and the index it is.
    assert.ok(!(await postPage(cms)).includes('Good post.'), 'a pending comment is not shown');
    const held = cms.admin.listComments({ status: 'pending' });
    assert.equal(held.length, 1);
    assert.equal(held[0]?.author.name, 'Ada Lovelace');

    // The reader was told what happened.
    assert.match(await postPage(cms, '?comment=pending'), /waiting to be approved/);

    // Approved, it is on the page, threaded into the conversation, and the
    // email it was left with is nowhere near it.
    await approve(cms, held[0]?.id ?? '');
    const html = await postPage(cms);
    assert.match(html, /Good post\./);
    assert.match(html, /<div id="comments" class="comments-area">/);
    assert.ok(!html.includes('ada@example.com'), 'the email is never shown');

    // And the file says the same thing, because the file is the comment.
    const stored = JSON.parse(await readFile(commentsFile(contentDir, 'hello-world'), 'utf8')) as {
      post: string;
      comments: { status: string; author: { email: string } }[];
    };
    assert.equal(stored.post, '/2026/09/hello-world/');
    assert.equal(stored.comments[0]?.status, 'approved');
    assert.equal(stored.comments[0]?.author.email, 'ada@example.com');
  });

  it('renders the comment from Markdown, with no HTML and every link marked', async () => {
    const { cms } = await site();
    await submit(
      cms,
      submission({
        [COMMENT_FIELDS.body]:
          '**Nice.** <script>alert(1)</script> [a link](https://example.com/x)',
      }),
    );
    const held = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, held?.id ?? '');

    const html = await postPage(cms);

    assert.match(html, /<strong>Nice\.<\/strong>/);
    // The script the commenter typed is words on the page rather than markup.
    assert.ok(!html.includes('<script>alert(1)'), 'nothing was rendered as a script');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /<a href="https:\/\/example\.com\/x" rel="nofollow ugc">a link<\/a>/);
  });

  it('approves an author a moderator has already let through', async () => {
    const { cms } = await site();

    await submit(cms, submission());
    const first = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, first?.id ?? '');

    const again = await submit(cms, submission({ [COMMENT_FIELDS.body]: 'Me again.' }));

    assert.match(again.headers.get('location') ?? '', /\?comment=posted#comment-/);
    assert.equal(cms.admin.countCommentsByStatus().pending, 0);
    assert.match(await postPage(cms), /Me again\./);
  });

  it('holds a stranger using an approved commenter’s name but another email', async () => {
    const { cms } = await site();
    await submit(cms, submission());
    const first = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, first?.id ?? '');

    await submit(
      cms,
      submission({
        [COMMENT_FIELDS.email]: 'someone-else@example.com',
        [COMMENT_FIELDS.body]: 'Not really Ada.',
      }),
    );

    assert.equal(cms.admin.countCommentsByStatus().pending, 1);
  });

  it('threads a reply to another comment under it', async () => {
    const { cms } = await site();
    await submit(cms, submission());
    const first = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, first?.id ?? '');

    await submit(
      cms,
      submission({
        [COMMENT_FIELDS.name]: 'Grace Hopper',
        [COMMENT_FIELDS.email]: 'grace@example.com',
        [COMMENT_FIELDS.body]: 'Answering Ada.',
        [COMMENT_FIELDS.inReplyTo]: first?.id ?? '',
      }),
    );
    const second = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, second?.id ?? '');

    const html = await postPage(cms);
    const nested = /<ol class="children">[\s\S]*?Answering Ada\.[\s\S]*?<\/ol>/.test(html);
    assert.ok(nested, `the answer is nested under what it answers: ${html}`);
  });

  it('puts the comment back in the form when something is wrong with it', async () => {
    const { cms } = await site();

    const response = await submit(
      cms,
      submission({ [COMMENT_FIELDS.name]: '', [COMMENT_FIELDS.body]: 'Worth keeping.' }),
    );

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /A comment needs a name to go under\./);
    assert.match(html, /Worth keeping\./);
    assert.equal(cms.admin.listComments({}).length, 0);
  });
});

describe('the defences in front of the form', () => {
  it('drops a submission that filled the honeypot, saying nothing about it', async () => {
    const { cms } = await site();

    const response = await submit(
      cms,
      submission({ [COMMENT_FIELDS.trap]: 'https://spam.example' }),
    );

    // It looks exactly like a comment that was held, which is what a robot
    // filling the trap should learn from it: nothing.
    assert.equal(response.status, 303);
    assert.equal(cms.admin.listComments({}).length, 0);
  });

  it('refuses one posted faster than anybody types, and keeps the words', async () => {
    const { cms } = await site();

    const response = await submit(
      cms,
      submission({
        [COMMENT_FIELDS.loaded]: String(NOW.getTime() - (MINIMUM_SUBMIT_SECONDS - 1) * 1000),
      }),
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /faster than anybody types/);
    assert.equal(cms.admin.listComments({}).length, 0);
  });

  it('takes one from a form that has been open long enough', async () => {
    const { cms } = await site();

    const response = await submit(
      cms,
      submission({
        [COMMENT_FIELDS.loaded]: String(NOW.getTime() - (MINIMUM_SUBMIT_SECONDS + 1) * 1000),
      }),
    );

    assert.equal(response.status, 303);
    assert.equal(cms.admin.listComments({}).length, 1);
  });

  it('refuses one from a form rendered a year ago', async () => {
    const { cms } = await site();

    const response = await submit(
      cms,
      submission({ [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 400 * 24 * 3600 * 1000) }),
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /had been open a long time/);
  });

  it('stops one address after enough comments, and says how long to wait', async () => {
    const { cms } = await site();

    // The limiter counts by address, and an in-process request has none the
    // socket can report — so the header a proxy would set is the address here,
    // and the site is told to believe it.
    const trusted = await site({ 'posts/2026-09-19-hello-world.md': POST }, { trustProxy: true });
    async function fromAda(body: string): Promise<Response> {
      return trusted.cms.app.request(COMMENT_POST_PATH, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': '198.51.100.7',
        },
        body: new URLSearchParams(submission({ [COMMENT_FIELDS.body]: body })).toString(),
      });
    }

    for (let n = 0; n < 5; n += 1) {
      assert.equal(
        (await fromAda(`Comment ${String(n)}.`)).status,
        303,
        'the first five go through',
      );
    }

    const refused = await fromAda('One too many.');
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get('retry-after')) > 0, 'it says how long to wait');
    assert.equal(trusted.cms.admin.listComments({}).length, 5);

    // A different address is untouched by somebody else's flooding.
    assert.equal((await submit(cms, submission())).status, 303);
  });
});

describe('the spam checker seam', () => {
  /** A checker that says one thing, and remembers what it was asked. */
  function checker(verdict: CommentVerdict): CommentChecker & { asked: CommentSubmission[] } {
    const asked: CommentSubmission[] = [];
    return {
      asked,
      check(submitted) {
        asked.push(submitted);
        return verdict;
      },
    };
  }

  it('is told everything a service like Akismet asks for', async () => {
    const seen = checker('unknown');
    const { cms } = await site(
      { 'posts/2026-09-19-hello-world.md': POST },
      {
        commentChecker: seen,
        trustProxy: true,
      },
    );

    await cms.app.request(COMMENT_POST_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '198.51.100.9',
        'user-agent': 'Mozilla/5.0 (a browser)',
        referer: 'https://blog.example/2026/09/hello-world/',
      },
      body: new URLSearchParams(submission()).toString(),
    });

    const asked = seen.asked[0];
    assert.equal(asked?.address, '198.51.100.9');
    assert.equal(asked?.userAgent, 'Mozilla/5.0 (a browser)');
    assert.equal(asked?.referrer, 'https://blog.example/2026/09/hello-world/');
    assert.equal(asked?.post.url, 'https://blog.example/2026/09/hello-world/');
    assert.equal(asked?.comment.author.name, 'Ada Lovelace');
    assert.equal(asked?.comment.author.email, 'ada@example.com');
    assert.equal(asked?.comment.submitted, NOW.toISOString());
    assert.match(asked?.comment.content.markdown ?? '', /Good post\./);
  });

  it('files what it calls spam as spam, where a moderator can still see it', async () => {
    const { cms } = await site(
      { 'posts/2026-09-19-hello-world.md': POST },
      {
        commentChecker: checker('spam'),
      },
    );

    await submit(cms, submission());

    assert.equal(cms.admin.countCommentsByStatus().spam, 1);
    assert.ok(!(await postPage(cms)).includes('Good post.'), 'spam is not on the page');
  });

  it('throws away what it calls blatant, storing nothing at all', async () => {
    const { cms } = await site(
      { 'posts/2026-09-19-hello-world.md': POST },
      {
        commentChecker: checker('discard'),
      },
    );

    const response = await submit(cms, submission());

    assert.equal(response.status, 303);
    assert.equal(cms.admin.listComments({}).length, 0);
  });

  it('lets through what it vouches for, without a moderator', async () => {
    const { cms } = await site(
      { 'posts/2026-09-19-hello-world.md': POST },
      {
        commentChecker: checker('ham'),
      },
    );

    await submit(cms, submission());

    assert.equal(cms.admin.countCommentsByStatus().approved, 1);
  });

  it('goes on taking comments when the checker is broken', async () => {
    const { cms } = await site(
      { 'posts/2026-09-19-hello-world.md': POST },
      {
        commentChecker: {
          check() {
            throw new Error('the service is down');
          },
        },
      },
    );

    assert.equal((await submit(cms, submission())).status, 303);
    assert.equal(cms.admin.countCommentsByStatus().pending, 1);
  });
});

describe('a post that has stopped taking comments', () => {
  /** The same post, dated far enough back to be past the closing window. */
  const OLD = `---
title: Hello world
date: '2026-01-01T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

  it('shows no form and refuses a submission once it is old enough', async () => {
    const { cms } = await site({ 'posts/2026-01-01-hello-world.md': OLD });

    assert.ok(!(await postPage(cms)).includes('id="respond"'), 'no form on an old post');

    const response = await submit(cms, submission());
    assert.equal(response.status, 403);
    assert.match(await response.text(), /not taking comments any more/);
    assert.equal(cms.admin.listComments({}).length, 0);
  });

  it('is reopened by comments: true in its front matter', async () => {
    const { cms } = await site({
      'posts/2026-01-01-hello-world.md': OLD.replace(
        '---\n\nWords.',
        'comments: true\n---\n\nWords.',
      ),
    });

    assert.match(await postPage(cms), /id="respond"/);
    assert.equal((await submit(cms, submission())).status, 303);
  });

  it('is closed by comments: false however young it is', async () => {
    const { cms } = await site({
      'posts/2026-09-19-hello-world.md': POST.replace(
        '---\n\nWords.',
        'comments: false\n---\n\nWords.',
      ),
    });

    assert.ok(!(await postPage(cms)).includes('id="respond"'), 'no form on a closed post');
    assert.equal((await submit(cms, submission())).status, 403);
  });

  it('is closed everywhere when the site switch is off', async () => {
    const { cms, contentDir } = await site();
    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, baseUrl: BASE_URL, comments: false },
    });

    assert.ok(!(await postPage(cms)).includes('id="respond"'), 'no form anywhere');
    assert.equal((await submit(cms, submission())).status, 403);
  });

  it('never closes when the window is zero', async () => {
    const { cms, contentDir } = await site({ 'posts/2026-01-01-hello-world.md': OLD });
    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, baseUrl: BASE_URL, commentsCloseAfterDays: 0 },
    });

    assert.match(await postPage(cms), /id="respond"/);
  });

  it('still shows the comments it already has, and the fediverse replies', async () => {
    const { cms, contentDir } = await site();
    await submit(cms, submission());
    const held = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, held?.id ?? '');

    // Now close the site's comments and ask again.
    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, baseUrl: BASE_URL, comments: false },
    });

    const html = await postPage(cms);
    assert.match(html, /Good post\./);
    assert.ok(!html.includes('id="respond"'), 'the thread is there and the form is not');
  });
});

describe('the comments feeds', () => {
  it('carry an approved comment, and count it in source:comments', async () => {
    const { cms } = await site();
    await submit(cms, submission({ [COMMENT_FIELDS.body]: 'A feed-worthy remark.' }));
    const held = cms.admin.listComments({ status: 'pending' })[0];
    await approve(cms, held?.id ?? '');

    const perPost = await (await cms.app.request('/2026/09/hello-world/feed/')).text();
    assert.match(perPost, /A feed-worthy remark\./);
    assert.match(perPost, /<dc:creator>Ada Lovelace<\/dc:creator>/);
    assert.match(
      perPost,
      new RegExp(
        `<link>https://blog\\.example/2026/09/hello-world/#comment-${held?.id ?? ''}</link>`,
      ),
    );

    const siteWide = await (await cms.app.request('/comments/feed/')).text();
    assert.match(siteWide, /A feed-worthy remark\./);
    assert.match(siteWide, /Ada Lovelace on Hello world/);

    // And the post's own feed says how many there are to fetch.
    const posts = await (await cms.app.request('/feed/')).text();
    assert.match(posts, /<source:comments count="1"/);
  });

  it('leaves a comment nobody has approved out of both', async () => {
    const { cms } = await site();
    await submit(cms, submission({ [COMMENT_FIELDS.body]: 'Still waiting.' }));

    assert.ok(
      !(await (await cms.app.request('/2026/09/hello-world/feed/')).text()).includes(
        'Still waiting.',
      ),
      'a pending comment is in no feed',
    );
    assert.match(await (await cms.app.request('/feed/')).text(), /<source:comments count="0"/);
  });
});

describe('a database that has been deleted', () => {
  it('comes back with every comment, because the comments are the files', async () => {
    const contentDir = await temporaryDir('geekity-comment-rebuild-content-');
    const dataDir = await temporaryDir('geekity-comment-rebuild-data-');
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(path.join(contentDir, 'posts/2026-09-19-hello-world.md'), POST, 'utf8');

    const first = createCms({
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      watch: false,
      now: () => NOW,
    });
    started.push(first);
    await first.sync();

    await submit(first, submission({ [COMMENT_FIELDS.body]: 'Written once.' }));
    const held = first.admin.listComments({ status: 'pending' })[0];
    await approve(first, held?.id ?? '');
    const before = first.admin.listComments({});
    await first.close();

    // Every file the database is made of goes.
    for (const file of databaseFiles(dataDir)) await rm(file, { force: true });

    const second = createCms({
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      watch: false,
      now: () => NOW,
    });
    started.push(second);
    await second.sync();

    assert.deepEqual(second.admin.listComments({}), before);
    assert.match(await postPage(second), /Written once\./);
  });
});

describe('answering a comment from the page', () => {
  it('puts a Reply link on a native comment and fills the form from it', async () => {
    const { cms } = await site();
    await submit(cms, submission());
    const held = cms.admin.listComments({ status: 'pending' })[0];
    const id = held?.id ?? '';
    await approve(cms, id);

    const page = await postPage(cms);
    assert.match(page, new RegExp(`href="/2026/09/hello-world/\\?reply_to=${id}#respond"`));

    const replying = await postPage(cms, `?reply_to=${id}`);
    assert.match(replying, /Replying to Ada Lovelace\./);
    assert.match(replying, new RegExp(`name="in_reply_to" value="${id}"`));
  });

  it('ignores a reply_to that names nothing on this post', async () => {
    const { cms } = await site();

    const html = await postPage(cms, '?reply_to=not-a-comment');

    assert.ok(!html.includes('Replying to'), 'a made-up id puts nobody’s name on the form');
    assert.match(html, /name="in_reply_to" value=""/);
  });
});
