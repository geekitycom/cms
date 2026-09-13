import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The Discussion settings page: comments, webmentions, and the closing window.
 * The Akismet key beside them is `akismet.test.ts`.
 *
 * Every field here but one is a checkbox, and a clear checkbox submits nothing
 * at all — which is why these are worth a test of their own. A page reads its
 * own fields off the body and every other field off the file, so "nothing
 * submitted" means "turned off" for the page's own boxes and nothing whatever
 * for anybody else's.
 */

const box = sandbox();
after(() => box.cleanup());

describe('the Discussion settings page', () => {
  it('turns comments off across the site, and on again', async () => {
    const contentDir = await box.dir('geekity-settings-discussion-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    assert.equal(readSiteSettings(contentDir).comments, true, 'a new site takes comments');

    // The box cleared: a browser sends the field not at all.
    const off = await saveSettings(agent, 'discussion', { comments: '' });
    assert.equal(off.status, 303);
    assert.equal(readSiteSettings(contentDir).comments, false);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['comments'], false, 'and site.json says so');

    await saveSettings(agent, 'discussion', { comments: '1' });
    assert.equal(readSiteSettings(contentDir).comments, true);
  });

  it('keeps the closing window and both webmention switches', async () => {
    const contentDir = await box.dir('geekity-settings-webmentions-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const saved = await saveSettings(agent, 'discussion', {
      comments_close_after_days: '30',
      webmentions_send: '1',
      webmentions_receive: '',
    });
    assert.equal(saved.status, 303);

    const settings = readSiteSettings(contentDir);
    assert.equal(settings.commentsCloseAfterDays, 30);
    assert.equal(settings.webmentionsSend, true);
    assert.equal(settings.webmentionsReceive, false);
  });

  it('refuses a closing window that is not a whole number of days, and writes nothing', async () => {
    const contentDir = await box.dir('geekity-settings-close-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, 'discussion', { comments_close_after_days: '21' });

    for (const bad of ['', '-1', '2.5', 'soon']) {
      const response = await saveSettings(agent, 'discussion', {
        comments_close_after_days: bad,
        comments: '',
      });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /whole number of days/, JSON.stringify(bad));
    }

    const settings = readSiteSettings(contentDir);
    assert.equal(settings.commentsCloseAfterDays, 21, 'nothing was written');
    assert.equal(settings.comments, true, 'not even the field that was valid');
  });
});
