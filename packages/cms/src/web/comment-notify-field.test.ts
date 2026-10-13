import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { settingsOver } from '../__testing__/settings.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { writeSiteJson } from '../site/site-json.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';

describe('the "email me about replies" box on a public post', () => {
  it('is drawn once the mail credential is saved, with no restart', async () => {
    const contentDir = await box.dir('geekity-notify-field-content-');
    const dataDir = await box.dir('geekity-notify-field-data-');
    await writeSiteJson({
      contentDir,
      settings: { ...DEFAULT_SITE_SETTINGS, base_url: BASE_URL, mail_provider: 'brevo' },
    });
    const file = path.join(contentDir, 'posts', 'hello.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      ['---', 'title: Hello', "date: '2026-09-02T09:00:00Z'", '---', '', 'Words.', ''].join('\n'),
    );
    const cms = await box.open({
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      now: () => new Date('2026-09-05T12:00:00Z'),
    });

    const before = await (await cms.app.request(POST)).text();
    assert.match(before, /<form[^>]*comment/, 'the post takes comments');
    assert.doesNotMatch(before, /id="comment-notify"/);

    await settingsOver({ contentDir, dataDir }).set(
      'mail',
      new Map([['brevo_api_key', 'xkeysib-secret']]),
      'admin',
    );

    const afterSaving = await (await cms.app.request(POST)).text();
    assert.match(afterSaving, /id="comment-notify"/);
  });
});
