import type { ResolvedConfig } from '../config.ts';
import type { CreativeCommonsKey } from '../content/license.ts';
import type { PermalinkBases } from '../content/taxonomy.ts';
import { defaultValues } from '../settings/declare.ts';
import { SITE } from './namespace.ts';
import type { SiteSettings } from './namespace.ts';
import type { RetentionPolicy } from './retention-policy.ts';
import type { ContentSignal, ContentSignalName, RobotsPolicy } from './robots.ts';

export { DEFAULT_COMMENTS_CLOSE_AFTER_DAYS, SITE } from './namespace.ts';
export type { SiteLicense, SiteSettings } from './namespace.ts';

/** What a site says about one Content-Signal: yes, no, or nothing. */
export type ContentSignalChoice = '' | 'yes' | 'no';

export type LicenseChoice = '' | CreativeCommonsKey | 'custom';

export const DEFAULT_SITE_SETTINGS: SiteSettings = defaultValues(SITE);

/** What the settings say the robots file should carry. */
export function robotsPolicyOf(settings: SiteSettings): RobotsPolicy {
  const choices: [ContentSignalName, ContentSignalChoice][] = [
    ['search', settings.content_signal_search],
    ['ai-input', settings.content_signal_ai_input],
    ['ai-train', settings.content_signal_ai_train],
  ];
  const contentSignal: ContentSignal = {};
  for (const [name, choice] of choices) if (choice !== '') contentSignal[name] = choice;

  return { aiCrawlers: settings.ai_crawlers, contentSignal, rules: settings.robots_rules };
}

export function permalinkBasesFromSettings(settings: SiteSettings): PermalinkBases {
  return { tag: settings.tag_base, category: settings.category_base, wiki: settings.wiki_base };
}

/**
 * The base URL actually in effect, and why.
 *
 * A base URL is a deployment fact before it is a preference: it decides the
 * absolute URLs in the feeds, the ActivityPub ids, and whether the session
 * cookie is `Secure`. So `GEEKITY_BASE_URL` and a `baseUrl` in the config file
 * both win over the stored setting, and the settings form says so rather than
 * offering a field that would quietly do nothing.
 */
export function effectiveBaseUrl(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource'>,
  settings: SiteSettings,
): string {
  if (config.baseUrlSource !== 'default') return config.baseUrl;
  return settings.base_url === '' ? config.baseUrl : settings.base_url;
}

/** The three retention periods, as the sweep reads them. */
export function retentionPolicyOf(settings: SiteSettings): RetentionPolicy {
  return {
    commentEmailDays: settings.comment_email_retention_days,
    addressHashDays: settings.address_hash_retention_days,
    contactMessageDays: settings.contact_message_retention_days,
  };
}
