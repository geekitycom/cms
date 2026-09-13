import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The Email settings page: how the site sends mail, and where a message
 * written to it goes. The credential itself is `mail.test.ts`.
 */

const box = sandbox();
after(() => box.cleanup());

describe('the contact address', () => {
  it('is a field of the form and is written to the file (TASK-56)', async () => {
    const contentDir = await box.dir('geekity-settings-contact-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.match(
      await (await agent.get('/admin/settings/email')).text(),
      /name="contact_email"/,
      'the Email page offers it',
    );

    const saved = await saveSettings(agent, 'email', { contact_email: 'hello@example.org' });
    assert.equal(saved.status, 303);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['contactEmail'], 'hello@example.org');
    assert.equal(readSiteSettings(contentDir).contactEmail, 'hello@example.org');
  });

  it('refuses something that is not an address, and writes nothing (TASK-56)', async () => {
    const contentDir = await box.dir('geekity-settings-contact-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const refused = await saveSettings(agent, 'email', {
      title: 'Kept',
      contact_email: 'not-an-address',
    });

    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /A contact address is an email address/);
    assert.equal(readSiteSettings(contentDir).title, 'Geekity', 'nothing at all was written');
  });
});
