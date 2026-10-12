import type { ResolvedConfig } from '../config.ts';
import type { LocationSharing } from '../content/location.ts';
import type { MailProviderName } from '../mail/provider.ts';
import type { RetentionPolicy } from './retention-policy.ts';
import { DEFAULT_FEED_CADENCE, DEFAULT_NOTIFY_SERVER } from './feed-settings.ts';
import type { UpdatePeriod } from './feed-settings.ts';
import type { CreativeCommonsKey } from '../content/license.ts';
import type { NavigationMenus } from './navigation.ts';
import type { AiCrawlerPolicy, ContentSignal, ContentSignalName, RobotsPolicy } from './robots.ts';
import { DEFAULT_TAXONOMY_BASES } from '../content/taxonomy.ts';
import { PACKAGED_THEME } from '../theme/themes.ts';
import type { TaxonomyBases, TaxonomyRedirect } from '../content/taxonomy.ts';

/**
 * How long a post takes comments for, in days, before this is decided
 * otherwise. WordPress's own default, and the age at which a post stops being
 * a conversation and starts being a spam target.
 */
export const DEFAULT_COMMENTS_CLOSE_AFTER_DAYS = 14;

/**
 * The settings a site holds, as `content/_data/site.json` says them.
 *
 * The file is the source of truth (decision-9): the settings screen reads it,
 * validates the form and writes it back, and nothing else remembers a setting.
 * That is what makes a hand edit of the file — in an editor, from a git
 * checkout, by an Eleventy build's own tooling — show on the very next
 * request, and what makes `data/geekity.db` a cache a site may delete.
 *
 * This shape is the typed view of the file. Each key has one row in
 * `setting-rows.ts` saying how the file holds it and how the settings form
 * carries it. The file may hold keys this shape does not model — `feedSize`,
 * anything a site put there — and a save keeps every one of them.
 */
export interface SiteSettings {
  /** Site title, shown in the header, the `<title>` and the feeds. */
  title: string;
  /** One-line description under the title. May be empty. */
  tagline: string;
  /**
   * Public origin. Whether it is the one in effect depends on
   * {@link ResolvedConfig.baseUrlSource}; see {@link effectiveBaseUrl}.
   */
  baseUrl: string;
  /** An IANA zone name, e.g. `Europe/London`. */
  timezone: string;
  /**
   * The site's language as a BCP 47 tag, `en` by default. It is the
   * `<html lang>` the theme writes, the RSS channel's `<language>` and the
   * Atom feed's `xml:lang`.
   */
  language: string;
  /**
   * The locale the public site's dates and counts are written in, when it is
   * not the language: `en-US` on an `en` site, say. Empty, the default, means
   * the language.
   */
  locale: string;
  /** How many posts a listing page holds. A positive integer. */
  postsPerPage: number;
  /**
   * The slug of the page served at `/`, or empty when the site shows its
   * latest posts there. WordPress's Reading choice.
   *
   * A slug rather than a permalink, because a permalink is a thing the editor
   * may change and the setting should follow the page rather than the URL it
   * happened to have. A slug naming nothing published — a page drafted,
   * trashed or deleted since — is a site back on its latest posts: the pick is
   * kept so putting the page back puts the front page back with it.
   */
  homepage: string;
  /**
   * The slug of the page whose permalink carries the post listing, or empty
   * for none. Only meaningful beside a {@link SiteSettings.homepage}, and the
   * settings screen refuses one without it, exactly as WordPress does.
   */
  postsPage: string;
  /**
   * Who the site is: one user's username, or empty for a site with several
   * authors (TASK-192). A username makes it that user's blog: the homepage
   * carries their bio card and their `rel="me"` links, it and their archive
   * claim each other, and the root is their IndieAuth identity (decision-23).
   *
   * A file written before the Site author select may hold a display name or a
   * name nobody has. It is read as stored and resolved where it is used, by
   * `userForAuthor`, so a display name still names its user and anything else
   * names nobody; the General page writes the username at its next save.
   */
  author: string;
  /**
   * The theme the site renders through: the name of one directory under the
   * configured themes directory, or empty for the theme the package ships
   * (decision-15).
   *
   * A setting rather than a deployment fact, for the reason the tagline is: it
   * is a look somebody chooses on the Appearance screen, and a site moved from
   * one host to another should arrive looking the same. A name that is not a
   * theme is refused here and falls back to the packaged theme out on the
   * site, so a hand-edited file is a warning in the log rather than a 500.
   */
  theme: string;
  /**
   * The upload the site's icons are derived from, as a path such as
   * `/uploads/2026/10/icon.png`, or empty for none. Read from and written
   * to the `icon` key of `site.json` only.
   */
  icon: string;
  /**
   * What readers may do with the site's posts: empty for no
   * license, which is all rights reserved, a Creative Commons key, or
   * `custom` for the URL and name beside it. `site.json` writes a key, or a
   * custom license's URL, under `license`, so the file says it the way a
   * post's front matter does.
   */
  license: LicenseChoice;
  /** A custom license's terms, as an absolute URL. Empty unless `license` is `custom`. */
  licenseUrl: string;
  /** A custom license's name. Empty unless `license` is `custom`. */
  licenseName: string;
  /**
   * The first URL segment the tag archives live under, `tag` by default: one
   * URL-safe path segment, no slashes. WordPress's own base, so a site
   * imported from it keeps every archive URL it published.
   */
  tagBase: string;
  /** The same for the category archives, `category` by default. */
  categoryBase: string;
  /**
   * Whether the site takes native comments at all (TASK-50).
   *
   * Off means off everywhere: no form under any post, and every submission
   * refused. It does not touch the fediverse — a reply, a like or a boost
   * arrives because a remote server sent it, and a site cannot stop that or
   * pretend it did not happen.
   */
  comments: boolean;
  /**
   * How many days after its `date` a post stops taking comments. Zero never
   * closes one.
   *
   * The age at which a post stops being a conversation and starts being a spam
   * target; fourteen days is WordPress's own default. A post may say otherwise
   * for itself with `comments: true` or `comments: false` in its front matter.
   */
  commentsCloseAfterDays: number;
  /**
   * How many days a comment keeps its author's email (TASK-135). Zero keeps it
   * forever. Past it the email is removed from the comment file and the index,
   * and with it the author's subscription to replies.
   */
  commentEmailRetentionDays: number;
  /**
   * How many days a comment or a contact message keeps the salted hash of the
   * address it came from. Zero keeps it forever.
   */
  addressHashRetentionDays: number;
  /** How many days a contact message is kept at all. Zero keeps it forever. */
  contactMessageRetentionDays: number;
  /**
   * Whether the site tells the pages a post links to that it has (TASK-51).
   *
   * On by default, because a link nobody is told about is half a conversation.
   * Off means no webmention is ever sent, including by the Resend button.
   */
  webmentionsSend: boolean;
  /**
   * Whether the site accepts webmentions sent to it (TASK-51).
   *
   * On by default. Off takes the endpoint off every page and answers the
   * endpoint itself with a 404, which is what a site that does not receive
   * them looks like from outside. It does not touch the fediverse, and it does
   * not touch what has already arrived: a webmention already in the queue is
   * still there for a moderator.
   */
  webmentionsReceive: boolean;
  /**
   * Where the site announces that a feed changed, and the server its feeds
   * advertise as their rssCloud endpoint and their WebSub hub. An absolute
   * http(s) URL, {@link DEFAULT_NOTIFY_SERVER} by default; empty turns
   * real-time notification off altogether.
   */
  notifyServer: string;
  /**
   * How often the RSS feeds tell a reader to poll them: `feedUpdateFrequency`
   * times a `feedUpdatePeriod`, in the Syndication module's two elements
   * (TASK-152). Once an hour by default, which is what WordPress declares.
   */
  feedUpdatePeriod: UpdatePeriod;
  /** How many polls per {@link SiteSettings.feedUpdatePeriod}: a whole number, at least one. */
  feedUpdateFrequency: number;
  /**
   * How the site treats the crawlers that feed AI products, as the robots file
   * spells it in per-agent groups (TASK-148). `allow` by default.
   */
  aiCrawlers: AiCrawlerPolicy;
  /**
   * The three Content-Signal preferences the robots file declares: `yes`,
   * `no`, or empty for a signal the site says nothing about.
   */
  contentSignalSearch: ContentSignalChoice;
  /** Whether the site's pages may be fed to an AI answer live. */
  contentSignalAiInput: ContentSignalChoice;
  /** Whether the site's pages may be used to train a model. */
  contentSignalAiTrain: ContentSignalChoice;
  /**
   * Lines the robots file carries beyond the CMS's own: groups of
   * `User-agent` lines and their rules, one line per entry, blank lines
   * between groups. Every group still keeps crawlers out of the admin.
   */
  robotsRules: readonly string[];
  /**
   * Whether the site serves `/llms.txt` and advertises it from the home page
   * (TASK-149). On by default. A site that wants to write the file itself
   * leaves this on and puts it at `content/llms.txt`.
   */
  llmsTxt: boolean;
  /**
   * Whether the site tells the IndexNow search engines about every URL a
   * publish, an edit or a deletion moved (TASK-151). Off by default: it sends
   * the site's URLs to a third party, which is the site's call to make.
   */
  indexNow: boolean;
  /**
   * The key IndexNow verifies the site by, served at `/{key}.txt`. Generated
   * the first time IndexNow is turned on and kept when it is turned off, so
   * turning it back on keeps the key the search engines already checked. It
   * is no secret: the whole point of it is that anybody can fetch it.
   */
  indexNowKey: string;
  /**
   * How the site sends email, or `none` for a site that does not (TASK-53).
   *
   * The name of the provider only. The key or the SMTP password that makes it
   * work is a credential and lives in `data/mail.json`, never here: this file
   * is public, in git and published with the site.
   */
  mailProvider: MailProviderName;
  /** The display name on the From line. Falls back to the site title. */
  mailFromName: string;
  /**
   * The address on the From line. Empty falls back to `no-reply@` at the base
   * URL's host, which is what an unconfigured site would have to send as
   * anyway — but a provider will only accept a sender it has verified, so a
   * site that sends anything real sets this.
   */
  mailFromAddress: string;
  /** Where a reply to the site's mail should go. Empty means the From address. */
  mailReplyTo: string;
  /**
   * Where a message from the contact form is sent (TASK-56).
   *
   * Empty falls back to the first admin with an email, so a site that has
   * never visited this field still has somewhere to write. It is read when a
   * message arrives and is never put on a render context, so it cannot appear
   * in the HTML of the page the form is on however a theme is written.
   */
  contactEmail: string;
  /**
   * Where a security researcher reports a vulnerability: the `Contact` lines
   * of `/.well-known/security.txt` (RFC 9116, TASK-133), each a `mailto:`,
   * `https:` or `tel:` URI, in the order the site prefers them.
   *
   * Empty means the site answers that path with a 404. There is no fallback
   * to {@link SiteSettings.contactEmail}: that address is promised never to
   * appear on the public site, and this one is published by definition.
   */
  securityContacts: readonly string[];
  /** The `Policy` line of security.txt: an https URL, or empty for none. */
  securityPolicy: string;
  /**
   * The `Preferred-Languages` line of security.txt: language tags joined by
   * `, `, or empty for none.
   */
  securityLanguages: string;
  /**
   * The relay inboxes the site subscribes to (FEP-ae0c): a Mastodon-style
   * relay boosts every public post it is sent, which is how a small site
   * reaches instances nobody on it follows.
   *
   * Each is the relay's own inbox URL, absolute and whole — a relay's inbox is
   * a path like `/user/_____relay_____/inbox`, not an origin. The list is
   * edited one per line on the settings screen and held as an array in the
   * file; where each subscription stands is in the database, because the
   * handshake is not the site's to decide.
   */
  relays: readonly string[];
  /**
   * Every menu the site holds, by name: `site.json`'s `menus`, each an ordered
   * list of items a theme renders wherever it declares an area of that name
   * and an Eleventy build reads out of the same file.
   *
   * Not a field of the settings form, and deliberately: a menu is content a
   * site arranges rather than a switch it sets, and which menus there are to
   * edit comes from the active theme. The Navigation screen is what writes
   * them (TASK-108); a settings page carries them through a save untouched,
   * the way it carries the archive renames.
   */
  menus: NavigationMenus;
  /**
   * The taxonomy archives that have moved: one `{ taxonomy, from, to }` per
   * term the taxonomy screens renamed or merged away, so the URL it used to
   * live at can point at the one it lives at now.
   *
   * Not a field of the settings form: it is a record of what happened rather
   * than a preference, and the taxonomy screens are what write it. Chains are collapsed as they are
   * recorded, so the list answers every old URL in one hop.
   */
  taxonomyRedirects: readonly TaxonomyRedirect[];
  /**
   * What the site publishes of a post's location (TASK-223, decision-29):
   * nothing, the place's words, or the coordinates too. `none` by default,
   * because the location is personal data and the author chooses to share it.
   * Chosen on Settings > Privacy.
   */
  locationSharing: LocationSharing;
  /**
   * The IndieAuth apps the owner lets sign in without PKCE (TASK-225), each a
   * client_id. Empty, the default, means every app needs PKCE, as the
   * IndieAuth spec says. Not a field of the settings form: Users > Connected
   * apps edits it, and a settings save carries it, like the menus.
   */
  clientsWithoutPkce: readonly string[];
}

/** What a site says about one Content-Signal: yes, no, or nothing. */
export type ContentSignalChoice = '' | 'yes' | 'no';

export type LicenseChoice = '' | CreativeCommonsKey | 'custom';

/**
 * What a site is worth before anybody has said otherwise.
 *
 * `baseUrl` is empty rather than a guess: only the resolved config knows what
 * port the site is on, so the fallback is applied where the config is in hand.
 */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  title: 'Geekity',
  tagline: '',
  baseUrl: '',
  timezone: 'UTC',
  language: 'en',
  locale: '',
  postsPerPage: 10,
  homepage: '',
  postsPage: '',
  author: '',
  theme: PACKAGED_THEME,
  icon: '',
  license: '',
  licenseUrl: '',
  licenseName: '',
  tagBase: DEFAULT_TAXONOMY_BASES.tag,
  categoryBase: DEFAULT_TAXONOMY_BASES.category,
  comments: true,
  commentsCloseAfterDays: DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
  // Forever, so a site that upgrades loses nothing it never chose to lose.
  // `geekity init` writes the recommended periods for a new site.
  commentEmailRetentionDays: 0,
  addressHashRetentionDays: 0,
  contactMessageRetentionDays: 0,
  webmentionsSend: true,
  webmentionsReceive: true,
  notifyServer: DEFAULT_NOTIFY_SERVER,
  feedUpdatePeriod: DEFAULT_FEED_CADENCE.period,
  feedUpdateFrequency: DEFAULT_FEED_CADENCE.frequency,
  aiCrawlers: 'allow',
  contentSignalSearch: '',
  contentSignalAiInput: '',
  contentSignalAiTrain: '',
  robotsRules: [],
  llmsTxt: true,
  indexNow: false,
  indexNowKey: '',
  mailProvider: 'none',
  mailFromName: '',
  mailFromAddress: '',
  mailReplyTo: '',
  contactEmail: '',
  securityContacts: [],
  securityPolicy: '',
  securityLanguages: '',
  relays: [],
  locationSharing: 'none',
  menus: {},
  taxonomyRedirects: [],
  clientsWithoutPkce: [],
};

/** What the settings say the robots file should carry. */
export function robotsPolicyOf(settings: SiteSettings): RobotsPolicy {
  const choices: [ContentSignalName, ContentSignalChoice][] = [
    ['search', settings.contentSignalSearch],
    ['ai-input', settings.contentSignalAiInput],
    ['ai-train', settings.contentSignalAiTrain],
  ];
  const contentSignal: ContentSignal = {};
  for (const [name, choice] of choices) if (choice !== '') contentSignal[name] = choice;

  return { aiCrawlers: settings.aiCrawlers, contentSignal, rules: settings.robotsRules };
}

/** The two archive bases the settings hold, as the URL builders want them. */
export function taxonomyBasesFromSettings(settings: SiteSettings): TaxonomyBases {
  return { tag: settings.tagBase, category: settings.categoryBase };
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
  return settings.baseUrl === '' ? config.baseUrl : settings.baseUrl;
}

/** The three retention periods, as the sweep reads them. */
export function retentionPolicyOf(settings: SiteSettings): RetentionPolicy {
  return {
    commentEmailDays: settings.commentEmailRetentionDays,
    addressHashDays: settings.addressHashRetentionDays,
    contactMessageDays: settings.contactMessageRetentionDays,
  };
}
