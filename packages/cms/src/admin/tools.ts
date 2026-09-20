/**
 * Tools > Content index: reading every file again, on a site that is serving.
 *
 * `geekity rebuild` deletes `data/geekity.db` and boots a fresh CMS, so it
 * refuses to run while a server holds the file — and in a container the server
 * is PID 1, which makes the only route stopping the container, running a
 * one-off one, and starting it again. This is the same repair without the
 * downtime: nothing is deleted and no connection is swapped, so the services
 * that captured the store objects at boot — the renderer, delivery, the
 * scheduler, comments, webmentions, the relays — go on working against the
 * same objects while the rows underneath them are replaced.
 *
 * It is also kinder than the command. Because nothing is deleted it keeps the
 * sessions, so the admin who pressed the button is still signed in when the
 * redirect lands; it keeps the delivery log and the relay handshakes; and it
 * keeps the scheduler's watermark, so a post that came due during the rebuild
 * is still announced. The command stays as it is for the one case an admin
 * screen cannot be the door for: a database this version refuses to open,
 * where there is no running server to press a button in.
 */

import type { Context, Hono } from 'hono';

import { rebuildCommentIndexes } from '../comments/records.ts';
import type { ContentStore } from '../content/store.ts';
import type { SyncResult } from '../content/sync.ts';
import type { GeekityEnv } from '../env.ts';
import { rebuildFederationIndexes } from '../federation/records.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import type { AdminStore } from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * Where the Content index screen lives.
 *
 * `/admin/tools` itself rather than `/admin/tools/content-index`, the way
 * General is `/admin/settings` itself: a section's heading lands on its first
 * child, and this is the first one.
 */
export const TOOLS_PATH = `${ADMIN_PREFIX}/tools`;

/** Where the Rebuild button posts. */
export const REBUILD_INDEX_PATH = `${ADMIN_PREFIX}/tools/rebuild-index`;

/** The navigation section the screen marks as current. */
export const TOOLS_SECTION = 'tools';

/** The child of that section it is. */
export const CONTENT_INDEX_CHILD = 'index';

/** The fields the form on the screen submits. */
export const TOOLS_FIELDS = {
  /** Set once the admin has been shown what a rebuild costs while it runs. */
  confirm: 'confirm',
} as const;

/** What one in-place rebuild put back. */
export interface ContentIndexRebuild {
  /** What the scan of `content/` did, exactly as `cms.sync()` reports it. */
  scan: SyncResult;
  /** How many followers the federation files held. */
  followers: number;
  /** How many inbox activities the log held. */
  activities: number;
  /** How many comments the comment files held. */
  comments: number;
}

/** What {@link rebuildContentIndex} needs. */
export interface RebuildContentIndexOptions {
  /** The index to empty and fill again. */
  store: ContentStore;
  /** The database the federation and comment indexes live in. */
  admin: AdminStore;
  /** The content directory every one of them is read from. */
  contentDir: string;
  /** The full scan, which is `cms.sync()`: see {@link GeekityEnv} `rescan`. */
  rescan: () => Promise<SyncResult>;
}

/**
 * Read `content/` back into the index, in place, on the live connections.
 *
 * The three rebuilds are the three that already run on every boot, in the
 * order boot runs them, so a rebuilt index and a booted one are the same
 * index. The only thing here that boot does not do is the clear — boot is
 * cold — and the clear is what makes the scan read every file: a row whose
 * hash matches its file is a row the scan leaves alone, which is exactly the
 * case an out-of-band edit or a damaged index leaves behind.
 *
 * The clear and the scan are deliberately **not** one transaction. One
 * connection serves every request, so a write transaction held open across the
 * scan would not isolate the rebuild from anybody else — it would pull their
 * writes into it and roll them back with it if the scan threw. The cost is a
 * window, between the clear and the end of the scan, in which the site answers
 * 404 for documents whose files are perfectly fine; the screen says so before
 * the button is pressed.
 *
 * It federates nothing. Every change the scan emits carries `origin: 'scan'`,
 * which delivery, the webmentions and the feed notifier all ignore — the same
 * reason a boot scan is silent.
 */
export async function rebuildContentIndex(
  options: RebuildContentIndexOptions,
): Promise<ContentIndexRebuild> {
  const { store, admin, contentDir, rescan } = options;

  store.clear();

  const federation = rebuildFederationIndexes({ admin, contentDir });
  const comments = rebuildCommentIndexes({ admin, contentDir });
  const scan = await rescan();

  return {
    scan,
    followers: federation.followers,
    activities: federation.activities,
    comments: comments.comments,
  };
}

/** What {@link mountToolsScreen} needs from the admin around it. */
export interface MountToolsOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register Tools > Content index: what the index holds, and the button that
 * reads the files back into it.
 *
 * The rebuild runs inside the POST, as the taxonomy rewrite does, and says
 * what it did on the flash. There is no progress bar and nothing to poll:
 * `node:sqlite` is synchronous, so a rebuild moved off the request would block
 * the same event loop from somewhere nobody can see, and progress would need
 * state the database is not allowed to keep (decision-9). A site whose scan
 * takes long enough for that to matter is one that should be told, which is
 * what the screen does.
 */
export function mountToolsScreen(app: Hono<GeekityEnv>, options: MountToolsOptions): void {
  const { render } = options;

  /**
   * The rebuild in flight, when there is one.
   *
   * A second press while the first is still scanning would clear an index the
   * first one is halfway through filling, and leave two scans racing to write
   * the same rows. One at a time, then, and the second press is told so rather
   * than queued: by the time a queued one ran, the first would have done the
   * very work it was asked for.
   */
  let running: Promise<ContentIndexRebuild> | undefined;

  app.get(TOOLS_PATH, (c) => render(c, ADMIN_TEMPLATES.toolsContentIndex, screen(c)));

  app.post(REBUILD_INDEX_PATH, async (c) => {
    const body = await c.req.parseBody();

    // Offered rather than done, the way a merge is on the taxonomy screens:
    // for as long as the scan runs the site answers 404 for every document,
    // and that is not something to find out about afterwards.
    if (field(body[TOOLS_FIELDS.confirm]) === '') {
      return render(c, ADMIN_TEMPLATES.toolsContentIndex, { ...screen(c), confirm: true });
    }

    if (running !== undefined) {
      flash(
        c,
        'error',
        'A rebuild is already running. Nothing was started; wait for it to finish and look here again.',
      );
      return c.redirect(TOOLS_PATH, 303);
    }

    running = rebuildContentIndex({
      store: c.var.store,
      admin: c.var.admin,
      contentDir: c.var.config.contentDir,
      rescan: c.var.rescan,
    });

    let report: ContentIndexRebuild;
    try {
      report = await running;
    } finally {
      running = undefined;
    }

    flash(c, report.scan.failed > 0 ? 'error' : 'notice', rebuildMessage(report));
    return c.redirect(TOOLS_PATH, 303);
  });

  /** Everything the screen renders. */
  function screen(c: Context<GeekityEnv>): Record<string, unknown> {
    const counts = c.var.store.counts();

    return {
      section: TOOLS_SECTION,
      child: CONTENT_INDEX_CHILD,
      heading: 'Content index',
      rebuildUrl: REBUILD_INDEX_PATH,
      toolsUrl: TOOLS_PATH,
      fields: TOOLS_FIELDS,
      confirm: false,
      // What the index holds right now, which is how somebody who suspects it
      // is wrong finds out that it is: a documents count that does not match
      // the files, or a comment count of nought on a site with comments.
      indexed: {
        documents: counts.total,
        followers: c.var.admin.countFollowers(),
        activities: c.var.admin.countInboxActivities(),
        comments: totalComments(c.var.admin),
      },
      contentDir: c.var.config.contentDir,
    };
  }
}

/** What a finished rebuild says on the flash. */
export function rebuildMessage(report: ContentIndexRebuild): string {
  const { scan } = report;
  const counted =
    `Rebuilt the index from the files. Scanned ${count(scan.scanned, 'file')}: ` +
    `${String(scan.created)} indexed, ${String(scan.removed)} dropped, ` +
    `${String(scan.failed)} failed. Read back ${count(report.followers, 'follower')}, ` +
    `${count(report.activities, 'inbox activity', 'inbox activities')} and ` +
    `${count(report.comments, 'comment')}.`;

  return scan.failed === 0
    ? counted
    : `${counted} A file that will not parse is left out of the index and named in the site's log.`;
}

/** "1 file", "2 files". The plural is the singular plus s unless told. */
function count(howMany: number, singular: string, plural = `${singular}s`): string {
  return `${String(howMany)} ${howMany === 1 ? singular : plural}`;
}

/** How many comments the index holds, whatever a moderator has done with them. */
function totalComments(admin: AdminStore): number {
  const counts = admin.countCommentsByStatus();
  return counts.pending + counts.approved + counts.spam;
}

/** One submitted field as a string. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
