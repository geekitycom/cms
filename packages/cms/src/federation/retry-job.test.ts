import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from '../content/document.ts';
import type { Delivery, DeliverySearch, DeliveryStatus } from '../store/deliveries.ts';
import type { DeliveryReport } from './delivery.ts';
import { failedRetries, retryDeliveriesJob } from './retry-job.ts';
import type { RetryJobServices } from './retry-job.ts';

const INBOX = 'https://social.example/inbox';
const MOVED = 'https://moved.example/inbox';

function row(
  slug: string,
  actor: string,
  inboxId: string,
  status: DeliveryStatus,
  attemptedAt: string,
  activityType = 'Update',
): Delivery {
  return {
    activityId: `https://blog.example/${slug}#${attemptedAt}`,
    activityType,
    objectId: `https://blog.example/${slug}/`,
    slug,
    actorId: `https://social.example/users/${actor}`,
    inboxId,
    status,
    error: status === 'failed' ? 'HTTP 403' : null,
    attemptedAt,
  };
}

function fileOf(slug: string): string {
  return `posts/2026-03-01-${slug}.md`;
}

function services(rows: readonly Delivery[]): RetryJobServices & { resent: unknown[] } {
  const resent: unknown[] = [];
  const posts = [...new Set(rows.flatMap((one) => (one.slug === null ? [] : [one.slug])))].map(
    (slug) => ({ type: 'post', slug, path: fileOf(slug), permalink: `/${slug}/` }) as Document,
  );
  return {
    resent,
    store: {
      getByPath: (path: string) => posts.find((post) => post.path === path),
      listFederated: () => posts,
    } as unknown as RetryJobServices['store'],
    config: { contentDir: '/nowhere', baseUrl: 'https://blog.example' },
    admin: {
      searchDeliveries(search: DeliverySearch) {
        const items = rows
          .filter(
            (one) =>
              (search.inboxId === undefined || one.inboxId === search.inboxId) &&
              (search.actorId === undefined || one.actorId === search.actorId),
          )
          .toSorted((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
        return { total: items.length, items };
      },
    },
    delivery: {
      resend(path, to) {
        resent.push([path, [...(to?.actors ?? [])]]);
        return Promise.resolve({
          activityId: `https://blog.example/${path}#retry`,
          activityType: to?.missedAnnouncement === true ? 'Create' : 'Update',
          objectId: `https://blog.example/${path}/`,
          deliveries: [],
          held: false,
        } satisfies DeliveryReport);
      },
    },
  };
}

const context = {
  signal: new AbortController().signal,
  attempt: 1,
  progress: () => Promise.resolve(),
};

describe('which deliveries a retry sends again', () => {
  it('takes the newest outcome per post and recipient, across every inbox it was sent to', () => {
    const site = services([
      row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z'),
      row('one', 'carol', MOVED, 'sent', '2026-03-02T00:00:00Z'),
      row('two', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z'),
      row('two', 'dave', INBOX, 'sent', '2026-03-01T00:00:00Z'),
      row('three', 'dave', INBOX, 'failed', '2026-03-01T00:00:00Z'),
      row('three', 'dave', INBOX, 'sent', '2026-03-03T00:00:00Z'),
    ]);

    assert.deepEqual(failedRetries(site, { path: null, inbox: INBOX }), [
      {
        path: fileOf('two'),
        recipients: [
          {
            actorId: 'https://social.example/users/carol',
            inboxId: INBOX,
            error: 'HTTP 403',
            missedAnnouncement: false,
          },
        ],
      },
    ]);
  });

  it('marks a recipient whose newest Create failed as one that missed the announcement', () => {
    const site = services([
      row('one', 'carol', INBOX, 'failed', '2026-03-02T00:00:00Z'),
      row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z', 'Create'),
      row('one', 'dave', INBOX, 'failed', '2026-03-02T00:00:00Z'),
      row('one', 'dave', INBOX, 'sent', '2026-03-01T00:00:00Z', 'Create'),
      row('one', 'erin', INBOX, 'failed', '2026-03-02T00:00:00Z'),
      row('one', 'erin', INBOX, 'sent', '2026-02-01T00:00:00Z', 'Create'),
      row('one', 'erin', INBOX, 'failed', '2026-01-01T00:00:00Z', 'Create'),
      row('one', 'frank', INBOX, 'failed', '2026-03-02T00:00:00Z'),
    ]);

    const [retry] = failedRetries(site, { path: null, inbox: INBOX });
    assert.deepEqual(
      retry?.recipients.map((one) => [one.actorId.split('/').at(-1), one.missedAnnouncement]),
      [
        ['carol', true],
        ['dave', false],
        ['erin', false],
        ['frank', false],
      ],
    );
  });

  it('retries a recipient whose newest outcome was never seen, and sends the Create when that was the Create', () => {
    const site = services([
      row('one', 'carol', INBOX, 'unknown', '2026-03-01T00:00:00Z', 'Create'),
      row('one', 'dave', INBOX, 'unknown', '2026-03-02T00:00:00Z'),
      row('one', 'dave', INBOX, 'sent', '2026-03-01T00:00:00Z', 'Create'),
      row('one', 'erin', INBOX, 'queued', '2026-03-02T00:00:00Z'),
    ]);

    const [retry] = failedRetries(site, { path: null, inbox: INBOX });
    assert.deepEqual(
      retry?.recipients.map((one) => [one.actorId.split('/').at(-1), one.missedAnnouncement]),
      [
        ['dave', false],
        ['carol', true],
      ],
    );
  });

  it('leaves out an activity about no post, such as a profile Update', () => {
    const site = services([
      { ...row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z'), slug: null },
    ]);
    assert.deepEqual(failedRetries(site, { path: null, inbox: INBOX }), []);
  });

  it('finds nothing for a post the site does not have', () => {
    const site = services([row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z')]);
    assert.deepEqual(failedRetries(site, { path: fileOf('gone'), inbox: null }), []);
  });

  it('leaves out a delivery whose object is no announced post', () => {
    const site = services([row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z')]);
    const store = { ...site.store, listFederated: (): Document[] => [] };
    assert.deepEqual(failedRetries({ ...site, store }, { path: null, inbox: INBOX }), []);
  });
});

describe('the retry job', () => {
  it('resends each post to its failed recipients alone, pausing between posts and not after the last', async () => {
    const site = services([
      row('one', 'carol', INBOX, 'failed', '2026-03-02T00:00:00Z'),
      row('two', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z'),
      row('two', 'dave', INBOX, 'failed', '2026-03-01T00:00:00Z'),
    ]);
    const steps: unknown[] = [];
    const job = retryDeliveriesJob(
      {
        ...site,
        delivery: {
          async resend(path, to) {
            steps.push(`resend ${path}`);
            return await site.delivery.resend(path, to);
          },
        },
      },
      () => {
        steps.push('pause');
        return Promise.resolve();
      },
    );

    const report = await job.run({ path: null, inbox: INBOX }, context);

    assert.deepEqual(steps, [`resend ${fileOf('one')}`, 'pause', `resend ${fileOf('two')}`]);
    assert.deepEqual(site.resent, [
      [fileOf('one'), ['https://social.example/users/carol']],
      [fileOf('two'), ['https://social.example/users/carol', 'https://social.example/users/dave']],
    ]);
    assert.deepEqual(
      report.posts.map((post) => [post.path, post.recipients, post.activity?.activityType]),
      [
        [fileOf('one'), 1, 'Update'],
        [fileOf('two'), 2, 'Update'],
      ],
    );
  });

  it('sends a post’s Create to the recipients that missed it before the Update to the rest', async () => {
    const site = services([
      row('one', 'carol', INBOX, 'failed', '2026-03-02T00:00:00Z'),
      row('one', 'dave', INBOX, 'failed', '2026-03-01T00:00:00Z', 'Create'),
    ]);

    const report = await retryDeliveriesJob(site, () => Promise.resolve()).run(
      { path: null, inbox: INBOX },
      context,
    );

    assert.deepEqual(site.resent, [
      [fileOf('one'), ['https://social.example/users/dave']],
      [fileOf('one'), ['https://social.example/users/carol']],
    ]);
    assert.deepEqual(
      report.posts.map((post) => [post.path, post.recipients, post.activity?.activityType]),
      [
        [fileOf('one'), 1, 'Create'],
        [fileOf('one'), 1, 'Update'],
      ],
    );
  });

  it('refuses a payload that names neither a post nor an inbox', () => {
    const job = retryDeliveriesJob(services([]));
    assert.throws(() => job.parse({ path: null, inbox: null }));
    assert.deepEqual(job.parse({ path: fileOf('one'), inbox: null }), {
      path: fileOf('one'),
      inbox: null,
    });
  });
});
