import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Person } from '@fedify/vocab';

import type { Follower, Relay } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import type { DocumentChange } from '../content/sync.ts';
import {
  citedAuthor,
  deliveryChange,
  deliveryRows,
  fanOutTargets,
  followerTargets,
  objectTargets,
  pinChange,
  relayTargets,
  revisionStep,
  stampFor,
} from './delivery-plan.ts';
import type { DeliveryTarget, Shape } from './delivery-plan.ts';

const NOW = new Date('2026-10-11T12:00:00.000Z');

function post(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/hello.md',
    slug: 'hello',
    permalink: '/hello/',
    title: 'Hello',
    date: '2026-10-01T09:00:00.000Z',
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: 'Hello.',
    html: '<p>Hello.</p>',
    hash: 'abc',
    ...overrides,
  };
}

function follower(actorId: string, inboxId: string, sharedInboxId: string | null): Follower {
  return {
    username: 'andrew',
    actorId,
    inboxId,
    sharedInboxId,
    handle: null,
    name: null,
    iconUrl: null,
  } as Follower;
}

function relay(inboxId: string, actorId: string | null): Relay {
  return {
    inboxId,
    actorId,
    state: 'accepted',
    reason: null,
    followId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function target(inboxId: string, ...actorIds: string[]): DeliveryTarget {
  return { inboxId, recipients: [], actorIds };
}

function change(previous: Document | undefined, next: Document | undefined): DocumentChange {
  return {
    type: 'updated',
    path: 'posts/hello.md',
    previous,
    next,
    origin: 'admin',
  };
}

describe('delivery targets', () => {
  it('groups followers behind the shared inbox one POST reaches', () => {
    const targets = followerTargets([
      follower(
        'https://a.example/users/1',
        'https://a.example/users/1/inbox',
        'https://a.example/inbox',
      ),
      follower('https://b.example/users/2', 'https://b.example/users/2/inbox', null),
      follower(
        'https://a.example/users/3',
        'https://a.example/users/3/inbox',
        'https://a.example/inbox',
      ),
    ]);

    assert.deepEqual(
      targets.map(({ inboxId, actorIds }) => ({ inboxId, actorIds })),
      [
        {
          inboxId: 'https://a.example/inbox',
          actorIds: ['https://a.example/users/1', 'https://a.example/users/3'],
        },
        { inboxId: 'https://b.example/users/2/inbox', actorIds: ['https://b.example/users/2'] },
      ],
    );
  });

  it('records a relay under its actor id, or its inbox before it has one', () => {
    const targets = relayTargets([
      relay('https://relay.example/inbox', 'https://relay.example/actor'),
      relay('https://other.example/inbox', null),
    ]);

    assert.deepEqual(
      targets.map(({ inboxId, actorIds }) => ({ inboxId, actorIds })),
      [
        { inboxId: 'https://relay.example/inbox', actorIds: ['https://relay.example/actor'] },
        { inboxId: 'https://other.example/inbox', actorIds: ['https://other.example/inbox'] },
      ],
    );
  });

  it('adds only the extra inboxes the followers do not already reach', () => {
    const targets = fanOutTargets(
      [target('https://a.example/inbox', 'https://a.example/users/1')],
      [
        target('https://a.example/inbox', 'https://a.example/users/9'),
        target('https://c.example/inbox', 'https://c.example/users/4'),
      ],
    );

    assert.deepEqual(
      targets.map((each) => each.inboxId),
      ['https://a.example/inbox', 'https://c.example/inbox'],
    );
  });

  it('tells the author of what a post cites at their shared inbox', () => {
    const author = new Person({
      id: new URL('https://d.example/users/5'),
      inbox: new URL('https://d.example/users/5/inbox'),
    });

    assert.deepEqual(
      citedAuthor(author).map(({ inboxId, actorIds }) => ({ inboxId, actorIds })),
      [{ inboxId: 'https://d.example/users/5/inbox', actorIds: ['https://d.example/users/5'] }],
    );
    assert.deepEqual(citedAuthor(undefined), []);
    assert.deepEqual(citedAuthor(new Person({ id: new URL('https://d.example/users/6') })), []);
  });

  it('folds the mentioned accounts that share an inbox into one target', () => {
    const targets = objectTargets(undefined, [
      {
        handle: 'one@e.example',
        account: {
          profile: 'https://e.example/@one',
          actor: 'https://e.example/users/one',
          inbox: 'https://e.example/users/one/inbox',
          sharedInbox: 'https://e.example/inbox',
        },
      },
      {
        handle: 'two@e.example',
        account: {
          profile: 'https://e.example/@two',
          actor: 'https://e.example/users/two',
          inbox: 'https://e.example/users/two/inbox',
          sharedInbox: 'https://e.example/inbox',
        },
      },
      {
        handle: 'one@e.example',
        account: {
          profile: 'https://e.example/@one',
          actor: 'https://e.example/users/one',
          inbox: 'https://e.example/users/one/inbox',
          sharedInbox: 'https://e.example/inbox',
        },
      },
    ]);

    assert.deepEqual(
      targets.map(({ inboxId, actorIds }) => ({ inboxId, actorIds })),
      [
        {
          inboxId: 'https://e.example/inbox',
          actorIds: ['https://e.example/users/one', 'https://e.example/users/two'],
        },
      ],
    );
  });

  it('writes one outcome row per actor behind an inbox', () => {
    const about = {
      activityId: 'https://site.example/hello/#create',
      activityType: 'Create',
      objectId: 'https://site.example/hello/',
      slug: 'hello',
    };

    assert.deepEqual(
      deliveryRows(
        about,
        target('https://a.example/inbox', 'https://a.example/users/1', 'https://a.example/users/3'),
        {
          status: 'failed',
          error: 'refused',
        },
      ),
      [
        {
          ...about,
          actorId: 'https://a.example/users/1',
          inboxId: 'https://a.example/inbox',
          status: 'failed',
          error: 'refused',
        },
        {
          ...about,
          actorId: 'https://a.example/users/3',
          inboxId: 'https://a.example/inbox',
          status: 'failed',
          error: 'refused',
        },
      ],
    );
  });
});

describe('stamping', () => {
  it('stamps an unannounced post with its own date', () => {
    assert.equal(stampFor(post(), NOW), '2026-10-01T09:00:00.000Z');
  });

  it('stamps an undated post with the moment', () => {
    assert.equal(stampFor(post({ date: undefined }), NOW), NOW.toISOString());
  });

  it('leaves a post that is already stamped alone', () => {
    assert.equal(
      stampFor(post({ activitypub: { published: '2026-09-01T00:00:00.000Z' } }), NOW),
      undefined,
    );
  });
});

describe('what a change delivers', () => {
  it('delivers nothing for a full scan', () => {
    assert.equal(deliveryChange({ ...change(undefined, post()), origin: 'scan' }, NOW), undefined);
  });

  it('publishes a post that comes into view', () => {
    const next = post();
    assert.deepEqual(deliveryChange(change(undefined, next), NOW), {
      kind: 'publish',
      before: undefined,
      after: next,
      subject: next,
    });
  });

  it('withdraws a post that becomes a draft, with the draft as its subject', () => {
    const previous = post();
    const next = post({ draft: true });
    assert.deepEqual(deliveryChange(change(previous, next), NOW), {
      kind: 'withdraw',
      before: previous,
      subject: next,
    });
  });

  it('delivers nothing for a draft that stays one', () => {
    assert.equal(
      deliveryChange(change(post({ draft: true }), post({ draft: true })), NOW),
      undefined,
    );
  });

  it('delivers nothing for a migrated post its followers were never told about', () => {
    const migrated = post({ extra: { migrated: true } });
    assert.equal(deliveryChange(change(migrated, migrated), NOW), undefined);
  });

  it('delivers nothing for a migrated post coming into view, announced or not', () => {
    const migrated = post({
      extra: { migrated: true },
      activitypub: { published: '2026-01-01T00:00:00.000Z' },
    });
    assert.equal(deliveryChange(change(undefined, migrated), NOW), undefined);
  });

  it('delivers an edit to a migrated post its followers hold', () => {
    const migrated = post({
      extra: { migrated: true },
      activitypub: { published: '2026-01-01T00:00:00.000Z' },
    });
    assert.equal(deliveryChange(change(migrated, migrated), NOW)?.kind, 'publish');
  });
});

describe('what an edit sends', () => {
  const object: Shape = { kind: 'object', id: 'https://site.example/hello/', replyTo: undefined };

  it('revises the same object', () => {
    assert.deepEqual(revisionStep(object, { ...object }), { kind: 'revise', shape: object });
  });

  it('sends nothing again for the same like or repost', () => {
    const citing = { kind: 'citing', id: 'https://site.example/hello/#like', citing: {} } as Shape;
    assert.deepEqual(revisionStep(citing, citing), { kind: 'none' });
  });

  it('replaces an object that changed its id or became a like', () => {
    const renamed: Shape = { ...object, id: 'https://site.example/hi/' };
    const like = { kind: 'citing', id: 'https://site.example/hello/', citing: {} } as Shape;
    assert.deepEqual(revisionStep(object, renamed), { kind: 'replace' });
    assert.deepEqual(revisionStep(object, like), { kind: 'replace' });
  });
});

describe('pin changes', () => {
  const pinned = post({ extra: { pinned: '2026-10-05T00:00:00.000Z' } });

  it('pins a post newly featured, at the moment it was pinned', () => {
    assert.deepEqual(pinChange(true, post(), pinned, NOW), {
      action: 'pin',
      revision: '2026-10-05T00:00:00Z',
    });
  });

  it('pins a featured post its followers are meeting for the first time', () => {
    assert.deepEqual(pinChange(true, undefined, pinned, NOW)?.action, 'pin');
  });

  it('unpins a post no longer featured, at the moment', () => {
    assert.deepEqual(pinChange(false, pinned, post(), NOW), {
      action: 'unpin',
      revision: NOW.toISOString(),
    });
  });

  it('sends nothing when nothing moved', () => {
    assert.equal(pinChange(true, pinned, pinned, NOW), undefined);
    assert.equal(pinChange(false, post(), post(), NOW), undefined);
  });
});
