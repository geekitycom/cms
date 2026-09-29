import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { addContactMessage, readContactMessage } from '../contact/records.ts';
import type { Cms } from '../index.ts';
import { addCommentOptOut, hasOptedOut } from '../notifications/optouts.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { PERSONAL_DATA_FIELDS, PERSONAL_DATA_PATH } from './personal-data.ts';

/**
 * Tools > Personal data (TASK-135): erasing one commenter's personal data when
 * they ask, without editing a file by hand.
 */

const box = sandbox();
after(() => box.cleanup());

const NOW = new Date('2026-09-28T12:00:00.000Z');
const PERMALINK = '/2026/09/hello-world/';

function entry(id: string, name: string, email: string | null, inReplyTo: string | null = null) {
  return {
    id,
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name, url: `https://${name.toLowerCase()}.example/`, email, avatar: null },
    content: { markdown: `Said by ${name}.`, html: `<p>Said by ${name}.</p>\n` },
    submitted: '2026-09-20T10:00:00.000Z',
    addressHash: `hash-${id}`,
    inReplyTo,
    url: null,
    notify: email !== null,
  };
}

async function erasureSite(): Promise<{
  cms: Cms;
  agent: Browser;
  token: string;
  file: string;
  dataDir: string;
  messages: { ada: string; grace: string };
}> {
  const contentDir = await box.dir('geekity-erase-content-');
  const dataDir = await box.dir('geekity-erase-data-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, '_data', 'comments'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', '2026-09-19-hello-world.md'),
    `---\ntitle: Hello world\ndate: '2026-09-19T09:00:00Z'\npermalink: ${PERMALINK}\n---\n\nWords.\n`,
    'utf8',
  );
  const file = path.join(contentDir, '_data', 'comments', 'hello-world.json');
  await writeFile(
    file,
    `${JSON.stringify(
      {
        post: PERMALINK,
        comments: [
          entry('one', 'Ada', 'Ada@Example.com'),
          entry('two', 'Grace', 'grace@example.com', 'one'),
          entry('three', 'Ada', 'ada@example.com', 'two'),
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const received = '2026-09-21T10:00:00.000Z';
  const page = { slug: 'contact', permalink: '/contact/', title: 'Contact' };
  const ada = await addContactMessage(dataDir, {
    received,
    status: 'received',
    page,
    from: { name: 'Ada', email: 'ada@example.com' },
    subject: 'Hi',
    message: 'From Ada.',
    addressHash: 'h',
  });
  const grace = await addContactMessage(dataDir, {
    received,
    status: 'received',
    page,
    from: { name: 'Grace', email: 'grace@example.com' },
    subject: 'Hi',
    message: 'From Grace.',
    addressHash: 'h',
  });
  await addCommentOptOut(dataDir, 'ada@example.com');

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => NOW,
  });
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get(PERSONAL_DATA_PATH)).text());
  assert.ok(token !== undefined, 'the screen carries a CSRF token');
  return { cms, agent, token, file, dataDir, messages: { ada: ada.id, grace: grace.id } };
}

describe('Tools > Personal data', () => {
  it('shows what it found for an address before erasing anything', async () => {
    const { agent, token, file } = await erasureSite();
    const before = await readFile(file, 'utf8');

    const response = await agent.post(PERSONAL_DATA_PATH, {
      csrf_token: token,
      [PERSONAL_DATA_FIELDS.email]: ' ADA@example.com ',
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /2 comments/);
    assert.match(html, /1 contact message\b/);
    assert.equal(await readFile(file, 'utf8'), before, 'nothing is erased by looking');
  });

  it('erases every comment, message and opt-out of theirs and nobody else’s, and keeps the thread', async () => {
    const { cms, agent, token, file, dataDir, messages } = await erasureSite();

    const response = await agent.post(PERSONAL_DATA_PATH, {
      csrf_token: token,
      [PERSONAL_DATA_FIELDS.email]: 'ada@example.com',
      [PERSONAL_DATA_FIELDS.confirm]: '1',
    });
    assert.equal(response.status, 303);

    const written = await readFile(file, 'utf8');
    assert.doesNotMatch(written, /ada@example\.com/i, 'the address is nowhere in the file');
    assert.doesNotMatch(written, /ada\.example/, 'nor their website');
    assert.doesNotMatch(written, /"Ada"/, 'nor their name');
    assert.match(written, /grace@example\.com/, 'somebody else’s comment is untouched');

    const one = cms.admin.getComment('one');
    assert.equal(one?.author.name, 'Anonymous');
    assert.equal(one?.author.email, null);
    assert.equal(one?.author.url, null);
    assert.equal(one?.addressHash, null);
    assert.equal(one?.notify, false);
    assert.equal(one?.status, 'approved', 'its moderation status stays');
    assert.equal(one?.content.markdown, 'Said by Ada.', 'its words stay');
    assert.deepEqual(one?.redacted, ['email', 'addressHash', 'author']);
    assert.equal(cms.admin.getComment('three')?.inReplyTo, 'two', 'the thread stays whole');
    assert.equal(cms.admin.getComment('two')?.author.email, 'grace@example.com');
    assert.equal(cms.admin.hasApprovedAuthor('Anonymous', null), false);

    assert.equal(readContactMessage(dataDir, messages.ada), undefined, 'their message is gone');
    assert.ok(readContactMessage(dataDir, messages.grace) !== undefined, 'hers is not');
    assert.equal(hasOptedOut(dataDir, 'ada@example.com'), false, 'the opt-out list forgets them');

    const flashed = await (await agent.get(PERSONAL_DATA_PATH)).text();
    assert.match(flashed, /Erased 2 comments and 1 contact message/);
  });

  it('refuses a cross-site post', async () => {
    const { agent, token, file } = await erasureSite();
    const before = await readFile(file, 'utf8');

    const response = await agent.post(
      PERSONAL_DATA_PATH,
      {
        csrf_token: token,
        [PERSONAL_DATA_FIELDS.email]: 'ada@example.com',
        [PERSONAL_DATA_FIELDS.confirm]: '1',
      },
      { 'Sec-Fetch-Site': 'cross-site' },
    );
    assert.equal(response.status, 403);
    assert.equal(await readFile(file, 'utf8'), before);
  });

  it('refuses a post without the CSRF token', async () => {
    const { agent, file } = await erasureSite();
    const before = await readFile(file, 'utf8');

    const response = await agent.post(PERSONAL_DATA_PATH, {
      [PERSONAL_DATA_FIELDS.email]: 'ada@example.com',
      [PERSONAL_DATA_FIELDS.confirm]: '1',
    });
    assert.equal(response.status, 403);
    assert.equal(await readFile(file, 'utf8'), before);
  });
});
