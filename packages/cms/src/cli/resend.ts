import { loadResolvedConfig } from '../config-loader.ts';
import type { ParsedArgs } from './args.ts';
import { runJobHere } from './run-job.ts';

/**
 * `geekity resend`: send announced posts to their followers again, as they now
 * read.
 *
 * Mastodon keeps the copy of a post it first fetched, so a property added
 * later — the quote policy (TASK-125) is the one that made this a command —
 * reaches a post already out only through an `Update`. This is the resend
 * button on the federation screen, for every post at once, and it runs the
 * same resend job (TASK-393). Delivery runs with no queue, so each activity
 * has been posted before the process exits.
 */
export async function resendCommand({ args, configPath, flags }: ParsedArgs): Promise<number> {
  const all = flags['all'] === true;
  if (all === args.length > 0) {
    throw new Error(
      'geekity resend needs either --all or the slugs of the posts to resend, and not both.',
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
    { slugs: all ? 'all' : args, webmentions: false },
    'resend',
    (cms) => cms.sync(),
  );
  if (report === undefined) return 1;

  let failed = 0;
  for (const post of report.posts) {
    const activity = post.resent ? post.activity : null;
    if (activity === null) {
      process.stderr.write(`${post.slug}: nothing to resend, no announced post has that slug.\n`);
      failed += 1;
    } else if (activity.heldByDevMode) {
      process.stdout.write(
        `${post.slug}: ${activity.activityType} held by dev mode, nothing sent\n`,
      );
    } else {
      process.stdout.write(
        `${post.slug}: ${activity.activityType} to ${String(activity.reached)} of ` +
          `${String(activity.inboxes)} inboxes\n`,
      );
    }
  }
  return failed === 0 ? 0 : 1;
}
