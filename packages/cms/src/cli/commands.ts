import type { CoreCommand, ParsedArgs } from './args.ts';
import { devModeCommand } from './dev-mode.ts';
import { exportCommand } from './export.ts';
import { geminiCommand } from './gemini.ts';
import { importCommand } from './import.ts';
import { initCommand } from './init.ts';
import { maintenanceCommand } from './maintenance.ts';
import { pluginFolderCommand } from './plugin-folder.ts';
import { rebuildCommand } from './rebuild.ts';
import { resendCommand } from './resend.ts';
import { serveCommand } from './serve.ts';
import { settingsCommand } from './settings.ts';
import { stripMetadataCommand } from './strip-metadata.ts';
import { syncCommand } from './sync.ts';
import { userCommand } from './user.ts';

interface CommandEntry {
  synopsis: readonly string[];
  sharedWithPlugins?: true;
  help: readonly (readonly [words: string, summary: readonly string[]])[];
  run(parsed: ParsedArgs): Promise<number>;
}

export const COMMANDS: Readonly<Record<CoreCommand, CommandEntry>> = {
  serve: {
    synopsis: ['[serve] [--config <file>]'],
    help: [['serve', ['Start the CMS (the default when no command is given).']]],
    run: serveCommand,
  },
  init: {
    synopsis: ['init <directory>'],
    help: [['init', ['Create a new site in <directory>.']]],
    run: initCommand,
  },
  sync: {
    synopsis: ['sync [--config <file>]'],
    help: [['sync', ['Rebuild the content index once and exit.']]],
    run: syncCommand,
  },
  rebuild: {
    synopsis: ['rebuild [--config <file>]'],
    help: [
      [
        'rebuild',
        [
          'Delete data/geekity.db and build it again from the files.',
          'Everything in it is derived, so this is always safe with the',
          'site stopped; sessions and delivery outcomes start empty.',
        ],
      ],
    ],
    run: rebuildCommand,
  },
  resend: {
    synopsis: ['resend (--all | <slug>...) [--config <file>]'],
    help: [
      [
        'resend',
        [
          'Send announced posts to every follower and relay again, as',
          'they read now: an Update for a post still published, a',
          'Delete for one withdrawn. --all resends every post the site',
          'has announced; this is how posts federated before a new',
          'federation feature (such as quote posts) pick it up.',
        ],
      ],
    ],
    run: resendCommand,
  },
  maintenance: {
    synopsis: ['maintenance (on [--until <time>] | off | status) [--config <file>]'],
    help: [
      [
        'maintenance',
        [
          'Take the public site down on purpose, or bring it back.',
          'While on, pages, feeds, sitemaps and inbox deliveries answer',
          '503 with Retry-After; the admin, /healthz and signed-in',
          'users are let through. A running site notices within a',
          'second, with no restart.',
        ],
      ],
    ],
    run: maintenanceCommand,
  },
  'dev-mode': {
    synopsis: ['dev-mode (on | off | status) [--config <file>]'],
    help: [
      [
        'dev-mode',
        [
          'Hold everything the site would send to the outside world',
          '(ActivityPub deliveries and relay follows, webmentions,',
          'rssCloud and WebSub pings, IndexNow, email) while it is',
          'built or migrated, and record each one in',
          'data/dev-mode.jsonl. off takes the site live: nothing held',
          'is sent then, and the record says when it went live.',
        ],
      ],
    ],
    run: devModeCommand,
  },
  gemini: {
    synopsis: ['gemini (cert | new-cert) [--config <file>]'],
    help: [
      [
        'gemini cert',
        [
          "Print the Gemini certificate's subject, expiry and SHA-256",
          'fingerprint, and say when it does not name the base URL',
          'host. It makes nothing: the site generates the certificate',
          'when it starts with Gemini on.',
        ],
      ],
      [
        'gemini new-cert',
        [
          'Replace the generated certificate with a new one for the',
          'base URL host. Every Gemini client that visited pinned the',
          'old one and warns about the new one. Restart the site to',
          'serve it.',
        ],
      ],
    ],
    run: geminiCommand,
  },
  settings: {
    synopsis: [
      'settings list [<namespace>] [--config <file>]',
      'settings get <namespace.key> [--config <file>]',
      'settings set <namespace.key> (<value> | --unset) [--config <file>]',
      'settings migrate-plugins [--config <file>]',
    ],
    help: [
      [
        'settings list',
        [
          'Print every runtime setting: its value in effect, where',
          'that value came from (env, config, file or default) and',
          'what it does. A secret prints as (set) or (not set).',
          "Each running plugin's settings follow the core ones, as",
          '@geekity/plugin-llm.default_model.',
        ],
      ],
      ['settings get', ['Print one value in effect, and what overrides it, if', 'anything.']],
      [
        'settings set',
        [
          'Store one value, or remove it with --unset so the default',
          'applies. A setting the environment or the config overrides',
          'is refused. A secret set here is left in the shell history.',
        ],
      ],
      [
        'settings migrate-plugins',
        [
          "Move each plugin's settings out of content/_data/site.json",
          'into data/plugins/<name>/settings.json, keeping enabled',
          'where it is. A server does this when it starts; run it',
          'with the site stopped to do it first. Safe to run twice.',
        ],
      ],
    ],
    run: settingsCommand,
  },
  'strip-metadata': {
    synopsis: ['strip-metadata [--config <file>]'],
    help: [
      [
        'strip-metadata',
        [
          'Remove location and camera metadata (EXIF, XMP, IPTC, a',
          "video's location) from files already in content/uploads.",
          'New uploads are stripped as they arrive; this is for the',
          'ones from before. Safe to run again: a clean file is left',
          'as it is.',
        ],
      ],
    ],
    run: stripMetadataCommand,
  },
  export: {
    synopsis: [
      'export [--out <file>] [--with-credentials] [--without-content] [--list] [--config <file>]',
    ],
    help: [
      [
        'export',
        [
          'Write the site to a .tar.gz: content/ and every file in',
          'data/ the site cannot rebuild, with manifest.json first.',
          'Credentials are left out unless --with-credentials is given.',
          'It only reads, so it runs while the site serves. It prints',
          'the deliveries waiting in the queue, which are never',
          'exported. --list prints what each file in data/ is and',
          'writes nothing.',
        ],
      ],
    ],
    run: exportCommand,
  },
  import: {
    synopsis: ['import <file> [--replace] [--dev-mode] [--new-base-url] [--config <file>]'],
    help: [
      [
        'import',
        [
          'Restore a site from an archive geekity export wrote, with the',
          'site stopped. Every file is checked against the manifest and',
          'unpacked beside content/ and data/ before it replaces them.',
          'Folder plugins are installed from the npm registry at the',
          'versions the archive records, and the database is rebuilt.',
          'It exits 1 when a plugin could not be installed, naming it',
          'and the command to retry.',
        ],
      ],
    ],
    sharedWithPlugins: true,
    run: importCommand,
  },
  user: {
    synopsis: ['user add <username> [--password <pw>] [--email <address>] [--config <file>]'],
    help: [
      [
        'user add',
        ['Create an admin user, so a site can get its first login', 'without the setup screen.'],
      ],
    ],
    run: userCommand,
  },
  plugin: {
    synopsis: [
      'plugin (add <package>[@version] | remove <package>) [--config <file>]',
      'plugin upgrade [<package>...] [--check] [--config <file>]',
    ],
    help: [
      [
        'plugin add',
        [
          "Install a plugin package's bundle from the npm registry",
          '(npm_config_registry, or registry.npmjs.org) into the',
          'plugins folder, GEEKITY_PLUGINS_DIR. It installs only the',
          'package named, and names any plugin it requires that is',
          'missing. Reload on the Plugins screen loads it.',
        ],
      ],
      [
        'plugin remove',
        [
          "Delete a plugin's folder from the plugins folder. Reload on",
          'the Plugins screen unloads it. It refuses a plugin the site',
          'has enabled: disable it first.',
        ],
      ],
      [
        'plugin upgrade',
        [
          'Bring each plugin in the plugins folder, or only the ones',
          'named, up to its newest version that this core and the',
          'other installed plugins can run, installed as plugin add',
          'installs one. Plugins that must move together do. It says,',
          'for each plugin, what it upgraded, or why it held a newer',
          'version back. --check reports and installs nothing.',
        ],
      ],
    ],
    run: pluginFolderCommand,
  },
};
