import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser } from '../admin/accounts.ts';
import { openAdminStore } from '../admin/store.ts';
import type { AdminStore, PostComment } from '../admin/store.ts';
import { openContentStore } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import { createMailService } from '../mail/service.ts';
import { createCommentNotifier } from '../notifications/comments.ts';
import {
  addComment,
  commentEmailsFile,
  commentsFile,
  deleteComment,
  intakeComment,
  migrateCommentEmails,
  readComments,
  rebuildCommentIndexes,
  updateComment,
} from './records.ts';
import type {
  CommentIntakeOutcome,
  CommentRecords,
  IntakeCommentOptions,
  NewComment,
  ProposedComment,
} from './records.ts';
import type { CommentChecker, CommentSubmission, CommentVerdict } from './submission.ts';

const temporaryDirs: string[] = [];
const openStores: (AdminStore | ContentStore)[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory that goes away when the file finishes. */
async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-comments-'));
  temporaryDirs.push(dir);
  return dir;
}

/** A content directory and the index over it, both of this test's own. */
async function records(): Promise<CommentRecords> {
  const admin = openAdminStore({ dataDir: await temporaryDir() });
  openStores.push(admin);
  return { admin, contentDir: await temporaryDir(), dataDir: await temporaryDir() };
}

/** Every file under a directory, as its text, keyed by its path relative to it. */
async function filesUnder(dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    found[path.relative(dir, file)] = await readFile(file, 'utf8');
  }
  return found;
}

/** One comment on `hello-world`, as the form would submit it. */
function ada(overrides: Partial<NewComment> = {}): NewComment {
  return {
    slug: 'hello-world',
    permalink: '/2026/09/hello-world/',
    source: 'comment',
    kind: 'reply',
    status: 'pending',
    author: {
      name: 'Ada Lovelace',
      url: 'https://ada.example/',
      email: 'ada@example.com',
      avatar: null,
    },
    content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
    submitted: '2026-09-04T10:00:00.000Z',
    addressHash: 'abc123',
    inReplyTo: null,
    url: null,
    notify: false,
    ...overrides,
  };
}

describe('a comment file', () => {
  it('is one JSON file per post, naming the post and holding its comments', async () => {
    const site = await records();

    const stored = await addComment(site, ada());

    assert.deepEqual(
      JSON.parse(await readFile(commentsFile(site.contentDir, 'hello-world'), 'utf8')),
      {
        post: '/2026/09/hello-world/',
        comments: [
          {
            id: stored.id,
            source: 'comment',
            kind: 'reply',
            status: 'pending',
            author: {
              name: 'Ada Lovelace',
              url: 'https://ada.example/',
              avatar: null,
            },
            content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
            submitted: '2026-09-04T10:00:00.000Z',
            addressHash: 'abc123',
            inReplyTo: null,
            url: null,
          },
        ],
      },
    );
  });

  it('keeps the commenter’s email out of content/, in a 0600 file under data/', async () => {
    const site = await records();

    const stored = await addComment(site, ada({ notify: true }));

    const published = await filesUnder(site.contentDir);
    assert.ok(Object.keys(published).length > 0, 'the comment file was written');
    for (const [file, text] of Object.entries(published)) {
      assert.ok(!text.includes('ada@example.com'), `${file} carries no email`);
      assert.ok(!text.includes('"notify"'), `${file} says nothing about notices`);
    }

    const privateFile = commentEmailsFile(site.dataDir, 'hello-world');
    assert.deepEqual(JSON.parse(await readFile(privateFile, 'utf8')), {
      comments: { [stored.id]: { email: 'ada@example.com', notify: true } },
    });
    assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
    assert.equal(readComments(site, 'hello-world')[0]?.author.email, 'ada@example.com');
  });

  it('writes no private file for a post whose comments carry no email', async () => {
    const site = await records();

    await addComment(
      site,
      ada({ author: { name: 'Grace', url: null, email: null, avatar: null } }),
    );

    assert.deepEqual(await filesUnder(site.dataDir).then(Object.keys), []);
  });

  it('records whether the commenter asked to hear about replies', async () => {
    const site = await records();

    const stored = await addComment(site, ada({ notify: true }));

    assert.equal(readComments(site, 'hello-world')[0]?.notify, true);
    assert.equal(site.admin.getComment(stored.id)?.notify, true);
  });

  it('reads an entry that predates the flag as one that asked for nothing', async () => {
    const site = await records();
    await mkdir(path.dirname(commentsFile(site.contentDir, 'hello-world')), { recursive: true });
    await writeFile(
      commentsFile(site.contentDir, 'hello-world'),
      JSON.stringify({
        post: '/2026/09/hello-world/',
        comments: [{ id: 'old', author: { name: 'Ada' } }],
      }),
    );

    assert.equal(readComments(site, 'hello-world')[0]?.notify, false);
  });

  it('is appended to, oldest first, by the next comment on the same post', async () => {
    const site = await records();

    await addComment(site, ada());
    await addComment(
      site,
      ada({ author: { name: 'Grace', url: null, email: null, avatar: null } }),
    );

    const held = readComments(site, 'hello-world');
    assert.deepEqual(
      held.map((comment) => comment.author.name),
      ['Ada Lovelace', 'Grace'],
    );
  });

  it('gives every comment an id of its own, which is what a reply names', async () => {
    const site = await records();

    const first = await addComment(site, ada());
    const second = await addComment(site, ada({ inReplyTo: first.id }));

    assert.notEqual(first.id, second.id);
    assert.equal(second.inReplyTo, first.id);
  });

  it('keeps each post in a file of its own', async () => {
    const site = await records();

    await addComment(site, ada());
    await addComment(site, ada({ slug: 'second-post', permalink: '/2026/09/second-post/' }));

    assert.equal(readComments(site, 'hello-world').length, 1);
    assert.equal(readComments(site, 'second-post').length, 1);
  });

  it('names a post whose slug is not ASCII by the slug percent-encoded, and reads it back at boot', async () => {
    const site = await records();

    await addComment(site, ada({ slug: 'i-♥-rss', permalink: '/2026/07/i-♥-rss/' }));

    assert.deepEqual(Object.keys(await filesUnder(site.contentDir)), [
      path.join('_data', 'comments', 'i-%E2%99%A5-rss.json'),
    ]);
    assert.deepEqual(Object.keys(await filesUnder(site.dataDir)), [
      path.join('comments', 'i-%E2%99%A5-rss.json'),
    ]);
    assert.equal(rebuildCommentIndexes(site).comments, 1);
    assert.equal(site.admin.listCommentsFor('i-♥-rss').length, 1);
  });

  it('keeps an ASCII slug’s file name as it was, and refuses one that could leave the directory', () => {
    assert.equal(path.basename(commentsFile('/c', 'hello-world')), 'hello-world.json');
    assert.throws(() => commentsFile('/c', '..'));
    assert.throws(() => commentsFile('/c', '.hidden'));
    assert.equal(path.dirname(commentsFile('/c', 'a/b')), path.join('/c', '_data', 'comments'));
  });
});

describe('the comment index', () => {
  it('holds what the file holds, as soon as the comment is written', async () => {
    const site = await records();

    const stored = await addComment(site, ada());

    assert.deepEqual(site.admin.listCommentsFor('hello-world'), [stored]);
    assert.deepEqual(site.admin.getComment(stored.id), stored);
  });

  it('is rebuilt from the files, so deleting the database costs nothing', async () => {
    const site = await records();
    await addComment(site, ada());
    await addComment(site, ada({ slug: 'second-post', permalink: '/2026/09/second-post/' }));

    const before = site.admin.listComments({});
    // What a deleted database looks like from here: an index with nothing in it.
    site.admin.replaceComments([]);
    assert.deepEqual(site.admin.listComments({}), []);

    const report = rebuildCommentIndexes(site);

    assert.equal(report.comments, 2);
    assert.deepEqual(site.admin.listComments({}), before);
  });

  it('counts what is waiting for a moderator', async () => {
    const site = await records();
    await addComment(site, ada());
    await addComment(site, ada({ status: 'approved' }));
    await addComment(site, ada({ status: 'spam' }));

    assert.deepEqual(site.admin.countCommentsByStatus(), { pending: 1, approved: 1, spam: 1 });
  });

  it('lists one status at a time, newest first', async () => {
    const site = await records();
    await addComment(site, ada({ submitted: '2026-09-01T10:00:00.000Z', status: 'approved' }));
    await addComment(site, ada({ submitted: '2026-09-03T10:00:00.000Z', status: 'approved' }));
    await addComment(site, ada({ submitted: '2026-09-02T10:00:00.000Z', status: 'pending' }));

    assert.deepEqual(
      site.admin.listComments({ status: 'approved' }).map((comment) => comment.submitted),
      ['2026-09-03T10:00:00.000Z', '2026-09-01T10:00:00.000Z'],
    );
  });

  it('knows an author it has approved before, by name and email together', async () => {
    const site = await records();
    await addComment(site, ada({ status: 'approved' }));

    assert.equal(site.admin.hasApprovedAuthor('Ada Lovelace', 'ada@example.com'), true);
    // A different email under the same name is a different person.
    assert.equal(site.admin.hasApprovedAuthor('Ada Lovelace', 'someone@example.com'), false);
    assert.equal(site.admin.hasApprovedAuthor('Grace Hopper', 'ada@example.com'), false);
    // And an author whose only comment is still waiting is not approved.
    await addComment(
      site,
      ada({ author: { name: 'Grace', url: null, email: 'g@example.com', avatar: null } }),
    );
    assert.equal(site.admin.hasApprovedAuthor('Grace', 'g@example.com'), false);
  });
});

describe('moderating a stored comment', () => {
  it('rewrites the file where the comment stands, and the index with it', async () => {
    const site = await records();
    const stored = await addComment(site, ada());

    const moved = await updateComment(site, stored.id, { status: 'approved' });

    assert.equal(moved?.status, 'approved');
    assert.equal(readComments(site, 'hello-world')[0]?.status, 'approved');
    assert.equal(site.admin.getComment(stored.id)?.status, 'approved');
  });

  it('takes a deleted comment out of both', async () => {
    const site = await records();
    const stored = await addComment(site, ada());

    assert.equal(await deleteComment(site, stored.id), true);

    assert.deepEqual(readComments(site, 'hello-world'), []);
    assert.equal(site.admin.getComment(stored.id), undefined);
    assert.ok(
      !Object.values(await filesUnder(site.dataDir)).some((text) => text.includes('ada@')),
      'its email went with it',
    );
    // And says so when there is nothing to delete.
    assert.equal(await deleteComment(site, stored.id), false);
  });
});

describe('a comment file written before emails moved to data/', () => {
  /** A legacy file: two emails, a webmention with none, and an entry nothing can read. */
  const LEGACY = {
    post: '/2026/09/hello-world/',
    comments: [
      {
        id: 'c1',
        status: 'approved',
        author: { name: 'Ada', url: null, email: 'ada@example.com', avatar: null },
        content: { markdown: 'Hi', html: '<p>Hi</p>' },
        notify: true,
        someday: 'a key this version does not know',
      },
      {
        id: 'c2',
        source: 'webmention',
        author: { name: 'Grace', url: 'https://grace.example/', email: null, avatar: null },
        notify: false,
      },
      { author: { name: 'Nameless', email: 'nameless@example.com' } },
    ],
  };

  async function legacySite(): Promise<CommentRecords> {
    const site = await records();
    const file = commentsFile(site.contentDir, 'hello-world');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(LEGACY, null, 2)}\n`);
    return site;
  }

  it('is read with its emails before anything has moved them', async () => {
    const site = await legacySite();

    assert.equal(readComments(site, 'hello-world')[0]?.author.email, 'ada@example.com');
    assert.equal(readComments(site, 'hello-world')[0]?.notify, true);
  });

  it('has them moved to data/ on boot, and nothing else about it changed', async () => {
    const site = await legacySite();

    migrateCommentEmails(site);

    const published = await readFile(commentsFile(site.contentDir, 'hello-world'), 'utf8');
    assert.ok(!published.includes('@example.com'), 'no email is left under content/');
    assert.deepEqual(JSON.parse(published), {
      post: '/2026/09/hello-world/',
      comments: [
        {
          id: 'c1',
          status: 'approved',
          author: { name: 'Ada', url: null, avatar: null },
          content: { markdown: 'Hi', html: '<p>Hi</p>' },
          someday: 'a key this version does not know',
        },
        {
          id: 'c2',
          source: 'webmention',
          author: { name: 'Grace', url: 'https://grace.example/', avatar: null },
        },
        // An entry nothing can read has no id to key an email by, so the email
        // is taken off it and not kept: there is nothing it could ever be used for.
        { author: { name: 'Nameless' } },
      ],
    });

    const privateFile = commentEmailsFile(site.dataDir, 'hello-world');
    assert.deepEqual(JSON.parse(await readFile(privateFile, 'utf8')), {
      comments: { c1: { email: 'ada@example.com', notify: true } },
    });
    assert.equal((await stat(privateFile)).mode & 0o777, 0o600);

    rebuildCommentIndexes(site);
    assert.equal(site.admin.getComment('c1')?.author.email, 'ada@example.com');
    assert.equal(site.admin.getComment('c1')?.notify, true);
  });

  it('is migrated once: a second boot writes nothing', async () => {
    const site = await legacySite();

    assert.equal(migrateCommentEmails(site).files, 1);
    const content = await filesUnder(site.contentDir);
    const data = await filesUnder(site.dataDir);

    assert.equal(migrateCommentEmails(site).files, 0);
    assert.deepEqual(await filesUnder(site.contentDir), content);
    assert.deepEqual(await filesUnder(site.dataDir), data);
  });

  it('keeps an email data/ already holds over one somebody wrote into content/', async () => {
    const site = await legacySite();
    const privateFile = commentEmailsFile(site.dataDir, 'hello-world');
    await mkdir(path.dirname(privateFile), { recursive: true });
    await writeFile(
      privateFile,
      JSON.stringify({ comments: { c1: { email: 'ada@new.example', notify: false } } }),
    );

    migrateCommentEmails(site);

    assert.equal(readComments(site, 'hello-world')[0]?.author.email, 'ada@new.example');
    assert.equal(readComments(site, 'hello-world')[0]?.notify, false);
  });
});

describe('a comment file somebody edited by hand', () => {
  it('is read as far as it makes sense, so one bad entry loses only itself', async () => {
    const site = await records();
    const file = commentsFile(site.contentDir, 'hello-world');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({
        post: '/2026/09/hello-world/',
        comments: [
          { id: 'c1', author: { name: 'Ada' }, content: { markdown: 'Hi' }, status: 'approved' },
          { author: { name: 'Nameless' } },
        ],
      })}\n`,
    );

    const held = readComments(site, 'hello-world');

    assert.equal(held.length, 1);
    assert.equal(held[0]?.id, 'c1');
    // Everything the entry did not say falls back to something a template can
    // print rather than to `undefined`.
    assert.equal(held[0]?.source, 'comment');
    assert.equal(held[0]?.kind, 'reply');
    assert.equal(held[0]?.author.email, null);
    assert.equal(held[0]?.content.html, '');
  });
});

/**
 * The intake, driven through its own interface.
 *
 * Everything below hands {@link intakeComment} a proposed comment and reads
 * what became of it: the file, the index, and the messages a memory mail
 * provider was given. No HTTP, no form parsing and no webmention fetching —
 * those are the callers' half, and they have site-level tests of their own.
 */

/** A checker that answers whatever this test told it to, and remembers. */
interface RememberingChecker extends CommentChecker {
  /** Every submission it was shown, in order. */
  readonly seen: CommentSubmission[];
}

/** One that always says the same thing, or always throws. */
function checkerSaying(answer: CommentVerdict | Error): RememberingChecker {
  const seen: CommentSubmission[] = [];
  return {
    seen,
    check(submission) {
      seen.push(submission);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

/** What one intake is handed, on top of the defaults below. */
interface Taking {
  /** Where the comment came from. */
  origin?: IntakeCommentOptions['origin'] | undefined;
  /** What is different about the comment itself. */
  comment?: Partial<ProposedComment> | undefined;
  /** The checker, when this test has one. */
  checker?: CommentChecker | undefined;
  /** Where the submission came from, unhashed. */
  address?: string | undefined;
}

/** A site the intake can be driven against. */
interface IntakeSite extends CommentRecords {
  /** Where the salt, the signing secret and the users live. */
  dataDir: string;
  /** Every message the notices actually produced. */
  provider: MemoryMailProvider;
  /** Take one comment, and wait for whatever mail it set off. */
  take(taking?: Taking): Promise<CommentIntakeOutcome>;
}

/** A comment on `hello-world` as a caller proposes it, judged by nobody yet. */
function proposal(overrides: Partial<ProposedComment> = {}): ProposedComment {
  return {
    slug: 'hello-world',
    permalink: '/2026/09/hello-world/',
    source: 'comment',
    kind: 'reply',
    author: {
      name: 'Ada Lovelace',
      url: 'https://ada.example/',
      email: 'ada@example.com',
      avatar: null,
    },
    content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
    submitted: '2026-09-04T10:00:00.000Z',
    inReplyTo: null,
    url: null,
    notify: false,
    ...overrides,
  };
}

/** The same, as a page that links here would propose it. */
function mention(overrides: Partial<ProposedComment> = {}): ProposedComment {
  return proposal({
    source: 'webmention',
    kind: 'mention',
    author: { name: 'Grace Hopper', url: 'https://grace.example/', email: null, avatar: null },
    content: { markdown: 'Somebody wrote about this', html: '<p>Somebody wrote about this</p>' },
    url: 'https://grace.example/2026/09/about-that/',
    ...overrides,
  });
}

/** The files, the index, one moderator with an address, and mail in a list. */
async function intakeSite(): Promise<IntakeSite> {
  const dataDir = await temporaryDir();
  const contentDir = await temporaryDir();
  const admin = openAdminStore({ dataDir });
  const store = openContentStore({ dataDir });
  openStores.push(admin, store);

  const provider = createMemoryMailProvider();
  const mail = createMailService({
    config: {
      baseUrl: BASE_URL,
      contentDir,
      dataDir,
      devMode: false,
      themesDir: path.join(contentDir, 'themes'),
      watch: false,
    },
    provider,
    backoffMs: () => 0,
    logger: { info: () => {}, warn: () => {} },
  });
  const notices = createCommentNotifier({
    admin,
    store,
    mail,
    config: { baseUrl: BASE_URL, dataDir, now: () => new Date('2026-09-04T12:00:00.000Z') },
  });

  await createUser({
    dataDir,
    username: 'moderator',
    password: 'correct horse battery',
    email: 'moderator@example.com',
  });

  const records: CommentRecords = { admin, contentDir, dataDir };

  return {
    admin,
    contentDir,
    dataDir,
    provider,
    async take(taking: Taking = {}) {
      const outcome = await intakeComment({
        records,
        origin: taking.origin ?? 'form',
        comment: proposal(taking.comment),
        post: { title: 'Hello world', url: `${BASE_URL}/2026/09/hello-world/` },
        dataDir,
        baseUrl: BASE_URL,
        notices,
        ...(taking.checker === undefined ? {} : { checker: taking.checker }),
        ...(taking.address === undefined ? {} : { address: taking.address }),
        logger: { warn: () => {} },
      });
      await mail.settled();
      return outcome;
    },
  };
}

/** Where the site in these tests is. */
const BASE_URL = 'https://blog.example';

/** The one comment that was stored, or a failed assertion saying none was. */
function onlyStored(outcome: CommentIntakeOutcome): PostComment {
  assert.equal(outcome.kind, 'stored');
  assert.ok(outcome.kind === 'stored');
  return outcome.comment;
}

describe('the comment intake', () => {
  it('holds a stranger’s comment and tells the moderators once', async () => {
    const site = await intakeSite();

    const stored = onlyStored(await site.take());

    assert.equal(stored.status, 'pending');
    assert.equal(readComments(site, 'hello-world')[0]?.status, 'pending');
    assert.equal(site.admin.getComment(stored.id)?.status, 'pending');
    assert.equal(site.provider.sent.length, 1);
    assert.deepEqual(
      site.provider.sent[0]?.to.map((recipient) => recipient.address),
      ['moderator@example.com'],
    );
  });

  it('approves an author a moderator has let through before, and says nothing', async () => {
    const site = await intakeSite();
    await addComment(site, ada({ status: 'approved' }));
    site.provider.clear();

    const stored = onlyStored(await site.take());

    assert.equal(stored.status, 'approved');
    assert.equal(site.provider.sent.length, 0);
  });

  it('hashes the address rather than storing it', async () => {
    const site = await intakeSite();

    const stored = onlyStored(await site.take({ address: '198.51.100.7' }));

    assert.ok(stored.addressHash !== null);
    assert.doesNotMatch(stored.addressHash, /198\.51\.100\.7/);
    assert.equal(readComments(site, 'hello-world')[0]?.addressHash, stored.addressHash);
  });

  it('files what a checker calls spam, and tells nobody about it', async () => {
    const site = await intakeSite();

    const stored = onlyStored(await site.take({ checker: checkerSaying('spam') }));

    assert.equal(stored.status, 'spam');
    assert.equal(site.provider.sent.length, 0);
  });

  it('lets a comment a checker calls ham past the queue, and tells nobody', async () => {
    const site = await intakeSite();

    const stored = onlyStored(await site.take({ checker: checkerSaying('ham') }));

    assert.equal(stored.status, 'approved');
    assert.equal(site.provider.sent.length, 0);
  });

  it('stores nothing at all for a checker that says discard', async () => {
    const site = await intakeSite();

    const outcome = await site.take({ checker: checkerSaying('discard') });

    assert.deepEqual(outcome, { kind: 'discarded', removed: false });
    assert.deepEqual(readComments(site, 'hello-world'), []);
    assert.deepEqual(site.admin.listComments({}), []);
    assert.equal(site.provider.sent.length, 0);
  });

  it('treats a checker that will not answer as no opinion', async () => {
    const site = await intakeSite();
    const checker = checkerSaying(new Error('the service is down'));

    const stored = onlyStored(await site.take({ checker }));

    assert.equal(checker.seen.length, 1);
    assert.equal(stored.status, 'pending');
  });

  it('shows the checker the comment as it would be stored, and its post', async () => {
    const site = await intakeSite();
    const checker = checkerSaying('unknown');

    await site.take({ checker, address: '198.51.100.7' });

    const submission = checker.seen[0];
    assert.equal(submission?.comment.source, 'comment');
    assert.equal(submission?.comment.status, 'pending');
    assert.equal(submission?.comment.author.name, 'Ada Lovelace');
    assert.equal(submission?.address, '198.51.100.7');
    assert.deepEqual(submission?.post, {
      slug: 'hello-world',
      title: 'Hello world',
      url: `${BASE_URL}/2026/09/hello-world/`,
    });
    assert.equal(submission?.baseUrl, BASE_URL);
  });

  it('holds a webmention whatever the site would have done with a comment', async () => {
    const site = await intakeSite();
    // Ada has been approved before; a page of hers linking here still waits,
    // because a webmention is a page rather than a person the site knows.
    await addComment(site, ada({ status: 'approved' }));
    site.provider.clear();

    const stored = onlyStored(await site.take({ origin: 'webmention', comment: mention() }));

    assert.equal(stored.status, 'pending');
    assert.equal(stored.source, 'webmention');
    assert.equal(site.provider.sent.length, 1);
  });

  it('tells the checker a webmention is one', async () => {
    const site = await intakeSite();
    const checker = checkerSaying('unknown');

    await site.take({ origin: 'webmention', comment: mention(), checker });

    assert.equal(checker.seen[0]?.comment.source, 'webmention');
  });

  it('files a webmention a checker calls spam, and approves one it calls ham', async () => {
    const spam = await intakeSite();
    assert.equal(
      onlyStored(
        await spam.take({
          origin: 'webmention',
          comment: mention(),
          checker: checkerSaying('spam'),
        }),
      ).status,
      'spam',
    );

    const ham = await intakeSite();
    assert.equal(
      onlyStored(
        await ham.take({ origin: 'webmention', comment: mention(), checker: checkerSaying('ham') }),
      ).status,
      'approved',
    );
  });

  it('rewrites the one a source already sent rather than adding a second', async () => {
    const site = await intakeSite();
    const first = onlyStored(await site.take({ origin: 'webmention', comment: mention() }));
    site.provider.clear();

    const outcome = await site.take({
      origin: 'webmention',
      comment: mention({ kind: 'reply', content: { markdown: 'Edited', html: '<p>Edited</p>' } }),
    });

    assert.equal(outcome.kind, 'stored');
    assert.ok(outcome.kind === 'stored');
    assert.equal(outcome.created, false);
    assert.equal(outcome.comment.id, first.id);
    assert.equal(outcome.comment.content.markdown, 'Edited');
    assert.equal(readComments(site, 'hello-world').length, 1);
    // A page that is edited and re-sent is not news: the moderators heard the
    // first time and the entry has been in the queue ever since.
    assert.equal(site.provider.sent.length, 0);
  });

  it('keeps a moderator’s decision when a source sends its webmention again', async () => {
    const site = await intakeSite();
    const first = onlyStored(await site.take({ origin: 'webmention', comment: mention() }));
    await updateComment(site, first.id, { status: 'approved' });

    for (const verdict of ['unknown', 'ham'] as const) {
      const outcome = await site.take({
        origin: 'webmention',
        comment: mention(),
        checker: checkerSaying(verdict),
      });
      assert.equal(onlyStored(outcome).status, 'approved');
    }
  });

  it('moves an approved webmention only when the fresh verdict is spam', async () => {
    const site = await intakeSite();
    const first = onlyStored(await site.take({ origin: 'webmention', comment: mention() }));
    await updateComment(site, first.id, { status: 'approved' });

    const outcome = await site.take({
      origin: 'webmention',
      comment: mention(),
      checker: checkerSaying('spam'),
    });

    assert.equal(onlyStored(outcome).status, 'spam');
  });

  it('takes the webmention it already held away when a checker says discard', async () => {
    const site = await intakeSite();
    const first = onlyStored(await site.take({ origin: 'webmention', comment: mention() }));

    const outcome = await site.take({
      origin: 'webmention',
      comment: mention(),
      checker: checkerSaying('discard'),
    });

    assert.deepEqual(outcome, { kind: 'discarded', removed: true });
    assert.deepEqual(readComments(site, 'hello-world'), []);
    assert.equal(site.admin.getComment(first.id), undefined);
  });

  it('approves a moderator’s reply without asking anybody', async () => {
    const site = await intakeSite();
    const parent = onlyStored(await site.take({ comment: proposal({ notify: true }) }));
    site.provider.clear();
    const checker = checkerSaying('spam');

    const stored = onlyStored(
      await site.take({
        origin: 'moderator',
        checker,
        comment: proposal({
          author: { name: 'The author', url: null, email: null, avatar: null },
          content: { markdown: 'Thanks.', html: '<p>Thanks.</p>\n' },
          inReplyTo: parent.id,
        }),
      }),
    );

    assert.equal(stored.status, 'approved');
    // A moderator writing in the admin is the person who would have approved
    // it; a spam service has no say in what the owner of the site says.
    assert.deepEqual(checker.seen, []);
    // Nothing is waiting, so no moderation notice goes; what does go is the
    // message to whoever asked to hear about replies to their comment.
    assert.equal(site.provider.sent.length, 1);
    assert.deepEqual(
      site.provider.sent[0]?.to.map((recipient) => recipient.address),
      ['ada@example.com'],
    );
  });
});
