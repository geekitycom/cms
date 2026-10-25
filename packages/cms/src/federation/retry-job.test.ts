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
): Delivery {
  return {
    activityId: `https://blog.example/${slug}#${attemptedAt}`,
    activityType: 'Update',
    objectId: `https://blog.example/${slug}/`,
    slug,
    actorId: `https://social.example/users/${actor}`,
    inboxId,
    status,
    error: status === 'failed' ? 'HTTP 403' : null,
    attemptedAt,
  };
}

function services(rows: readonly Delivery[]): RetryJobServices & { resent: unknown[] } {
  const resent: unknown[] = [];
  return {
    resent,
    store: {} as RetryJobServices['store'],
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
      resend(slug, to) {
        resent.push([slug, [...(to ?? [])]]);
        return Promise.resolve({
          activityId: `https://blog.example/${slug}#retry`,
          activityType: 'Update',
          objectId: `https://blog.example/${slug}/`,
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

    assert.deepEqual(failedRetries(site, { slug: null, inbox: INBOX }), [
      {
        slug: 'two',
        recipients: [
          { actorId: 'https://social.example/users/carol', inboxId: INBOX, error: 'HTTP 403' },
        ],
      },
    ]);
  });

  it('leaves out an activity about no post, such as a profile Update', () => {
    const site = services([
      { ...row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z'), slug: null },
    ]);
    assert.deepEqual(failedRetries(site, { slug: null, inbox: INBOX }), []);
  });

  it('finds nothing for a post the site does not have', () => {
    const site = services([row('one', 'carol', INBOX, 'failed', '2026-03-01T00:00:00Z')]);
    const store = {
      getBySlug: () => undefined,
      listFederated: (): Document[] => [],
    } as unknown as RetryJobServices['store'];
    assert.deepEqual(failedRetries({ ...site, store }, { slug: 'one', inbox: null }), []);
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
          async resend(slug, to) {
            steps.push(`resend ${slug}`);
            return await site.delivery.resend(slug, to);
          },
        },
      },
      () => {
        steps.push('pause');
        return Promise.resolve();
      },
    );

    const report = await job.run({ slug: null, inbox: INBOX }, context);

    assert.deepEqual(steps, ['resend one', 'pause', 'resend two']);
    assert.deepEqual(site.resent, [
      ['one', ['https://social.example/users/carol']],
      ['two', ['https://social.example/users/carol', 'https://social.example/users/dave']],
    ]);
    assert.deepEqual(
      report.posts.map((post) => [post.slug, post.recipients, post.activity?.activityType]),
      [
        ['one', 1, 'Update'],
        ['two', 2, 'Update'],
      ],
    );
  });

  it('refuses a payload that names neither a post nor an inbox', () => {
    const job = retryDeliveriesJob(services([]));
    assert.throws(() => job.parse({ slug: null, inbox: null }));
    assert.deepEqual(job.parse({ slug: 'one', inbox: null }), { slug: 'one', inbox: null });
  });
});
