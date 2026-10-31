import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  createFederation,
  InProcessMessageQueue,
  MemoryKvStore,
  SendActivityError,
} from '@fedify/fedify';
import type { FederationOptions } from '@fedify/fedify';
import { Create, Note } from '@fedify/vocab';

import { nextEvent } from '../__testing__/wait.ts';
import type { DeliveryOutcome } from '../store/deliveries.ts';
import { testKeyPair } from './__testing__/keys.ts';
import { observeOutbox } from './outbox-observer.ts';
import { createCountingQueue } from './queue.ts';
import type { CountingQueue } from './queue.ts';

type Handler = (message: unknown) => Promise<void> | void;

const ACTIVITY = 'https://blog.example/activities/1';
const INBOX = 'https://remote.example/inbox';

function outbox(attempt = 0): Record<string, unknown> {
  return { type: 'outbox', activityId: ACTIVITY, inbox: INBOX, attempt };
}

const DUPLICATE_BODY = JSON.stringify({
  type: 'https://w3id.org/fep/c180#duplicate-delivery',
  title: 'Duplicate delivery',
  status: 400,
  detail: 'Activity already delivered',
});

function duplicate(): SendActivityError {
  return new SendActivityError(new URL(INBOX), 400, 'Bad Request', DUPLICATE_BODY);
}

function innerQueue(): {
  queue: CountingQueue;
  enqueued: unknown[];
  deliver(message: unknown): Promise<void>;
} {
  let listener: Handler = () => undefined;
  const enqueued: unknown[] = [];
  return {
    enqueued,
    queue: {
      kind: 'counting',
      enqueue(message) {
        enqueued.push(message);
        return Promise.resolve();
      },
      enqueueMany(messages) {
        enqueued.push(...messages);
        return Promise.resolve();
      },
      listen(handler) {
        listener = handler;
        return Promise.resolve();
      },
      settled: () => Promise.resolve(),
      close: () => undefined,
    },
    async deliver(message) {
      await listener(message);
    },
  };
}

function observed(): {
  outbox: ReturnType<typeof observeOutbox>;
  inner: ReturnType<typeof innerQueue>;
  outcomes: DeliveryOutcome[];
} {
  const inner = innerQueue();
  const outcomes: DeliveryOutcome[] = [];
  return {
    inner,
    outcomes,
    outbox: observeOutbox(inner.queue, (outcome) => {
      outcomes.push(outcome);
    }),
  };
}

describe('observeOutbox', () => {
  it('keeps a failure to record the outcome from reaching the queue', async () => {
    const inner = innerQueue();
    const observer = observeOutbox(inner.queue, () => {
      throw new Error('database is locked');
    });
    void observer.queue.listen(() => undefined);
    await inner.deliver(outbox());
    assert.deepEqual(inner.enqueued, []);
  });

  it('settles an outbox message whose handler raised no error as sent', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(() => undefined);
    await inner.deliver(outbox());
    assert.deepEqual(outcomes, [
      { activityId: ACTIVITY, inbox: INBOX, status: 'sent', error: null },
    ]);
  });

  it('settles a failed attempt Fedify queued a retry for as retrying, with the error', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(async (message) => {
      observer.onOutboxError(new Error('503 Service Unavailable'));
      await observer.queue.enqueue({ ...(message as object), attempt: 1 });
    });
    await inner.deliver(outbox());
    assert.deepEqual(outcomes, [
      { activityId: ACTIVITY, inbox: INBOX, status: 'retrying', error: '503 Service Unavailable' },
    ]);
    assert.equal(inner.enqueued.length, 1, 'the retry still reached the inner queue');
  });

  it('counts a retry sent through enqueueMany', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(async (message) => {
      observer.onOutboxError(new Error('refused'));
      await observer.queue.enqueueMany?.([{ ...(message as object), attempt: 1 }]);
    });
    await inner.deliver(outbox());
    assert.equal(outcomes[0]?.status, 'retrying');
  });

  it('settles an attempt the inbox already holds as sent, and drops its retry', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(async (message) => {
      observer.onOutboxError(duplicate());
      await observer.queue.enqueue({ ...(message as object), attempt: 1 });
    });
    await inner.deliver(outbox());
    assert.deepEqual(outcomes, [
      { activityId: ACTIVITY, inbox: INBOX, status: 'sent', error: null },
    ]);
    assert.deepEqual(inner.enqueued, []);
  });

  it('settles a 400 that is no duplicate delivery as it always did', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(async (message) => {
      observer.onOutboxError(
        new SendActivityError(new URL(INBOX), 400, 'Bad Request', '{"type":"about:blank"}'),
      );
      await observer.queue.enqueue({ ...(message as object), attempt: 1 });
    });
    await inner.deliver(outbox());
    assert.equal(outcomes[0]?.status, 'retrying');
    assert.equal(inner.enqueued.length, 1);
  });

  it('settles a failed attempt Fedify gave up on as failed, with the error', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(() => {
      observer.onOutboxError(new Error('410 Gone'));
    });
    await inner.deliver(outbox());
    assert.deepEqual(outcomes, [
      { activityId: ACTIVITY, inbox: INBOX, status: 'failed', error: '410 Gone' },
    ]);
  });

  it('does not count a message for another inbox as the retry', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(async () => {
      observer.onOutboxError(new Error('refused'));
      await observer.queue.enqueue({ ...outbox(1), inbox: 'https://other.example/inbox' });
    });
    await inner.deliver(outbox());
    assert.equal(outcomes[0]?.status, 'failed');
  });

  it('settles a message held for later without an error as queued', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(async (message) => {
      await observer.queue.enqueue({ ...(message as object), circuitHeld: true });
    });
    await inner.deliver(outbox());
    assert.deepEqual(outcomes, [
      { activityId: ACTIVITY, inbox: INBOX, status: 'queued', error: null },
    ]);
  });

  it('settles a handler that throws as retrying, for the queue to retry, and rethrows', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    void observer.queue.listen(() => {
      throw new Error('backend will retry');
    });
    await assert.rejects(inner.deliver(outbox()), /backend will retry/);
    assert.deepEqual(outcomes, [
      { activityId: ACTIVITY, inbox: INBOX, status: 'retrying', error: 'backend will retry' },
    ]);
  });

  it('settles nothing for a message that is not an outbox delivery', async () => {
    const { outbox: observer, inner, outcomes } = observed();
    const handled: unknown[] = [];
    void observer.queue.listen((message) => {
      handled.push(message);
    });
    await inner.deliver({ type: 'fanout', activityId: ACTIVITY });
    assert.deepEqual(outcomes, []);
    assert.equal(handled.length, 1);
  });

  it('ignores an error reported outside any delivery', () => {
    const { outbox: observer, outcomes } = observed();
    observer.onOutboxError(new Error('stray'));
    assert.deepEqual(outcomes, []);
  });

  it('keeps the queue it wraps recognisable as the same kind', () => {
    const { outbox: observer } = observed();
    assert.equal(observer.queue.kind, 'counting');
  });
});

describe('observeOutbox through Fedify', () => {
  const PEER = 'https://peer.example';
  const answers = new Map<string, number[]>();
  let restoreFetch: () => void = () => undefined;
  let keys: CryptoKeyPair;

  before(async () => {
    keys = await testKeyPair();
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.origin !== PEER) return await original(input, init);
      const statuses = answers.get(url.pathname) ?? [];
      const status = statuses.length > 1 ? (statuses.shift() ?? 202) : (statuses[0] ?? 202);
      if (url.pathname === '/holds-it') return new Response(DUPLICATE_BODY, { status: 400 });
      return new Response(status < 300 ? '' : 'Not now.', { status });
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
  });

  after(() => {
    restoreFetch();
  });

  async function deliverTo(
    pathname: string,
    statuses: number[],
    options: Partial<FederationOptions<void>> = {},
  ): Promise<DeliveryOutcome> {
    answers.set(pathname, statuses);
    let observer: ReturnType<typeof observeOutbox> | undefined;
    const settled = nextEvent<DeliveryOutcome>(`the delivery to ${pathname}`, (done) => {
      observer = observeOutbox(
        createCountingQueue(new InProcessMessageQueue(), () => Promise.resolve(false)),
        done,
      );
    });
    assert.ok(observer !== undefined);
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      queue: observer.queue,
      allowPrivateAddress: true,
      onOutboxError: observer.onOutboxError,
      ...options,
    });
    const controller = new AbortController();
    void federation.startQueue(undefined, { signal: controller.signal });
    const context = federation.createContext(new URL('https://blog.example'), undefined);
    const actor = new URL('https://blog.example/author/ada/');
    await context.sendActivity(
      { keyId: new URL('#main-key', actor), privateKey: keys.privateKey },
      { id: new URL(`${PEER}/users${pathname}`), inboxId: new URL(`${PEER}${pathname}`) },
      new Create({
        id: new URL(`https://blog.example/activities${pathname}`),
        actor,
        object: new Note({ id: new URL(`https://blog.example${pathname}`), content: 'Hi.' }),
      }),
    );
    try {
      return await settled;
    } finally {
      controller.abort();
    }
  }

  it('reports an accepted delivery as sent', async () => {
    const outcome = await deliverTo('/accepts', [202]);
    assert.deepEqual(outcome, {
      activityId: 'https://blog.example/activities/accepts',
      inbox: `${PEER}/accepts`,
      status: 'sent',
      error: null,
    });
  });

  it('reports a refused attempt Fedify will retry as retrying, with the status code', async () => {
    const outcome = await deliverTo('/busy', [500]);
    assert.equal(outcome.status, 'retrying');
    assert.match(outcome.error ?? '', /\b500\b/);
  });

  it('reports a refused attempt Fedify gave up retrying as failed', async () => {
    const outcome = await deliverTo('/gives-up', [500], { outboxRetryPolicy: () => null });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error ?? '', /\b500\b/);
  });

  it('reports an inbox that already holds the activity as sent', async () => {
    const outcome = await deliverTo('/holds-it', [400]);
    assert.deepEqual(outcome, {
      activityId: 'https://blog.example/activities/holds-it',
      inbox: `${PEER}/holds-it`,
      status: 'sent',
      error: null,
    });
  });

  it('reports a permanent refusal as failed', async () => {
    const outcome = await deliverTo('/gone', [410]);
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error ?? '', /\b410\b/);
  });
});
