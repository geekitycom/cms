import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  AUTOSAVE_DELAY_MS,
  autosave,
  localCopyKey,
  readLocalCopy,
  statusMessage,
} from './autosave-client.ts';
import type { AutosaveStatus, SendOutcome, Snapshot } from './autosave-client.ts';

const KEY = 'posts/2026-01-02-hello.md';
const STORAGE_KEY = localCopyKey('https://example.com', '1', KEY);
const NOW = new Date('2026-10-23T12:03:00.000Z');

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A form, a server and a browser store the controller is wired to. */
function rig(answers: SendOutcome[] = []) {
  const form = new Map<string, string>([
    ['title', 'Hello'],
    ['body', 'Saved words.'],
    ['hash', 'abc'],
  ]);
  const sent: Snapshot[] = [];
  const beacons: Snapshot[] = [];
  let beaconWorks = true;
  const storage = new MemoryStorage();
  const statuses: AutosaveStatus[] = [];
  const pending: ((outcome: SendOutcome) => void)[] = [];
  let holding = false;

  const controller = autosave({
    key: KEY,
    storageKey: STORAGE_KEY,
    storage,
    now: () => NOW,
    read: () => [...form.entries()],
    send: (snapshot) => {
      sent.push(snapshot);
      if (holding) return new Promise((resolve) => pending.push(resolve));
      return Promise.resolve(answers.shift() ?? { kind: 'saved', savedAt: NOW.toISOString() });
    },
    beacon: (snapshot) => {
      beacons.push(snapshot);
      return beaconWorks;
    },
  });
  controller.subscribe((status) => statuses.push(status));

  return {
    controller,
    form,
    sent,
    beacons,
    storage,
    statuses,
    type: (value: string): void => {
      form.set('body', value);
      controller.changed();
    },
    hold: (): void => {
      holding = true;
    },
    release: (outcome: SendOutcome): void => {
      holding = false;
      pending.shift()?.(outcome);
    },
    beaconFails: (): void => {
      beaconWorks = false;
    },
  };
}

/** Let the promise callbacks a send queued run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => {
  mock.timers.reset();
});

describe('autosave', () => {
  it('posts the form once, two seconds after the last change', async () => {
    const { sent, type } = rig();
    type('A');
    mock.timers.tick(1500);
    type('AB');
    mock.timers.tick(1999);
    assert.equal(sent.length, 0, 'still typing');

    mock.timers.tick(1);
    await settle();

    assert.equal(sent.length, 1);
    assert.deepEqual(new Map(sent[0]).get('body'), 'AB');
    assert.equal(AUTOSAVE_DELAY_MS, 2000);
  });

  it('does not post a form that is the same as the one last saved', async () => {
    const { sent, type, controller } = rig();
    controller.changed();
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    controller.flush();
    await settle();
    assert.equal(sent.length, 0, 'nothing changed since the page loaded');

    type('New words.');
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    await settle();
    controller.changed();
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    controller.flush();
    await settle();
    assert.equal(sent.length, 1, 'posted once, not again for the same form');
  });

  it('posts straight away when a field loses focus with changes waiting', async () => {
    const { sent, type, controller } = rig();
    type('Blurred.');
    controller.flush();
    await settle();
    assert.equal(sent.length, 1);

    mock.timers.tick(AUTOSAVE_DELAY_MS);
    await settle();
    assert.equal(sent.length, 1, 'the debounce does not post it a second time');
  });

  it('waits for a post in flight, then posts what changed meanwhile', async () => {
    const r = rig();
    r.hold();
    r.type('One');
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    r.type('One two');
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    assert.equal(r.sent.length, 1, 'no second post while one is in flight');

    r.release({ kind: 'saved', savedAt: NOW.toISOString() });
    await settle();
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    await settle();
    assert.equal(r.sent.length, 2);
    assert.equal(new Map(r.sent[1]).get('body'), 'One two');
  });

  it('says where and when the copy was saved', async () => {
    const { statuses, type, controller } = rig();
    type('Saved.');
    controller.flush();
    await settle();
    assert.deepEqual(controller.status(), { state: 'server', at: NOW });
    assert.deepEqual(statuses.at(-1), { state: 'server', at: NOW });
    assert.equal(
      statusMessage(controller.status(), () => '12:03'),
      'Saved a copy at 12:03.',
    );
  });

  it('announces results only, not every keystroke', async () => {
    const { statuses, type, controller } = rig();
    for (const word of ['a', 'ab', 'abc', 'abcd']) type(word);
    assert.deepEqual(statuses, [], 'typing alone changes nothing');
    controller.flush();
    await settle();
    assert.equal(statuses.length, 1);
  });
});

describe('when the server cannot be reached', () => {
  it('keeps the fields in the browser and says so', async () => {
    const { storage, type, controller } = rig([{ kind: 'unreachable' }]);
    type('Offline words.');
    controller.flush();
    await settle();

    const copy = readLocalCopy(storage, STORAGE_KEY);
    assert.ok(copy !== undefined);
    assert.equal(copy.key, KEY);
    assert.equal(copy.hash, 'abc');
    assert.equal(copy.savedAt, NOW.toISOString());
    assert.equal(new Map(copy.fields).get('body'), 'Offline words.');
    assert.deepEqual(controller.status(), { state: 'browser', at: NOW });
    assert.equal(
      statusMessage(controller.status(), () => '12:03'),
      'Server unreachable — saved in this browser at 12:03.',
    );
  });

  it('retries with a growing wait, and removes the browser copy once the server has it', async () => {
    const { storage, sent, type, controller } = rig([
      { kind: 'unreachable' },
      { kind: 'unreachable' },
    ]);
    type('Offline words.');
    controller.flush();
    await settle();
    assert.equal(sent.length, 1);

    mock.timers.tick(1999);
    await settle();
    assert.equal(sent.length, 1);
    mock.timers.tick(1);
    await settle();
    assert.equal(sent.length, 2, 'first retry after 2 s');

    mock.timers.tick(3999);
    await settle();
    assert.equal(sent.length, 2);
    mock.timers.tick(1);
    await settle();
    assert.equal(sent.length, 3, 'second retry after 4 s');

    assert.equal(readLocalCopy(storage, STORAGE_KEY), undefined);
    assert.deepEqual(controller.status(), { state: 'server', at: NOW });
  });

  it('keeps the browser copy up to date as the writer goes on typing', async () => {
    const { storage, type, controller } = rig([{ kind: 'unreachable' }, { kind: 'unreachable' }]);
    type('One');
    controller.flush();
    await settle();
    type('One two');
    controller.flush();
    await settle();
    assert.equal(new Map(readLocalCopy(storage, STORAGE_KEY)?.fields).get('body'), 'One two');
  });
});

describe('when the session has ended', () => {
  it('keeps the browser copy, asks the writer to sign in again, and discards nothing', async () => {
    const { storage, sent, type, controller } = rig([{ kind: 'signed-out' }]);
    type('Words after the session ended.');
    controller.flush();
    await settle();

    assert.equal(
      new Map(readLocalCopy(storage, STORAGE_KEY)?.fields).get('body'),
      'Words after the session ended.',
    );
    assert.deepEqual(controller.status(), { state: 'signed-out', at: NOW });
    assert.match(
      statusMessage(controller.status(), () => '12:03'),
      /sign in again in another tab/i,
    );
    assert.ok(controller.unsaved(), 'the server still does not have it');

    mock.timers.tick(60_000);
    await settle();
    assert.equal(sent.length, 1, 'no retry loop against a dead session');

    type('More words.');
    controller.flush();
    await settle();
    assert.equal(sent.length, 2, 'the next change tries again');
    assert.equal(readLocalCopy(storage, STORAGE_KEY), undefined, 'and it worked');
  });

  it('keeps a copy and shows the reason for another refusal', async () => {
    const { storage, type, controller } = rig([{ kind: 'refused', message: 'Reload the editor.' }]);
    type('Words.');
    controller.flush();
    await settle();
    assert.ok(readLocalCopy(storage, STORAGE_KEY));
    assert.equal(
      statusMessage(controller.status(), () => '12:03'),
      'Reload the editor.',
    );
  });
});

describe('leaving the page', () => {
  it('has nothing unsaved until the writer changes something, and nothing once it is saved', async () => {
    const { type, controller } = rig();
    assert.equal(controller.unsaved(), false);
    type('Changed.');
    assert.equal(controller.unsaved(), true);
    controller.flush();
    await settle();
    assert.equal(controller.unsaved(), false);
  });

  it('has nothing unsaved once the form is being submitted', () => {
    const { type, controller } = rig();
    type('Changed.');
    controller.submitting();
    assert.equal(controller.unsaved(), false);
  });

  it('stops autosaving once the form is submitted, so a save is not followed by a copy', async () => {
    const { sent, beacons, type, controller } = rig();
    type('Changed.');
    controller.submitting();
    mock.timers.tick(AUTOSAVE_DELAY_MS);
    controller.leave();
    await settle();
    assert.equal(sent.length, 0);
    assert.equal(beacons.length, 0);
  });

  it('sends what is unsaved with a beacon on pagehide', () => {
    const { sent, beacons, type, controller, storage } = rig();
    controller.leave();
    assert.equal(beacons.length, 0, 'nothing to send');

    type('Last words.');
    controller.leave();
    assert.equal(beacons.length, 1);
    assert.equal(new Map(beacons[0]).get('body'), 'Last words.');
    assert.equal(sent.length, 0);
    assert.equal(readLocalCopy(storage, STORAGE_KEY), undefined);
  });

  it('keeps a browser copy when the beacon cannot be queued', () => {
    const r = rig();
    r.beaconFails();
    r.type('Too much to send.');
    r.controller.leave();
    assert.equal(
      new Map(readLocalCopy(r.storage, STORAGE_KEY)?.fields).get('body'),
      'Too much to send.',
    );
  });
});

describe('localCopyKey', () => {
  it('names the site, the user and the autosave key', () => {
    assert.equal(
      localCopyKey('https://example.com', '7', 'new-0123'),
      'geekity-autosave:https://example.com:7:new-0123',
    );
  });

  it('reads nothing from a value that is not a copy', () => {
    const storage = new MemoryStorage();
    storage.setItem('a', 'not json');
    storage.setItem('b', '{"version":2}');
    assert.equal(readLocalCopy(storage, 'a'), undefined);
    assert.equal(readLocalCopy(storage, 'b'), undefined);
    assert.equal(readLocalCopy(storage, 'missing'), undefined);
  });
});
