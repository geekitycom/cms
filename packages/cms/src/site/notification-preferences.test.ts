import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  notificationEvent,
  notificationMode,
  notificationSwitches,
  withNotificationMode,
} from './notification-preferences.ts';
import type { NotificationEvent } from './notification-preferences.ts';
import type { User } from './users.ts';

/** A registry with a noisy event that defaults to a digest, beside a quiet one. */
const EVENTS: readonly NotificationEvent[] = [
  {
    name: 'quiet',
    label: 'Quiet',
    description: 'Rare.',
    byDefault: true,
    batched: true,
    defaultMode: 'immediately',
  },
  {
    name: 'noisy',
    label: 'Noisy',
    description: 'Often.',
    byDefault: true,
    batched: true,
    defaultMode: 'daily',
  },
  { name: 'single', label: 'Single', description: 'Once.', byDefault: true, batched: false },
];

function user(fields: Partial<User> = {}): User {
  return {
    id: 1,
    uid: 'u',
    username: 'ada',
    passwordHash: 'x',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  } as User;
}

describe('a delivery mode each event declares', () => {
  it('is what a user who has said nothing gets', () => {
    assert.equal(notificationMode(user(), 'quiet', EVENTS), 'immediately');
    assert.equal(notificationMode(user(), 'noisy', EVENTS), 'daily');
    assert.equal(notificationMode(user(), 'single', EVENTS), 'immediately');
  });

  it('gives way to a stored choice, and a stored mode nothing knows reads as the default', () => {
    assert.equal(
      notificationMode(user({ notificationModes: { noisy: 'immediately' } }), 'noisy', EVENTS),
      'immediately',
    );
    assert.equal(
      notificationMode(user({ notificationModes: { noisy: 'fortnightly' } }), 'noisy', EVENTS),
      'daily',
    );
  });

  it('is never written down, while any other choice is', () => {
    assert.deepEqual(withNotificationMode(undefined, 'noisy', 'immediately', EVENTS), {
      noisy: 'immediately',
    });
    assert.equal(withNotificationMode({ noisy: 'hourly' }, 'noisy', 'daily', EVENTS), undefined);
    assert.deepEqual(withNotificationMode(undefined, 'quiet', 'hourly', EVENTS), {
      quiet: 'hourly',
    });
    assert.equal(
      withNotificationMode({ quiet: 'hourly' }, 'quiet', 'immediately', EVENTS),
      undefined,
    );
  });

  it('drops an unknown mode, an unknown event, and a mode for an event that cannot batch', () => {
    assert.equal(withNotificationMode({ noisy: 'hourly' }, 'noisy', 'weekly', EVENTS), undefined);
    assert.equal(withNotificationMode(undefined, 'a-future-event', 'hourly', EVENTS), undefined);
    assert.equal(withNotificationMode(undefined, 'single', 'hourly', EVENTS), undefined);
  });

  it('is the mode the switches show as chosen', () => {
    const noisy = notificationSwitches(user(), EVENTS).find((each) => each.name === 'noisy');
    assert.equal(noisy?.mode, 'daily');
    assert.deepEqual(
      noisy?.modes.filter((each) => each.chosen).map((each) => each.value),
      ['daily'],
    );
  });
});

describe('the registry', () => {
  it('still calls the review notice comments, so preferences saved before still apply', () => {
    const comments = notificationEvent('comments');
    assert.ok(comments !== undefined);
    assert.equal(comments.batched, true);
    assert.equal(
      notificationMode(user({ notificationModes: { comments: 'hourly' } }), 'comments'),
      'hourly',
    );
  });
});
