import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, runCli, temporaryDir } from './__testing__/cli.ts';

/**
 * What the bin says about itself: the help, word for word, and what a
 * command that is used wrongly answers. The help is generated from the
 * command table, so these pin the text the table has to produce.
 */

after(cleanupTemporaryDirs);

const HELP = `geekity — the Geekity CMS command line

Usage:
  geekity [serve] [--config <file>]
  geekity init <directory>
  geekity sync [--config <file>]
  geekity rebuild [--config <file>]
  geekity resend (--all | <slug>...) [--config <file>]
  geekity maintenance (on [--until <time>] | off | status) [--config <file>]
  geekity dev-mode (on | off | status) [--config <file>]
  geekity strip-metadata [--config <file>]
  geekity user add <username> [--password <pw>] [--email <address>] [--config <file>]
  geekity plugin (add <package>[@version] | remove <package>) [--config <file>]
  geekity plugin upgrade [<package>...] [--check] [--config <file>]

Commands:
  serve            Start the CMS (the default when no command is given).
  init             Create a new site in <directory>.
  sync             Rebuild the content index once and exit.
  rebuild          Delete data/geekity.db and build it again from the files.
                   Everything in it is derived, so this is always safe with the
                   site stopped; sessions and delivery outcomes start empty.
  resend           Send announced posts to every follower and relay again, as
                   they read now: an Update for a post still published, a
                   Delete for one withdrawn. --all resends every post the site
                   has announced; this is how posts federated before a new
                   federation feature (such as quote posts) pick it up.
  maintenance      Take the public site down on purpose, or bring it back.
                   While on, pages, feeds, sitemaps and inbox deliveries answer
                   503 with Retry-After; the admin, /healthz and signed-in
                   users are let through. A running site notices within a
                   second, with no restart.
  dev-mode         Hold everything the site would send to the outside world
                   (ActivityPub deliveries and relay follows, webmentions,
                   rssCloud and WebSub pings, IndexNow, email) while it is
                   built or migrated, and record each one in
                   data/dev-mode.jsonl. off takes the site live: nothing held
                   is sent then, and the record says when it went live.
  strip-metadata   Remove location and camera metadata (EXIF, XMP, IPTC, a
                   video's location) from files already in content/uploads.
                   New uploads are stripped as they arrive; this is for the
                   ones from before. Safe to run again: a clean file is left
                   as it is.
  user add         Create an admin user, so a site can get its first login
                   without the setup screen.
  plugin add       Install a plugin package's bundle from the npm registry
                   (npm_config_registry, or registry.npmjs.org) into the
                   plugins folder, GEEKITY_PLUGINS_DIR. It installs only the
                   package named, and names any plugin it requires that is
                   missing. Reload on the Plugins screen loads it.
  plugin remove    Delete a plugin's folder from the plugins folder. Reload on
                   the Plugins screen unloads it. It refuses a plugin the site
                   has enabled: disable it first.
  plugin upgrade   Bring each plugin in the plugins folder, or only the ones
                   named, up to its newest version that this core and the
                   other installed plugins can run, installed as plugin add
                   installs one. Plugins that must move together do. It says,
                   for each plugin, what it upgraded, or why it held a newer
                   version back. --check reports and installs nothing.

Options:
  --config <file>  Config file to load. Defaults to the first of
                   geekity.config.ts, geekity.config.js, geekity.config.mjs found in the working directory.
  --password <pw>  The new user's password. Left off, it is asked for without
                   echo, or read as one line when standard input is a pipe.
                   A password on the command line is visible in the process
                   list and in shell history, so prefer being asked.
  --email <addr>   The new user's email address. Optional; it is what a
                   forgotten password is recovered through.
  --until <time>   With maintenance on: when the site should be back, as an
                   ISO 8601 time such as 2026-09-28T14:00:00Z. It is the
                   Retry-After a client is sent, and the maintenance page
                   says it.
  --all            With resend: every announced post rather than named ones.
  --check          With plugin upgrade: say what would change, install nothing.
  -h, --help       Show this help.
  -v, --version    Show the installed version.

Environment overrides:
  GEEKITY_PORT (or PORT), GEEKITY_CONTENT_DIR, GEEKITY_DATA_DIR,
  GEEKITY_THEMES_DIR, GEEKITY_PLUGINS_DIR, GEEKITY_BASE_URL, GEEKITY_WATCH,
  GEEKITY_MAINTENANCE (on keeps the site in maintenance until a restart),
  GEEKITY_DEV_MODE (on starts the site in dev mode; only dev-mode off ends it)
`;

const PLUGIN_HELP = `
Plugin commands:
  geekity echo loud <text> [--times <n>] [--shout]
          [--a-very-long-option-name <value>] [--another-long-one] [--config
          <file>]
                   Say the text back, as many times as asked, and keep saying
                   it until the line is long enough to wrap.
                   From @acme/plugin-echo.
    --times <n>    How many times to say it.
    --shout        Say it in capitals.
    --a-very-long-option-name <value>
                   An option whose name is too long to sit beside its
                   description, so it goes on a line of its own.
`;

const PLUGIN_CONFIG = `export default {
  plugins: [
    {
      name: '@acme/plugin-echo',
      version: '1.0.0',
      label: 'Echo',
      description: 'Echoes.',
      hostApi: 1,
      register(host) {
        host.command({
          words: ['echo', 'loud'],
          usage: '<text> [--times <n>] [--shout] [--a-very-long-option-name <value>] [--another-long-one]',
          summary: 'Say the text back, as many times as asked, and keep saying it until the line is long enough to wrap.',
          options: [
            { name: 'times', value: '<n>', description: 'How many times to say it.' },
            { name: 'shout', description: 'Say it in capitals.' },
            { name: 'a-very-long-option-name', value: '<value>', description: 'An option whose name is too long to sit beside its description, so it goes on a line of its own.' },
          ],
          run() { return 0; },
        });
      },
    },
  ],
};
`;

describe('geekity --help', () => {
  it('prints the help, and nothing on stderr, in a site with no config', async () => {
    const directory = await temporaryDir('geekity-cli-help-');

    for (const flag of ['--help', '-h']) {
      const run = await runCli([flag], directory);
      assert.deepEqual(run, { code: 0, stdout: HELP, stderr: '' });
    }
  });

  it('wins over a command named before it', async () => {
    const directory = await temporaryDir('geekity-cli-help-');

    const run = await runCli(['maintenance', '--help'], directory);

    assert.deepEqual(run, { code: 0, stdout: HELP, stderr: '' });
  });

  it('lists plugin commands after the core help, wrapped as the core help is', async () => {
    const directory = await temporaryDir('geekity-cli-help-');
    await fs.writeFile(path.join(directory, 'geekity.config.mjs'), PLUGIN_CONFIG);

    const run = await runCli(['--help'], directory);

    assert.deepEqual(run, { code: 0, stdout: HELP + PLUGIN_HELP, stderr: '' });
  });
});

describe('a command used wrongly', () => {
  const cases: [string[], string][] = [
    [['deploy'], 'Unknown command "deploy". Run geekity --help to see what is available.'],
    [
      ['deploy', '--help'],
      'Unknown command "deploy". Run geekity --help to see what is available.',
    ],
    [['--bogus'], 'Unknown option "--bogus". Run geekity --help to see what is available.'],
    [['init'], 'geekity init <directory> needs the directory to create.'],
    [['user'], 'geekity user add <username> needs a subcommand. The only one is: add.'],
    [['user', 'remove'], 'Unknown user subcommand "remove". The only one is: add.'],
    [['user', 'add'], 'geekity user add <username> needs the name of the user to create.'],
    [['maintenance'], 'geekity maintenance needs on, off or status.'],
    [['dev-mode'], 'geekity dev-mode needs on, off or status.'],
    [
      ['resend'],
      'geekity resend needs either --all or the slugs of the posts to resend, and not both.',
    ],
    [
      ['plugin'],
      'geekity plugin needs add <package>[@version], remove <package> or upgrade [<package>...].',
    ],
    [
      ['plugin', 'add'],
      'geekity plugin needs a plugins folder: set GEEKITY_PLUGINS_DIR, or pluginsDir in the config.',
    ],
  ];

  for (const [args, message] of cases) {
    it(`geekity ${args.join(' ')} exits 1 and says why`, async () => {
      const directory = await temporaryDir('geekity-cli-help-');

      const run = await runCli(args, directory);

      assert.deepEqual(run, { code: 1, stdout: '', stderr: `${message}\n` });
    });
  }
});
