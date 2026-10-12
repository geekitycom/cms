import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { nextEvent } from './wait.ts';

describe('nextEvent', () => {
  it('resolves with what the event carries', async () => {
    const emitter = new EventEmitter();
    const heard = nextEvent<string>('the greeting', (done) => {
      emitter.on('greet', done);
      return () => emitter.off('greet', done);
    });

    emitter.emit('greet', 'hello');

    assert.equal(await heard, 'hello');
    assert.equal(emitter.listenerCount('greet'), 0, 'it stopped listening');
  });

  it('resolves when the listener reports at once', async () => {
    let unsubscribed = false;
    await nextEvent('an event already there', (done) => {
      done(undefined);
      return () => {
        unsubscribed = true;
      };
    });
    assert.equal(unsubscribed, true);
  });

  it('fails, naming the event, when it never comes', async () => {
    const emitter = new EventEmitter();
    await assert.rejects(
      nextEvent(
        'the watcher to index about.md',
        (done) => {
          emitter.on('never', done);
          return () => emitter.off('never', done);
        },
        20,
      ),
      { message: 'the watcher to index about.md never came within 20 ms' },
    );
    assert.equal(emitter.listenerCount('never'), 0, 'it stopped listening');
  });

  it('fails at once when the listener says the event cannot come', async () => {
    await assert.rejects(
      nextEvent('the server to print its port', (_done, fail) => {
        fail(new Error('the server exited'));
      }),
      { message: 'the server to print its port: the server exited' },
    );
  });
});
