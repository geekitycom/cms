import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSupervisor, PLUGIN_POLL_MS, PLUGIN_SETTLE_MS } from './primary.ts';
import type { WorkerHandle } from './primary.ts';
import type { SupervisorMessage } from './protocol.ts';
import type { ReloadOutcome } from './supervision.ts';

/** A worker that records what it was told, and whether it was killed. */
interface FakeWorker extends WorkerHandle {
  readonly told: SupervisorMessage['type'][];
  killed: boolean;
}

interface FakeFolder {
  signature: string;
  fingerprint: string;
}

/** A supervisor over fake workers and a clock the test moves. */
function harness(options: { folder?: FakeFolder } = {}) {
  const { folder } = options;
  const workers: FakeWorker[] = [];
  const timers: { at: number; task: () => void; cancelled: boolean }[] = [];
  const lines: string[] = [];
  const exits: number[] = [];
  let now = 0;

  const supervisor = createSupervisor({
    fork() {
      const told: SupervisorMessage['type'][] = [];
      const worker: FakeWorker = {
        id: workers.length + 1,
        told,
        killed: false,
        send: (message) => told.push(message.type),
        kill: () => {
          worker.killed = true;
        },
      };
      workers.push(worker);
      return worker;
    },
    schedule(task, ms) {
      const timer = { at: now + ms, task, cancelled: false };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
    now: () => now,
    log: (line) => lines.push(line),
    exit: (code) => exits.push(code),
    watch:
      folder === undefined
        ? undefined
        : { signature: () => folder.signature, fingerprint: () => folder.fingerprint },
  });

  function worker(id: number): FakeWorker {
    const found = workers[id - 1];
    assert.ok(found !== undefined, `worker ${String(id)} was forked`);
    return found;
  }

  return {
    supervisor,
    workers,
    lines,
    exits,
    worker,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = due.at;
        due.cancelled = true;
        due.task();
      }
      now = end;
    },
    /** The next timer still waiting, as milliseconds from now. */
    nextTimer(): number | undefined {
      const waiting = timers.filter((timer) => !timer.cancelled).map((timer) => timer.at - now);
      return waiting.length === 0 ? undefined : Math.min(...waiting);
    },
  };
}

function serving(options: { folder?: FakeFolder } = {}) {
  const h = harness(options);
  h.supervisor.start();
  h.supervisor.message(h.worker(1), {
    type: 'ready',
    pluginsFingerprint: options.folder?.fingerprint ?? '',
  });
  return h;
}

describe('the supervisor', () => {
  it('reloads in order: drain the old worker, boot the new one, then retire the old', () => {
    const h = serving();

    h.supervisor.message(h.worker(1), { type: 'reload' });
    assert.deepEqual(h.worker(1).told, ['drain']);
    assert.equal(h.workers.length, 1, 'nothing boots until the old worker has drained');

    h.supervisor.message(h.worker(1), { type: 'drained' });
    assert.equal(h.workers.length, 2, 'the new worker boots once the old one writes nothing');
    assert.deepEqual(h.worker(1).told, ['drain'], 'the old worker serves until the new one does');

    h.supervisor.message(h.worker(2), { type: 'ready', pluginsFingerprint: '' });
    assert.deepEqual(h.worker(1).told, ['drain', 'retire']);

    h.supervisor.exited(h.worker(1), 0);
    assert.equal(h.workers.length, 2, 'a retired worker is not replaced');
    assert.deepEqual(h.exits, []);

    h.supervisor.message(h.worker(2), { type: 'reload' });
    assert.deepEqual(h.worker(2).told, ['drain'], 'the new worker can reload in its turn');
  });

  it('tells a worker that has closed to exit, after anything sent to it before', () => {
    const h = serving();
    h.supervisor.message(h.worker(1), { type: 'reload' });
    h.supervisor.message(h.worker(1), { type: 'drained' });
    h.supervisor.message(h.worker(2), { type: 'ready', pluginsFingerprint: '' });
    h.supervisor.message(h.worker(1), { type: 'closed' });
    assert.deepEqual(h.worker(1).told, ['drain', 'retire', 'exit']);
  });

  it('keeps the old worker when the new one fails to boot, telling it why', () => {
    const h = serving();
    h.supervisor.message(h.worker(1), { type: 'reload' });
    h.supervisor.message(h.worker(1), { type: 'drained' });

    h.supervisor.message(h.worker(2), { type: 'boot-failed', error: 'Two plugins share a name.' });
    h.supervisor.exited(h.worker(2), 1);

    assert.deepEqual(h.worker(1).told, ['drain', 'resume']);
    assert.ok(h.lines.some((line) => line.includes('Two plugins share a name.')));
    assert.equal(h.workers.length, 2, 'no respawn: the old worker carries on');

    h.supervisor.message(h.worker(1), { type: 'reload' });
    assert.deepEqual(h.worker(1).told, ['drain', 'resume', 'drain'], 'and can try again');
  });

  it('keeps the old worker when the new one exits before it is ready, saying nothing', () => {
    const h = serving();
    h.supervisor.message(h.worker(1), { type: 'reload' });
    h.supervisor.message(h.worker(1), { type: 'drained' });
    h.supervisor.exited(h.worker(2), 7);
    assert.deepEqual(h.worker(1).told, ['drain', 'resume']);
  });

  it('gives up on a new worker that is not ready in time, and keeps the old one', () => {
    const h = serving();
    h.supervisor.message(h.worker(1), { type: 'reload' });
    h.supervisor.message(h.worker(1), { type: 'drained' });

    h.advance(10 * 60_000);
    assert.equal(h.worker(2).killed, true);
    assert.deepEqual(h.worker(1).told, ['drain', 'resume']);

    h.supervisor.exited(h.worker(2), null);
    assert.equal(h.workers.length, 2);
  });

  it('respawns a worker that crashes, backing off while it keeps crashing', () => {
    const h = serving();

    h.supervisor.exited(h.worker(1), 1);
    const first = h.nextTimer();
    assert.ok(first !== undefined && first > 0, 'it waits before respawning');
    h.advance(first);
    assert.equal(h.workers.length, 2);

    h.supervisor.message(h.worker(2), { type: 'ready', pluginsFingerprint: '' });
    h.supervisor.exited(h.worker(2), 1);
    const second = h.nextTimer();
    assert.ok(second !== undefined && second > first, 'a second crash waits longer');
    h.advance(second);
    assert.equal(h.workers.length, 3);

    h.supervisor.message(h.worker(3), { type: 'ready', pluginsFingerprint: '' });
    h.advance(10 * 60_000);
    h.supervisor.exited(h.worker(3), 1);
    assert.equal(h.nextTimer(), first, 'a worker that stayed up resets the backoff');
    assert.deepEqual(h.exits, []);
  });

  it('respawns, with backoff, a worker that fails to boot after a crash', () => {
    const h = serving();
    h.supervisor.exited(h.worker(1), 1);
    h.advance(h.nextTimer() ?? 0);
    h.supervisor.message(h.worker(2), { type: 'boot-failed', error: 'The disk is full.' });
    h.supervisor.exited(h.worker(2), 1);
    assert.ok((h.nextTimer() ?? 0) > 0);
    assert.deepEqual(h.exits, []);
  });

  it('exits 1 when the first worker fails to boot, as geekity serve always has', () => {
    const h = harness();
    h.supervisor.start();
    h.supervisor.message(h.worker(1), { type: 'boot-failed', error: 'Config file not found' });
    h.supervisor.exited(h.worker(1), 1);
    assert.deepEqual(h.exits, [1]);
    assert.ok(h.lines.some((line) => line.includes('Config file not found')));
  });

  it('on a signal, shuts every worker down and exits 0 once they have gone', () => {
    const h = serving();
    h.supervisor.message(h.worker(1), { type: 'reload' });
    h.supervisor.message(h.worker(1), { type: 'drained' });

    h.supervisor.stop();
    assert.deepEqual(h.worker(1).told, ['drain', 'shutdown']);
    assert.deepEqual(h.worker(2).told, ['shutdown']);

    h.supervisor.exited(h.worker(1), 0);
    assert.deepEqual(h.exits, []);
    h.supervisor.exited(h.worker(2), 0);
    assert.deepEqual(h.exits, [0]);
    assert.equal(h.workers.length, 2, 'nothing is respawned on the way down');
  });

  it('on a signal while waiting to respawn, exits without starting another', () => {
    const h = serving();
    h.supervisor.exited(h.worker(1), 1);
    h.supervisor.stop();
    assert.deepEqual(h.exits, [0]);
    h.advance(60_000);
    assert.equal(h.workers.length, 1);
  });
});

function completeReload(h: ReturnType<typeof harness>, old: number, plugins: string): void {
  h.supervisor.message(h.worker(old), { type: 'drained' });
  h.supervisor.message(h.worker(h.workers.length), { type: 'ready', pluginsFingerprint: plugins });
}

describe('the supervisor watching the plugins folder', () => {
  it('reloads once the folder has stood still for the settle time', () => {
    const folder = { signature: 'one', fingerprint: 'A' };
    const h = serving({ folder });

    h.advance(PLUGIN_SETTLE_MS * 3);
    assert.deepEqual(h.worker(1).told, [], 'an unchanged folder is left alone');

    folder.signature = 'two';
    folder.fingerprint = 'B';
    h.advance(PLUGIN_SETTLE_MS);
    assert.deepEqual(h.worker(1).told, [], 'not before the folder has settled');
    h.advance(PLUGIN_POLL_MS * 2);
    assert.deepEqual(h.worker(1).told, ['drain']);
    assert.ok(h.lines.some((line) => line.includes('plugins folder changed')));

    completeReload(h, 1, 'B');
    assert.deepEqual(h.worker(1).told, ['drain', 'retire']);
    h.advance(PLUGIN_SETTLE_MS * 3);
    assert.deepEqual(h.worker(2).told, [], 'what the new worker loaded is not reloaded again');
  });

  it('restarts the wait when the folder changes while it settles', () => {
    const folder = { signature: 'one', fingerprint: 'A' };
    const h = serving({ folder });

    folder.signature = 'copying';
    h.advance(PLUGIN_SETTLE_MS - PLUGIN_POLL_MS);
    folder.signature = 'copied';
    folder.fingerprint = 'B';
    h.advance(PLUGIN_SETTLE_MS);
    assert.deepEqual(h.worker(1).told, [], 'the second change started the wait again');
    h.advance(PLUGIN_POLL_MS * 2);
    assert.deepEqual(h.worker(1).told, ['drain']);
  });

  it('skips the wait for an explicit reload, and does not reload again once settled', async () => {
    const folder = { signature: 'one', fingerprint: 'A' };
    const h = serving({ folder });

    folder.signature = 'two';
    folder.fingerprint = 'B';
    h.advance(PLUGIN_POLL_MS);
    const outcome = h.supervisor.reload();
    assert.deepEqual(h.worker(1).told, ['drain'], 'the reload starts at once');
    completeReload(h, 1, 'B');
    assert.deepEqual(await outcome, { ok: true });

    h.advance(PLUGIN_SETTLE_MS * 3);
    assert.equal(h.workers.length, 2, 'the settled folder is what the new worker loaded');
    assert.deepEqual(h.worker(2).told, []);
  });

  it('does not retry a failed reload until the folder changes again', () => {
    const folder = { signature: 'one', fingerprint: 'A' };
    const h = serving({ folder });

    folder.signature = 'broken';
    folder.fingerprint = 'B';
    h.advance(PLUGIN_SETTLE_MS + PLUGIN_POLL_MS * 2);
    h.supervisor.message(h.worker(1), { type: 'drained' });
    h.supervisor.message(h.worker(2), { type: 'boot-failed', error: 'Two plugins share a name.' });
    h.supervisor.exited(h.worker(2), 1);
    assert.deepEqual(h.worker(1).told, ['drain', 'resume']);

    h.advance(PLUGIN_SETTLE_MS * 10);
    assert.deepEqual(h.worker(1).told, ['drain', 'resume'], 'no loop');
    assert.equal(h.workers.length, 2);

    folder.signature = 'fixed';
    folder.fingerprint = 'C';
    h.advance(PLUGIN_SETTLE_MS + PLUGIN_POLL_MS * 2);
    assert.deepEqual(h.worker(1).told, ['drain', 'resume', 'drain'], 'a new change is tried');
  });

  it('does not retry an explicit reload that failed', async () => {
    const folder = { signature: 'one', fingerprint: 'A' };
    const h = serving({ folder });

    folder.signature = 'broken';
    folder.fingerprint = 'B';
    const outcome = h.supervisor.reload();
    h.supervisor.message(h.worker(1), { type: 'drained' });
    h.supervisor.message(h.worker(2), { type: 'boot-failed', error: 'Two plugins share a name.' });
    assert.deepEqual(await outcome, { ok: false, error: 'Two plugins share a name.' });

    h.advance(PLUGIN_SETTLE_MS * 10);
    assert.deepEqual(h.worker(1).told, ['drain', 'resume']);
  });

  it('runs one reload at a time, picking up a change made during one after it', async () => {
    const folder = { signature: 'one', fingerprint: 'A' };
    const h = serving({ folder });

    folder.signature = 'two';
    folder.fingerprint = 'B';
    const first = h.supervisor.reload();
    h.supervisor.message(h.worker(1), { type: 'drained' });

    folder.signature = 'three';
    folder.fingerprint = 'C';
    const second = h.supervisor.reload();
    h.advance(PLUGIN_SETTLE_MS * 2);
    assert.equal(h.workers.length, 2, 'nothing more boots while a reload runs');

    h.supervisor.message(h.worker(2), { type: 'ready', pluginsFingerprint: 'B' });
    assert.deepEqual(await first, { ok: true });
    assert.deepEqual(h.worker(2).told, ['drain'], 'the reload asked for during it follows');
    completeReload(h, 2, 'C');
    assert.deepEqual(await second, { ok: true });

    h.advance(PLUGIN_SETTLE_MS * 3);
    assert.deepEqual(h.worker(3).told, []);
  });

  it('reloads only when asked when the watch is off', async () => {
    const h = serving();
    h.advance(PLUGIN_SETTLE_MS * 10);
    assert.equal(h.nextTimer(), undefined, 'nothing polls');

    const outcome = h.supervisor.reload();
    completeReload(h, 1, '');
    assert.deepEqual(await outcome, { ok: true } satisfies ReloadOutcome);
  });

  it('answers an explicit reload asked for while stopping', async () => {
    const h = serving();
    h.supervisor.stop();
    const outcome = await h.supervisor.reload();
    assert.equal(outcome.ok, false);
  });
});
