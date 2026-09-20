import assert from 'node:assert/strict';

import { csrfField } from './harness.ts';
import type { Browser } from './harness.ts';
import { SETTINGS_PAGES } from '../settings-pages.ts';

/**
 * Saving one settings page the way a browser would.
 *
 * The settings are six pages now, each posting its own fields to its own URL,
 * so a test says which page it is saving and names only what it cares about.
 * Everything else on that page comes from the defaults below — which is what a
 * browser would send, having rendered the form and had nothing touched.
 *
 * A checkbox is the one thing to watch: a clear one submits nothing at all, so
 * a default here that is missing is a setting turned off.
 */
export const SETTINGS_PAGE_FORMS: Record<string, Record<string, string>> = {
  general: {
    title: 'A Site',
    tagline: 'A tagline',
    author: 'Somebody',
    base_url: 'http://localhost:3000',
    timezone: 'UTC',
    language: 'en',
  },
  reading: {
    homepage: '',
    posts_page: '',
    posts_per_page: '10',
    notify_server: 'https://rpc.rsscloud.io',
  },
  permalinks: {
    tag_base: 'tag',
    category_base: 'category',
  },
  discussion: {
    comments: '1',
    comments_close_after_days: '14',
    webmentions_send: '1',
    webmentions_receive: '1',
  },
  email: {
    mail_provider: 'none',
    mail_from_name: '',
    mail_from_address: '',
    mail_reply_to: '',
    contact_email: '',
  },
  federation: {
    actor_handle: 'blog',
    actor_type: 'Person',
    relays: '',
  },
};

/** Where one settings page lives, by the name it is known by here. */
export function settingsPageUrl(page: string): string {
  const found = SETTINGS_PAGES.find((one) => one.child === page);
  assert.ok(found !== undefined, `${page} is a settings page`);
  return found.path;
}

/** The CSRF token on one settings page, as a browser would carry it. */
export async function settingsToken(agent: Browser, page: string): Promise<string> {
  const token = csrfField(await (await agent.get(settingsPageUrl(page))).text());
  assert.ok(token !== undefined, `the ${page} settings form carried a CSRF token`);
  return token;
}

/** Submit one settings page, filling in whatever the caller did not name. */
export async function saveSettings(
  agent: Browser,
  page: string,
  fields: Record<string, string> = {},
): Promise<Response> {
  return agent.post(settingsPageUrl(page), {
    csrf_token: await settingsToken(agent, page),
    ...SETTINGS_PAGE_FORMS[page],
    ...fields,
  });
}
