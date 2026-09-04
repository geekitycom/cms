/**
 * Federation smoke test: a real server, the real `@fedify/cli`, and real
 * deliveries over real sockets.
 *
 * Everything else that covers federation runs inside one process. The unit
 * tests build objects, the HTTP tests drive `cms.app.request` without ever
 * binding a port, and `src/federation/delivery.test.ts` replaces `fetch` so a
 * follower's inbox is a function call. That is the right shape for a fast
 * suite, and it leaves one thing unproven: whether another implementation of
 * ActivityPub, talking to us over the network, gets what it expects.
 *
 * So this script boots the CMS on a free port over a copy of
 * `test/fixtures/federation/`, and then:
 *
 *   1. `fedify lookup` fetches the actor, and checks it is the actor we serve.
 *   2. `fedify lookup` fetches a published post's ActivityStreams object.
 *   3. `fedify inbox` spins up an ephemeral actor on a second port, and is
 *      registered as a follower.
 *   4. A second peer, built in this file out of Fedify itself, sends a real
 *      signed `Follow` from a third port. The CMS has to verify it, answer
 *      `Accept`, and store the follower.
 *   5. A new post file is copied into the watched content directory, and the
 *      `Create(Article)` that follows has to reach both inboxes.
 *
 * It is `pnpm fed:smoke` from the workspace root and the `fed-smoke` job in
 * CI. Nothing here writes inside the repository: the fixture is copied into a
 * temporary directory, and the directories and the child process go on the way
 * out, whether the run passed or not.
 *
 * Three constraints shaped the script and are worth knowing before changing it.
 *
 * - Every server here is on loopback over plain http, which Fedify blocks by
 *   default as an SSRF risk. The CMS and the in-script peer are both built
 *   with `allowPrivateAddress`, and `fedify lookup` is given `-p`.
 * - `fedify inbox --follow` is *not* how the follower at step 3 is registered,
 *   and it cannot be: that command builds its document loader with
 *   `allowPrivateAddress` false and offers no flag or config key to change it
 *   (see `dist/docloader.js` and the `inbox` schema in `dist/config.js` in
 *   `@fedify/cli` 2.3.6), so it answers `Not an actor` for any loopback URL.
 *   Its inbox still receives and decodes what is posted to it, so it is
 *   registered the way an accepted `Follow` would have registered it and used
 *   as a delivery target; step 4 is what proves the handshake, over a socket,
 *   against a peer that *can* be told to allow loopback. The same restriction
 *   makes that inbox answer 500 after it has displayed the activity — its
 *   listener dereferences the sending actor — so the run asserts on what it
 *   displayed rather than on the status it returned, and the CMS logging
 *   "Could not deliver" for that one inbox is expected output.
 * - `fedify inbox` draws a box-drawing table on stdout and keeps drawing as
 *   activities arrive. It has no machine-readable mode, so it is read as a log
 *   rather than parsed: the escape codes are stripped and the text is
 *   searched. `@fedify/cli` is pinned to an exact version for that reason —
 *   what this script reads is its human-readable output, which no version
 *   range promises to keep.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { createFederation, generateCryptoKeyPair, MemoryKvStore } from '@fedify/fedify';
import { Accept, Application, Create, Endpoints, Follow, isActor } from '@fedify/vocab';

import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../src/admin/settings.ts';
import { createCms } from '../src/index.ts';
import type { Cms } from '../src/index.ts';

/** The package root, so the fixture is found however the script was invoked. */
const PACKAGE_DIR = path.resolve(fileURLToPath(import.meta.url), '../..');

/** The content directory the run starts from, and the post it publishes late. */
const FIXTURE_DIR = path.join(PACKAGE_DIR, 'test', 'fixtures', 'federation');
const PENDING_POST = '2026-03-05-hot-off-the-press.md';

/** The handle the site answers to. `blog` is the default; it is named to assert on it. */
const ACTOR_HANDLE = 'blog';

/** How long any one wait may take before the run is called a failure. */
const STEP_TIMEOUT_MS = 30_000;
/** How often a wait re-checks the thing it is waiting for. */
const POLL_MS = 100;

/**
 * Output worth printing when the run fails, and not otherwise.
 *
 * A child process that never got where it was going has usually said why, but
 * printing a redrawing terminal UI through a passing run would bury the dozen
 * lines that matter.
 */
const diagnostics: { label: string; text: () => string }[] = [];

/** One thing that has to become true, and how long the run may wait for it. */
interface Wait<T> {
  /** What is being waited for, for the failure message. */
  what: string;
  /** The value once it exists, or `undefined` while it does not. */
  poll: () => T | undefined;
  timeoutMs?: number;
}

async function main(): Promise<void> {
  const cleanups: (() => Promise<void>)[] = [];

  try {
    // ---------------------------------------------------------------- the site
    const port = await freePort();
    const baseUrl = `http://localhost:${String(port)}`;

    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-fed-smoke-data-'));
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-fed-smoke-content-'));
    cleanups.push(async () => {
      await rm(dataDir, { recursive: true, force: true });
      await rm(contentDir, { recursive: true, force: true });
    });
    await cp(path.join(FIXTURE_DIR, 'content'), contentDir, { recursive: true });

    // The settings are written before the CMS boots, so the actor has its
    // handle and its type from the very first request. `baseUrl` has to match
    // the port the server is about to bind: it is what every ActivityStreams
    // id in this run is built from.
    await writeSiteJson({
      contentDir,
      settings: {
        ...DEFAULT_SITE_SETTINGS,
        title: 'Federation Smoke',
        tagline: 'A site that exists for one test',
        baseUrl,
        timezone: 'UTC',
        postsPerPage: 10,
        author: 'andrew',
        actorHandle: ACTOR_HANDLE,
        actorType: 'Person',
        avatar: '',
      },
    });

    log(`booting the site on ${baseUrl}`);
    const cms: Cms = createCms({
      port,
      dataDir,
      contentDir,
      baseUrl,
      // The watcher is what turns a file appearing in `posts/` into a
      // `Create`, which is the last step of the run.
      watch: true,
      // No queue, so a delivery has already been attempted by the time
      // `settled()` resolves; private addresses allowed, because every peer in
      // this run is on loopback.
      federation: { queue: null, allowPrivateAddress: true },
    });
    cleanups.push(() => cms.close());

    const bound = await cms.serve();
    assert.equal(bound.port, port, 'the site bound the port its base URL names');
    ok(`the site is listening on ${baseUrl}`);

    const actorUrl = `${baseUrl}/ap/actor`;

    // ------------------------------------------------------- fedify lookup ×2
    log(`fedify lookup ${actorUrl}`);
    const actor = await lookup(actorUrl);
    assert.equal(actor['id'], actorUrl, 'the actor document names the actor URL as its id');
    assert.equal(actor['type'], 'Person', 'the actor is a Person');
    assert.equal(actor['preferredUsername'], ACTOR_HANDLE, 'the actor keeps its handle');
    for (const key of ['inbox', 'outbox', 'followers', 'publicKey'] as const) {
      assert.ok(actor[key] !== undefined, `the actor document carries ${key}`);
    }
    ok(`the actor is @${ACTOR_HANDLE}@localhost:${String(port)} (${String(actor['name'])})`);

    // The object id of the post the fixture shipped, which the boot scan has
    // just indexed. Reading the slug back rather than hard-coding it keeps the
    // script honest about how a filename becomes a slug.
    const existing = cms.store.listPosts()[0];
    assert.ok(existing !== undefined, 'the fixture content directory holds a published post');
    const objectUrl = `${baseUrl}/ap/posts/${existing.slug}`;

    log(`fedify lookup ${objectUrl}`);
    const article = await lookup(objectUrl);
    assert.equal(article['id'], objectUrl, 'the post object names its own id');
    assert.equal(article['type'], 'Article', 'a published post is an Article');
    assert.equal(article['attributedTo'], actorUrl, 'the post is attributed to the site actor');
    assert.equal(article['name'], existing.title, 'the post object carries the post title');
    ok(`the post object is an Article titled ${JSON.stringify(existing.title)}`);

    // ---------------------------------------------------- the ephemeral inbox
    log('starting fedify inbox');
    const cli = startCliInbox();
    cleanups.push(() => cli.stop());

    const cliActor = await waitFor({
      what: 'the ephemeral inbox to print its actor URI',
      poll: () => /Actor URI:[^\n]*?(http:\/\/[^\s\u2502|]+)/.exec(cli.output())?.[1],
    });
    const cliInbox = await waitFor({
      what: 'the ephemeral inbox to print its inbox URI',
      poll: () => /Actor inbox:[^\n]*?(http:\/\/[^\s\u2502|]+)/.exec(cli.output())?.[1],
    });
    // Registered rather than followed: see the note at the top of the file
    // about `fedify inbox --follow` and loopback. These are the columns an
    // accepted `Follow` from that actor would have written.
    cms.admin.putFollower({
      actorId: cliActor,
      inboxId: cliInbox,
      sharedInboxId: null,
      handle: null,
      name: 'Fedify Ephemeral Inbox',
      iconUrl: null,
      url: null,
    });
    ok(`the ephemeral inbox is ${cliActor}, delivering to ${cliInbox}`);

    // ------------------------------------------------------ a real Follow
    log('following the actor from a peer built out of Fedify');
    const peer = await startPeer(await freePort());
    cleanups.push(() => peer.stop());

    await peer.follow(actorUrl);
    // Two things have to happen, and each is the other's evidence: the CMS
    // verified the signature on the `Follow` and stored the follower, and the
    // `Accept` it answered with reached the peer and verified there too.
    const follower = await waitFor({
      what: 'the Follow to be accepted and the follower stored',
      poll: () => cms.admin.getFollower(peer.actorId),
    });
    assert.equal(follower.inboxId, peer.inboxId, 'the stored follower names the peer’s inbox');
    await waitFor({
      what: 'the Accept to arrive at the peer',
      poll: () => peer.received().find((activity) => activity.type === 'Accept'),
    });
    ok(`accepted a Follow from ${peer.actorId} and the peer got the Accept`);

    // ----------------------------------------------------------- the delivery
    log(`publishing ${PENDING_POST} into the watched content directory`);
    note(
      `expect one "Could not deliver ... to ${cliInbox}": the ephemeral inbox\n` +
        '    answers 500 because it may not dereference a sender on loopback.',
    );
    await cp(
      path.join(FIXTURE_DIR, 'publish', PENDING_POST),
      path.join(contentDir, 'posts', PENDING_POST),
    );

    const activity = await waitFor({
      what: 'the watcher to see the new post and the delivery service to build a Create',
      poll: () => cms.admin.listOutboundActivities().find((sent) => sent.activityType === 'Create'),
    });
    ok(`built ${activity.activityId}`);

    // `settled()` waits for the POSTs themselves; the rows they leave behind
    // say where each one went and how it ended.
    await cms.delivery.settled();
    const deliveries = await waitFor({
      what: 'both deliveries of the Create to be recorded',
      poll: () => {
        const rows = cms.admin.listDeliveries(activity.activityId);
        return rows.length === 2 ? rows : undefined;
      },
    });
    ok(`delivered ${activity.activityType} to ${String(deliveries.length)} inboxes`);

    // Matched on the follower rather than the inbox: the peer publishes a
    // shared inbox, and delivering one activity to a shared inbox rather than
    // to every personal inbox behind it is the whole point of having one.
    const toPeer = deliveries.find((delivery) => delivery.actorId === peer.actorId);
    assert.ok(toPeer !== undefined, `a delivery was recorded against ${peer.actorId}`);
    assert.equal(
      toPeer.inboxId,
      peer.sharedInboxId,
      'the peer was delivered to through its shared inbox',
    );
    assert.equal(
      toPeer.status,
      'sent',
      `the peer accepted the Create${toPeer.error === null ? '' : `: ${toPeer.error}`}`,
    );

    const create = await waitFor({
      what: 'the peer to receive the Create',
      poll: () => peer.received().find((entry) => entry.type === 'Create'),
      timeoutMs: 5000,
    });
    assert.equal(create.objectType, 'Article', 'the peer received a Create of an Article');
    assert.equal(create.objectId, activity.objectId, 'the peer received this post’s object');
    ok(`the peer accepted Create(Article) of ${create.objectId}`);

    // `fedify inbox` renders what it receives as a table, so this one is read
    // off its screen: the line proves the CLI parsed our JSON-LD into a
    // `Create` whose object is an `Article`, which is what the leg is for.
    //
    // It then answers 500 rather than 202, and that is not our bug: its
    // listener dereferences the sending actor through a document loader built
    // with `allowPrivateAddress` false, so any activity from a loopback sender
    // throws there. The status of its delivery row is therefore not asserted.
    await waitFor({
      what: 'the ephemeral inbox to display the Create(Article) it received',
      poll: () => (/Activity type:[^\n]*Create\(Article\)/.test(cli.output()) ? true : undefined),
      timeoutMs: 5000,
    });
    ok(`the ephemeral inbox displayed Create(Article) at ${cliInbox}`);

    log('federation smoke passed');
  } finally {
    // Reverse order: the peers and the CMS go before the directories they were
    // reading. A cleanup that throws must not hide an earlier failure.
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        console.error('cleanup failed:', error);
      }
    }
  }
}

/**
 * A port nothing is listening on.
 *
 * A server could bind port 0 and report what it got, but each base URL has to
 * be known before the server is built — it is what the actor id and every
 * object id are minted from — so the port is chosen first and handed over.
 * Between the probe closing and the server binding there is a window in which
 * something else could take it; binding would then throw, which is a clear
 * enough failure for a smoke test.
 */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        if (port === 0) reject(new Error('the operating system offered no port'));
        else resolve(port);
      });
    });
  });
}

// --------------------------------------------------------------------- the CLI

/**
 * `fedify lookup` on one URL, as the JSON-LD it fetched.
 *
 * `--raw` prints the document as it arrived rather than the human-readable
 * summary, and `--allow-private-address` covers the URLs Fedify follows out of
 * it. The URL on the command line is allowed either way.
 */
async function lookup(url: string): Promise<Record<string, unknown>> {
  const result = await fedify(['lookup', '--raw', '--allow-private-address', url]);
  if (result.code !== 0) {
    throw new Error(`fedify lookup ${url} exited ${String(result.code)}:\n${result.output}`);
  }

  const json: unknown = JSON.parse(result.stdout);
  assert.ok(
    typeof json === 'object' && json !== null && !Array.isArray(json),
    `fedify lookup ${url} printed a JSON object`,
  );
  return json as Record<string, unknown>;
}

/** What a finished `fedify` run said. */
interface FedifyResult {
  code: number | null;
  stdout: string;
  /** Both streams interleaved, for a failure message. */
  output: string;
}

/**
 * Run the `fedify` binary and wait for it.
 *
 * The binary is on PATH because this script runs as a package script and pnpm
 * puts `node_modules/.bin` there; `@fedify/cli` is a devDependency of this
 * package so CI installs it from the lockfile rather than fetching it.
 */
async function fedify(args: string[]): Promise<FedifyResult> {
  return await new Promise<FedifyResult>((resolve, reject) => {
    const child = spawn('fedify', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let output = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`fedify ${args.join(' ')} did not finish within ${timeoutSeconds()}s`));
    }, STEP_TIMEOUT_MS);
    timer.unref();

    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, output });
    });
  });
}

function timeoutSeconds(): string {
  return String(STEP_TIMEOUT_MS / 1000);
}

/** A running `fedify inbox`, and what it has printed so far. */
interface CliInbox {
  /** Everything it has written to either stream, with the escape codes gone. */
  output(): string;
  /** Stop it, and wait for it to be gone. */
  stop(): Promise<void>;
}

/**
 * Spin up `fedify inbox` on loopback.
 *
 * `--no-tunnel` keeps it local; without it the CLI opens a public HTTPS tunnel
 * through a third-party service, which is the right tool for testing against a
 * real Mastodon instance (the README says how) and the wrong one for a check
 * that has to pass on a runner with no inbound network.
 */
function startCliInbox(): CliInbox {
  // `stdio` names both streams as pipes, so `child.stdout` and `child.stderr`
  // are readable rather than null.
  const child = spawn('fedify', ['inbox', '--no-tunnel'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let seen = '';
  const record = (chunk: Buffer): void => {
    seen += stripAnsi(chunk.toString('utf8'));
  };
  diagnostics.push({ label: 'fedify inbox said', text: () => seen });
  child.stdout.on('data', record);
  child.stderr.on('data', record);

  return {
    output: () => seen,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        child.once('close', () => {
          resolve();
        });
        child.kill('SIGTERM');
        // The CLI is drawing a terminal UI; if SIGTERM is not enough, insist.
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 2000);
        timer.unref();
      });
    },
  };
}

/**
 * Drop the escape codes a terminal UI writes, so the output can be searched.
 *
 * Colours, cursor moves and the box-drawing table `fedify inbox` redraws all
 * arrive as CSI sequences; what is left is the text a human would read.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point.
  return text.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');
}

// -------------------------------------------------------------------- the peer

/** One activity the peer's inbox accepted, flattened to what the run asserts on. */
interface ReceivedActivity {
  /** `Accept`, `Create`, and so on. */
  type: string;
  /** The type of the activity's object, when it has one. */
  objectType?: string;
  /** The id of the activity's object, when it has one. */
  objectId?: string;
}

/** A peer that follows the site and keeps what it is sent. */
interface Peer {
  /** The peer's ActivityStreams id, which is what the CMS stores it under. */
  actorId: string;
  /** Where the CMS delivers to it. */
  inboxId: string;
  /** Its instance-wide inbox, which is where a delivery actually goes. */
  sharedInboxId: string;
  /** Send a signed `Follow` to the actor at this URL. */
  follow(actorUrl: string): Promise<void>;
  /** Everything its inbox has accepted, in arrival order. */
  received(): ReceivedActivity[];
  /** Stop listening. */
  stop(): Promise<void>;
}

/** The one actor the peer serves. */
const PEER_IDENTIFIER = 'peer';

/**
 * A second ActivityPub server, on loopback, built out of the same Fedify the
 * CMS uses.
 *
 * This is what `fedify inbox --follow` would have been if it could be told to
 * allow a loopback address. It exists to make the handshake real: the `Follow`
 * it sends is signed with a key the CMS has to fetch and verify, and the
 * `Accept` and the `Create` that come back are verified against the CMS's own
 * key before they are recorded. Nothing is stubbed; both ends are talking HTTP
 * to a port.
 *
 * No queue, so `sendActivity` has finished when it resolves, and
 * `allowPrivateAddress` because the site it is talking to is on localhost.
 */
async function startPeer(port: number): Promise<Peer> {
  const origin = `http://localhost:${String(port)}`;
  const keyPair = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
  const received: ReceivedActivity[] = [];

  const federation = createFederation<undefined>({
    kv: new MemoryKvStore(),
    origin,
    allowPrivateAddress: true,
  });

  federation
    .setActorDispatcher(`/users/{identifier}`, async (context, identifier) => {
      if (identifier !== PEER_IDENTIFIER) return null;
      // The CMS dereferences this document to verify the signature on the
      // `Follow`, so the keys have to be on it: `publicKeys` for the
      // draft-cavage signatures Fedify knocks with first, `assertionMethods`
      // for the RFC 9421 ones it prefers.
      const keyPairs = await context.getActorKeyPairs(identifier);
      return new Application({
        id: context.getActorUri(identifier),
        preferredUsername: identifier,
        name: 'Smoke Test Peer',
        summary: 'An ActivityPub server that exists for the length of one smoke test.',
        inbox: context.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
        publicKeys: keyPairs.map((pair) => pair.cryptographicKey),
        assertionMethods: keyPairs.map((pair) => pair.multikey),
      });
    })
    .setKeyPairsDispatcher((_context, identifier) =>
      identifier === PEER_IDENTIFIER ? [keyPair] : [],
    );

  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
    .on(Accept, () => {
      received.push({ type: 'Accept' });
    })
    .on(Create, async (_context, create) => {
      const object = await create.getObject();
      received.push({
        type: 'Create',
        ...(object === null ? {} : { objectType: object.constructor.name }),
        ...(object?.id == null ? {} : { objectId: object.id.href }),
      });
    });

  const server = serve({
    port,
    hostname: '127.0.0.1',
    fetch: (request: Request) => federation.fetch(request, { contextData: undefined }),
  });

  const context = federation.createContext(new URL(origin), undefined);
  return {
    actorId: context.getActorUri(PEER_IDENTIFIER).href,
    inboxId: context.getInboxUri(PEER_IDENTIFIER).href,
    sharedInboxId: context.getInboxUri().href,
    received: () => received,
    follow: async (actorUrl: string) => {
      const target = await context.lookupObject(actorUrl);
      if (!isActor(target)) throw new Error(`the peer could not resolve ${actorUrl} as an actor`);
      await context.sendActivity(
        { identifier: PEER_IDENTIFIER },
        target,
        new Follow({
          id: new URL(
            `#follows/${encodeURIComponent(actorUrl)}`,
            context.getActorUri(PEER_IDENTIFIER),
          ),
          actor: context.getActorUri(PEER_IDENTIFIER),
          object: new URL(actorUrl),
        }),
      );
    },
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

// ------------------------------------------------------------------ the plumbing

/**
 * Poll until something exists, or fail the run saying what never happened.
 *
 * Everything this script waits on is an effect rather than a promise: a
 * debounced watcher, a child process that has not written its banner yet, an
 * activity still in flight. There is nothing to await but the result.
 */
async function waitFor<T>(wait: Wait<T>): Promise<T> {
  const timeoutMs = wait.timeoutMs ?? STEP_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const found = wait.poll();
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${String(timeoutMs / 1000)}s waiting for ${wait.what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function log(message: string): void {
  console.log(`\n\u001B[1m==> ${message}\u001B[0m`);
}

function ok(message: string): void {
  console.log(`ok  ${message}`);
}

/** Something the reader should not mistake for a failure. */
function note(message: string): void {
  console.log(`--  ${message}`);
}

try {
  await main();
} catch (error) {
  console.error(`\nfederation smoke failed: ${error instanceof Error ? error.message : ''}`);
  if (!(error instanceof Error)) console.error(error);
  else if (error.stack !== undefined) console.error(error.stack);
  for (const diagnostic of diagnostics) {
    console.error(`\n--- ${diagnostic.label} ---\n${diagnostic.text().trimEnd()}`);
  }
  process.exitCode = 1;
}
