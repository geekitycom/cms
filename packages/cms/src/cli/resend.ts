import { loadResolvedConfig } from '../config-loader.ts';
import type { CatalogReader, DocumentLookup } from '../content/store.ts';
import type { ParsedArgs } from './args.ts';
import { runJobHere } from './run-job.ts';

// Mastodon keeps the copy of a post it first fetched, so a property added
// later reaches a post already out only through an `Update`.
export async function resendCommand({ args, configPath, flags }: ParsedArgs): Promise<number> {
  const all = flags['all'] === true;
  if (all === args.length > 0) {
    throw new Error(
      'geekity resend needs either --all or the slugs or paths of the posts to resend, and not both.',
    );
  }

  const config = await loadResolvedConfig(configPath, (loaded) => ({
    ...loaded,
    watch: false,
    federation: { ...loaded.federation, queue: null },
  }));
  const { RESEND_JOB } = await import('../federation/resend-job.ts');
  const report = await runJobHere(
    config,
    RESEND_JOB,
    (cms) => ({ paths: all ? ('all' as const) : postPaths(cms.store, args), webmentions: false }),
    'resend',
    (cms) => cms.sync(),
  );
  if (report === undefined) return 1;

  let failed = 0;
  for (const post of report.posts) {
    const activity = post.resent ? post.activity : null;
    if (activity === null) {
      process.stderr.write(`${post.path}: nothing to resend, no announced post is there.\n`);
      failed += 1;
    } else if (activity.heldByDevMode) {
      process.stdout.write(
        `${post.path}: ${activity.activityType} held by dev mode, nothing sent\n`,
      );
    } else {
      process.stdout.write(
        `${post.path}: ${activity.activityType} to ${String(activity.reached)} of ` +
          `${String(activity.inboxes)} inboxes\n`,
      );
    }
  }
  return failed === 0 ? 0 : 1;
}

/**
 * Each name as the content path of the post it means. A slug is a shorthand
 * that only works while one post holds it: the default permalinks repeat a
 * slug across months, and guessing would resend the wrong post.
 */
function postPaths(store: DocumentLookup & CatalogReader, names: readonly string[]): string[] {
  const posts = [
    ...store.listAll({ type: 'post' }),
    ...store.listAll({ type: 'post', trashed: true }),
  ];
  return names.map((name) => {
    if (store.getByPath(name) !== undefined) return name;
    const named = posts.filter((post) => post.slug === name);
    if (named.length > 1) {
      throw new Error(
        `The slug ${name} names ${String(named.length)} posts: ` +
          `${named.map((post) => post.path).join(', ')}. Name the one to resend by its path.`,
      );
    }
    return named[0]?.path ?? name;
  });
}
