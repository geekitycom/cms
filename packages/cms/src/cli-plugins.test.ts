import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, runCli, temporaryDir } from './__testing__/cli.ts';

/**
 * Commands a plugin adds to the command line (decision-33, TASK-282). They
 * run whenever the plugin is installed, enabled or not, because a migration
 * command runs before the plugin it prepares for is turned on.
 */

after(cleanupTemporaryDirs);

/** A site whose config installs one plugin with one command. */
async function siteWithPlugin(): Promise<string> {
  const directory = await temporaryDir('geekity-cli-plugins-');
  await fs.writeFile(
    path.join(directory, 'geekity.config.mjs'),
    `export default {
  plugins: [
    {
      name: '@acme/plugin-echo',
      version: '1.0.0',
      label: 'Echo',
      description: 'Echoes.',
      hostApi: 2,
      register(host) {
        host.command({
          words: ['echo', 'loud'],
          usage: '<text> [--times <n>] [--shout]',
          summary: 'Say the text back, as many times as asked.',
          options: [
            { name: 'times', value: '<n>', description: 'How many times to say it.' },
            { name: 'shout', description: 'Say it in capitals.' },
          ],
          run({ args, options, site, write }) {
            if (args[0] === 'fail') throw new Error('Echo was asked to fail.');
            const text = options.shout === true ? args.join(' ').toUpperCase() : args.join(' ');
            const times = Number(options.times ?? '1');
            for (let i = 0; i < times; i += 1) write(text + '\\n');
            write('users: ' + String(site.users().length) + '\\n');
            return 0;
          },
        });
      },
    },
  ],
};
`,
  );
  return directory;
}

describe('a plugin command', () => {
  it('is listed by geekity --help with its usage, summary and options', async () => {
    const directory = await siteWithPlugin();

    const run = await runCli(['--help'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /geekity echo loud <text> \[--times <n>\] \[--shout\]/);
    assert.match(run.stdout, /Say the text back, as many times as asked\./);
    assert.match(run.stdout, /@acme\/plugin-echo/);
    assert.match(run.stdout, /--times <n>\s+How many times to say it\./);
  });

  it('runs with its arguments and options, enabled or not', async () => {
    const directory = await siteWithPlugin();

    const run = await runCli(
      ['echo', 'loud', 'hello', 'there', '--times', '2', '--shout'],
      directory,
    );

    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout, 'HELLO THERE\nHELLO THERE\nusers: 0\n');
  });

  it('runs after the comment ids are keys, as a boot leaves them', async () => {
    const directory = await siteWithPlugin();
    const file = path.join(directory, 'content', '_data', 'comments', 'hello.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const old = 'https://blog.example/?p=1#comment-2';
    await fs.writeFile(
      file,
      `${JSON.stringify({
        post: '/2026/09/hello/',
        comments: [
          {
            id: old,
            source: 'comment',
            kind: 'reply',
            status: 'approved',
            author: { name: 'Ada', url: null, avatar: null },
            content: { markdown: 'Hi.', html: '<p>Hi.</p>\\n' },
            submitted: '2026-09-01T10:00:00.000Z',
            addressHash: null,
            inReplyTo: null,
            url: null,
          },
        ],
      })}\n`,
    );

    const run = await runCli(['echo', 'loud', 'hi'], directory);

    assert.equal(run.code, 0, run.stderr);
    const held = JSON.parse(await fs.readFile(file, 'utf8')) as { comments: { id: string }[] };
    assert.deepEqual(
      held.comments.map((comment) => comment.id),
      [createHash('sha256').update(old).digest('hex').slice(0, 16)],
    );
  });

  it('reads the settings a boot would move out of site.json', async () => {
    const directory = await temporaryDir('geekity-cli-plugin-settings-');
    await fs.writeFile(
      path.join(directory, 'geekity.config.mjs'),
      `export default {
  plugins: [
    {
      name: '@acme/plugin-greet',
      version: '1.0.0',
      label: 'Greet',
      description: 'Greets.',
      hostApi: 2,
      register(host) {
        const settings = host.settings([
          { key: 'greeting', type: 'text', label: 'Greeting', default: 'Hello' },
        ]);
        host.command({
          words: ['greet'],
          usage: '',
          summary: 'Say the greeting.',
          async run({ write }) {
            write('greeting: ' + (await settings.current()).greeting + '\\n');
            return 0;
          },
        });
      },
    },
  ],
};
`,
    );
    const siteJson = path.join(directory, 'content', '_data', 'site.json');
    await fs.mkdir(path.dirname(siteJson), { recursive: true });
    await fs.writeFile(
      siteJson,
      `${JSON.stringify({ plugins: { '@acme/plugin-greet': { enabled: true, greeting: 'Ahoy' } } })}\n`,
    );

    const run = await runCli(['greet'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /^greeting: Ahoy$/m);
    assert.deepEqual(JSON.parse(await fs.readFile(siteJson, 'utf8')), {
      plugins: { '@acme/plugin-greet': { enabled: true } },
    });
  });

  it('refuses an option the command does not take', async () => {
    const directory = await siteWithPlugin();

    const run = await runCli(['echo', 'loud', 'hi', '--loudly'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /Unknown option "--loudly"/);
  });

  it('exits 1 with the message when it throws', async () => {
    const directory = await siteWithPlugin();

    const run = await runCli(['echo', 'loud', 'fail'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /Echo was asked to fail\./);
  });

  it('is an unknown command on a site without the plugin', async () => {
    const directory = await temporaryDir('geekity-cli-no-plugins-');

    const run = await runCli(['echo', 'loud', 'hi'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /Unknown command "echo"/);
  });

  it('runs from the plugins folder, where a Docker site installs it', async () => {
    const directory = await temporaryDir('geekity-cli-folder-plugins-');
    const folder = path.join(directory, 'plugins', '@acme', 'plugin-hello');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'index.js'),
      `export default {
  name: '@acme/plugin-hello',
  version: '1.0.0',
  label: 'Hello',
  description: 'Greets.',
  hostApi: 2,
  register(host) {
    host.command({
      words: ['hello'],
      usage: '',
      summary: 'Say hello.',
      run({ write }) {
        write('hello from the folder\\n');
        return 0;
      },
    });
  },
};
`,
    );
    const env = { GEEKITY_PLUGINS_DIR: path.join(directory, 'plugins') };

    const run = await runCli(['hello'], directory, undefined, env);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout, 'hello from the folder\n');
    assert.match((await runCli(['--help'], directory, undefined, env)).stdout, /geekity hello/);
  });
});
