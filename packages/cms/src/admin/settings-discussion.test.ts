import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings, settingsPageUrl } from './__testing__/settings.ts';
import { siteSettingsIn } from '../__testing__/site-settings.ts';

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

    assert.equal((await siteSettingsIn(contentDir)).comments, true, 'a new site takes comments');

    // The box cleared: a browser sends the field not at all.
    const off = await saveSettings(agent, 'discussion', { comments: '' });
    assert.equal(off.status, 303);
    assert.equal((await siteSettingsIn(contentDir)).comments, false);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['comments'], false, 'and site.json says so');

    await saveSettings(agent, 'discussion', { comments: '1' });
    assert.equal((await siteSettingsIn(contentDir)).comments, true);
  });

  it('saves which types take comments by default, both into site.json', async () => {
    const contentDir = await box.dir('geekity-settings-comment-types-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const before = await siteSettingsIn(contentDir);
    assert.equal(before.comments_on_posts, true, 'a new site opens posts');
    assert.equal(before.comments_on_pages, false, 'and closes pages');

    const form = await (await agent.get(settingsPageUrl('discussion'))).text();
    assert.match(form, /<input[^>]*name="comments_on_posts"[^>]*checked/);
    assert.doesNotMatch(form, /<input[^>]*name="comments_on_pages"[^>]*checked/);

    const saved = await saveSettings(agent, 'discussion', {
      comments_on_posts: '',
      comments_on_pages: '1',
    });
    assert.equal(saved.status, 303);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['commentsOnPosts'], false);
    assert.equal(written['commentsOnPages'], true);

    const after = await (await agent.get(settingsPageUrl('discussion'))).text();
    assert.doesNotMatch(after, /<input[^>]*name="comments_on_posts"[^>]*checked/);
    assert.match(after, /<input[^>]*name="comments_on_pages"[^>]*checked/);
  });

  it('shows a site.json from before the type settings as it was: off, posts, no pages', async () => {
    const contentDir = await box.dir('geekity-settings-comment-types-legacy-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'Old', comments: false }),
    );
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const form = await (await agent.get(settingsPageUrl('discussion'))).text();
    assert.doesNotMatch(form, /<input[^>]*name="comments"[^>]*checked/);
    assert.match(form, /<input[^>]*name="comments_on_posts"[^>]*checked/);
    assert.doesNotMatch(form, /<input[^>]*name="comments_on_pages"[^>]*checked/);
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

    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.comments_close_after_days, 30);
    assert.equal(settings.webmentions_send, true);
    assert.equal(settings.webmentions_receive, false);
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

    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.comments_close_after_days, 21, 'nothing was written');
    assert.equal(settings.comments, true, 'not even the field that was valid');
  });

  it('keeps personal data forever on a site that never chose a period', async () => {
    const contentDir = await box.dir('geekity-settings-retention-default-');
    const cms = await box.site({ contentDir });

    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.comment_email_retention_days, 0);
    assert.equal(settings.address_hash_retention_days, 0);
    assert.equal(settings.contact_message_retention_days, 0);

    const agent = await signedIn(cms);
    const page = await (await agent.get(settingsPageUrl('discussion'))).text();
    assert.equal(page.match(/Kept forever/g)?.length, 3, 'each of the three says so');
    assert.match(page, /180/, 'and the recommended periods are offered');
    assert.match(page, /\b30\b/);
    assert.match(page, /365/);
  });

  it('says how long each period is once one is chosen', async () => {
    const contentDir = await box.dir('geekity-settings-retention-chosen-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await saveSettings(agent, 'discussion', {
      comment_email_retention_days: '180',
      address_hash_retention_days: '0',
      contact_message_retention_days: '365',
    });
    const page = await (await agent.get(settingsPageUrl('discussion'))).text();
    assert.equal(page.match(/Kept forever/g)?.length, 1, 'only the address hashes');
    assert.match(page, /Removed after 180 days/);
    assert.match(page, /Removed after 365 days/);
  });

  it('saves how long personal data is kept, with 0 for forever', async () => {
    const contentDir = await box.dir('geekity-settings-retention-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const saved = await saveSettings(agent, 'discussion', {
      comment_email_retention_days: '90',
      address_hash_retention_days: '0',
      contact_message_retention_days: '730',
    });
    assert.equal(saved.status, 303);

    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.comment_email_retention_days, 90);
    assert.equal(settings.address_hash_retention_days, 0);
    assert.equal(settings.contact_message_retention_days, 730);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['commentEmailRetentionDays'], 90);
    assert.equal(written['addressHashRetentionDays'], 0);
    assert.equal(written['contactMessageRetentionDays'], 730);
  });

  it('refuses a retention period that is not a whole number of days', async () => {
    const contentDir = await box.dir('geekity-settings-retention-bad-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    for (const field of [
      'comment_email_retention_days',
      'address_hash_retention_days',
      'contact_message_retention_days',
    ]) {
      const response = await saveSettings(agent, 'discussion', { [field]: '-3' });
      assert.equal(response.status, 400, field);
      assert.match(await response.text(), /whole number of days, or 0 to keep/, field);
    }
    assert.equal(
      (await siteSettingsIn(contentDir)).comment_email_retention_days,
      0,
      'nothing written',
    );
  });
});
