import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { PluginCommand, PluginCommandContext } from '@geekity/cms/plugin';

import { importWordPressActor } from './import.ts';
import type { ImportWordPressActorReport } from './import.ts';
import { WORDPRESS_ACTIVITYPUB_BASE } from './records.ts';
import type { WordPressRecords } from './records.ts';

/**
 * `geekity import wordpress-actor <username>`: the cutover, for one person.
 *
 * Everything the WordPress ActivityPub plugin holds that the site cannot mint
 * for itself arrives here (decision-14): the RSA pair its followers have
 * cached, the actor id they key the account by, the number its paths are
 * built from, and the followers themselves. It is a command rather than a
 * screen because a stored actor id is identity for the life of the account,
 * and it is idempotent because the cutover is a thing an owner runs twice:
 * once before the DNS moves and once after an instance that was down comes
 * back. It runs whether or not the plugin is enabled, because the import
 * comes first.
 */
export function importCommand(records: WordPressRecords): PluginCommand {
  return {
    words: ['import', 'wordpress-actor'],
    usage:
      '<username> --actor-id <url> --wordpress-id <n> (--keypair <file> | --private-key <file> [--public-key <file>]) [--followers <url|file|none>] [--force]',
    summary:
      "Bring one person across from the WordPress ActivityPub plugin: their key pair, the actor id their followers hold, the plugin's numeric actor id, and their followers.",
    options: [
      {
        name: 'actor-id',
        value: '<url>',
        description:
          'The actor id WordPress published, query string and all, for example https://example.com/?author=2',
      },
      {
        name: 'wordpress-id',
        value: '<n>',
        description: `The WordPress user id, which is the number in the plugin's paths (${WORDPRESS_ACTIVITYPUB_BASE}/actors/<n>/inbox).`,
      },
      {
        name: 'keypair',
        value: '<file>',
        description:
          'The JSON `wp option get activitypub_keypair_for_<login> --format=json` prints: {"private_key": …, "public_key": …}.',
      },
      {
        name: 'private-key',
        value: '<file>',
        description: 'The private key as PEM, instead of --keypair.',
      },
      {
        name: 'public-key',
        value: '<file>',
        description:
          'The public key as PEM. Optional, and only checked against the private half; it is derived, never stored.',
      },
      {
        name: 'followers',
        value: '<url|file|none>',
        description:
          "Where the followers come from. Left off, the plugin's own public followers collection on the actor id's origin.",
      },
      {
        name: 'force',
        description:
          'Import over a key pair the user already has. Do this only when you are certain the pair being imported is the one the followers hold: a new key means none of them can verify this person again.',
      },
    ],
    run: (context) => run(context, records),
  };
}

async function run(context: PluginCommandContext, records: WordPressRecords): Promise<number> {
  const { args, options } = context;

  const username = args[0];
  if (username === undefined) {
    throw new Error(
      'geekity import wordpress-actor <username> needs the account on this site the ' +
        "plugin's actor becomes.",
    );
  }

  const actorId = text(options, 'actor-id');
  if (actorId === undefined) {
    throw new Error(
      '--actor-id is the id WordPress published this person under, query string and all, ' +
        'for example --actor-id "https://example.com/?author=2". Its followers key the ' +
        'account by it, so it is the one thing the import cannot work out for itself.',
    );
  }
  if (!isAbsoluteHttpUrl(actorId)) {
    throw new Error(`--actor-id must be an http or https URL; "${actorId}" is not one.`);
  }

  const number = text(options, 'wordpress-id');
  if (number === undefined || !/^[1-9][0-9]*$/.test(number)) {
    throw new Error(
      '--wordpress-id is the WordPress user id, a whole positive number: it is what the ' +
        `plugin's paths are built from, as in ${WORDPRESS_ACTIVITYPUB_BASE}/actors/2/inbox.`,
    );
  }

  const { privateKeyPem, publicKeyPem } = await readKeyPair(context);

  const report = await importWordPressActor({
    site: context.site,
    records,
    username,
    actorId,
    wordpressActorId: Number(number),
    privateKeyPem,
    publicKeyPem,
    followers: followersSource(context),
    force: options['force'] === true,
  });

  context.write(importSummary(report));
  return 0;
}

/**
 * The key pair, from whichever of the two exports the owner had to hand.
 *
 * `--keypair` is the option the current plugin stores, one option holding
 * both halves, and the two PEM files are what `wp user meta get` prints for a
 * site old enough to still be on the legacy meta keys. The README says which
 * command produces which.
 */
async function readKeyPair(
  context: PluginCommandContext,
): Promise<{ privateKeyPem: string; publicKeyPem: string | undefined }> {
  const { options, cwd } = context;
  const keypair = text(options, 'keypair');
  const privateKey = text(options, 'private-key');
  const publicKey = text(options, 'public-key');

  if (keypair !== undefined) {
    if (privateKey !== undefined) {
      throw new Error('Pass either --keypair or --private-key, not both.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.resolve(cwd, keypair), 'utf8'));
    } catch (error) {
      throw new Error(
        `${keypair} could not be read as the JSON "wp option get … --format=json" prints: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const held = parsed as { private_key?: unknown; public_key?: unknown } | null;
    if (typeof held?.private_key !== 'string') {
      throw new Error(`${keypair} has no "private_key". Check what the export wrote.`);
    }
    return {
      privateKeyPem: held.private_key,
      publicKeyPem: typeof held.public_key === 'string' ? held.public_key : undefined,
    };
  }

  if (privateKey === undefined) {
    throw new Error(
      'The key pair is missing: pass --keypair with the JSON WordPress stores, or ' +
        '--private-key with the PEM. Without it this person could not sign anything, and ' +
        'every follower holds the public half of the key that signs it.',
    );
  }

  return {
    privateKeyPem: await readFile(path.resolve(cwd, privateKey), 'utf8'),
    publicKeyPem:
      publicKey === undefined ? undefined : await readFile(path.resolve(cwd, publicKey), 'utf8'),
  };
}

/**
 * What `--followers` means: a URL, a file resolved against the working
 * directory, `none`, or the plugin's own collection when it was left off.
 */
function followersSource(context: PluginCommandContext): string | false | undefined {
  const given = text(context.options, 'followers');
  if (given === undefined) return undefined;
  if (given === 'none') return false;
  return isAbsoluteHttpUrl(given) ? given : path.resolve(context.cwd, given);
}

/** What the run did, as the operator reads it. */
function importSummary(report: ImportWordPressActorReport): string {
  const lines: string[] = [];
  const { followers } = report;

  lines.push(
    report.changed
      ? `Imported ${report.username} from ${report.actorId}`
      : `Nothing to change: ${report.username} is already ${report.actorId}`,
  );
  lines.push(
    `  ids         ${report.identity === 'set' ? 'written to' : 'already in'} ` +
      `data/users.json and the plugin's actors.json (WordPress actor ${String(report.wordpressActorId)})`,
  );
  for (const key of report.keys) lines.push(`  key         ${key.state} ${key.file}`);

  if (followers.source === undefined) {
    lines.push('  followers   skipped');
  } else {
    lines.push(
      `  followers   ${String(followers.added.length)} added, ` +
        `${String(followers.refreshed.length)} refreshed, ` +
        `${String(followers.unchanged.length)} unchanged, ` +
        `${String(followers.failed.length)} could not be fetched ` +
        `(${followers.source})`,
    );
    for (const failure of followers.failed) {
      lines.push(`    skipped   ${failure.actor}: ${failure.reason}`);
    }
    if (followers.failed.length > 0) {
      lines.push(
        '  Those followers were left out. Run this again once their servers answer; ' +
          'nothing already imported is touched twice.',
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/** One option as the text it carries, or `undefined` when it was not given. */
function text(options: Readonly<Record<string, string | true>>, name: string): string | undefined {
  const value = options[name];
  return typeof value === 'string' ? value : undefined;
}

/** Whether a value is a URL a peer could fetch. */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
