import { readFile } from 'node:fs/promises';

import type { Context } from 'hono';

import { contactOpen } from '../contact/form.ts';
import { rewriteMarkdownLinks } from '../content/markdown-links.ts';
import { isServed } from '../content/served.ts';
import { parseIconSetting } from '../images/icon-setting.ts';
import { findImageVariant, generateImageVariants } from '../images/variants.ts';
import type { ImageConfig } from '../images/variants.ts';
import { siteAuthorContext } from '../site/authors.ts';
import { effectiveBaseUrl } from '../site/settings.ts';
import { absoluteUrl } from '../util/url.ts';
import type { GeekityEnv } from './env.ts';
import { escapeMarkdown, linkList, markdownFile, oneLine } from './markdown-page.ts';
import { contentEtag, isNotModified } from './negotiate.ts';
import { conditionalHeaders } from './request.ts';
import { siteView } from './site-view.ts';

/** AboutSpec's Markdown profile, one of the files a SocialSpec reader fetches. */
export const ABOUT_MD_PATH = '/.well-known/about.md';

/** ContactSpec's vCard, the other. */
export const CONTACT_VCF_PATH = '/.well-known/contact.vcf';

export interface SiteProfile {
  readonly kind: 'individual' | 'org';
  readonly name: string;
  readonly givenName?: string | undefined;
  readonly familyName?: string | undefined;
  readonly url: string;
  readonly summary?: string | undefined;
  readonly bioMarkdown?: string | undefined;
  readonly bioPlainText?: string | undefined;
  readonly avatar?: string | undefined;
  readonly avatarPath?: string | undefined;
  readonly jobTitle?: string | undefined;
  readonly location?: string | undefined;
  readonly links: readonly { readonly label: string; readonly href: string }[];
  readonly contactFormUrl?: string | undefined;
}

export function siteProfileOf(c: Context<GeekityEnv>): SiteProfile {
  const site = c.var.renderer.site();
  const view = siteView(c);
  const baseUrl = effectiveBaseUrl(c.var.config, c.var.siteAtRequestStart);
  const owner = siteAuthorContext(view.users(), site.author);
  const absolute = (href: string): string => absoluteUrl(href, baseUrl);
  const named = owner?.avatar ?? site.avatar;
  const avatar = named === '' ? undefined : named;
  const tagline = oneLine(site.tagline ?? '');
  const contactPage = view.store
    .listAll({ type: 'page', draft: false, scheduled: false })
    .find((page) => contactOpen(page) && isServed(page, view.store.now()));

  return {
    kind: owner === undefined ? 'org' : 'individual',
    name: owner?.name ?? site.title,
    givenName: owner?.givenName,
    familyName: owner?.familyName,
    url: absolute('/'),
    summary: tagline === '' ? undefined : tagline,
    bioMarkdown:
      owner?.bio === undefined
        ? undefined
        : rewriteMarkdownLinks(owner.bio, (href) =>
            href.startsWith('/') ? absolute(href) : undefined,
          ),
    bioPlainText: owner?.bioText,
    avatar: avatar === undefined ? undefined : absolute(avatar),
    avatarPath: avatar,
    jobTitle: owner?.jobTitle,
    location: owner?.location,
    links: (owner?.links ?? []).map((link) => ({ label: link.label, href: absolute(link.href) })),
    contactFormUrl: contactPage === undefined ? undefined : absolute(contactPage.permalink),
  };
}

export function aboutMarkdown(profile: SiteProfile): string {
  const name = escapeMarkdown(profile.name);
  const role = [profile.jobTitle, profile.location]
    .filter((part) => part !== undefined)
    .map(escapeMarkdown)
    .join(' · ');
  const links = [
    { label: 'Website', url: profile.url },
    ...profile.links.map((link) => ({ label: link.label, url: link.href })),
    ...(profile.contactFormUrl === undefined
      ? []
      : [{ label: 'Contact', url: profile.contactFormUrl }]),
  ];
  const blocks = [
    `### About ${name}`,
    profile.avatar === undefined ? '' : `![${name}](${profile.avatar})`,
    role,
    profile.bioMarkdown ?? '',
    linkList(links, (url) => url),
  ];
  if (profile.summary !== undefined) return markdownFile({ summary: profile.summary }, blocks);
  return `${blocks
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .join('\n\n')}\n`;
}

type ContactLink =
  | {
      readonly kind: 'social';
      readonly service: string;
      readonly username: string;
      readonly href: string;
    }
  | { readonly kind: 'labelled'; readonly label: string; readonly href: string };

export interface ContactPhoto {
  readonly type: 'JPEG' | 'PNG';
  readonly bytes: Buffer;
}

interface SocialService {
  readonly service: string;
  readonly username: (segments: readonly string[]) => string | undefined;
}

const onlySegment = (segments: readonly string[]): string | undefined =>
  segments.length === 1 ? segments[0] : undefined;

const segmentAfter =
  (prefix: string) =>
  (segments: readonly string[]): string | undefined =>
    segments.length === 2 && segments[0] === prefix ? segments[1] : undefined;

/**
 * Services by host. The lower-case names are the types Apple Contacts has
 * built in; any other is a custom service, which it shows as written and
 * drops when the name holds a space.
 */
const SOCIAL_SERVICES: ReadonlyMap<string, SocialService> = new Map([
  ['x.com', { service: 'twitter', username: onlySegment }],
  ['twitter.com', { service: 'twitter', username: onlySegment }],
  ['facebook.com', { service: 'facebook', username: onlySegment }],
  ['linkedin.com', { service: 'linkedin', username: segmentAfter('in') }],
  ['flickr.com', { service: 'flickr', username: segmentAfter('photos') }],
  ['github.com', { service: 'GitHub', username: onlySegment }],
  ['instagram.com', { service: 'Instagram', username: onlySegment }],
  ['threads.net', { service: 'Threads', username: onlySegment }],
  ['bsky.app', { service: 'Bluesky', username: segmentAfter('profile') }],
  ['youtube.com', { service: 'YouTube', username: onlySegment }],
  ['tiktok.com', { service: 'TikTok', username: onlySegment }],
]);

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function contactLinkOf(link: { readonly label: string; readonly href: string }): ContactLink {
  const labelled: ContactLink = { kind: 'labelled', label: link.label, href: link.href };
  if (!URL.canParse(link.href)) return labelled;
  const url = new URL(link.href);
  const host = bareHost(url);
  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  const known = SOCIAL_SERVICES.get(host);
  if (known !== undefined) {
    const username = known.username(segments)?.replace(/^@/, '');
    return username === undefined || username === ''
      ? labelled
      : { kind: 'social', service: known.service, username, href: link.href };
  }
  const fediverse = /^@([^@]+)$/.exec(onlySegment(segments) ?? '')?.[1];
  return fediverse === undefined
    ? labelled
    : { kind: 'social', service: 'Mastodon', username: `@${fediverse}@${host}`, href: link.href };
}

/**
 * Apple Contacts reads vCard 3.0 best, and calls every URL a homepage unless
 * its item group carries an `X-ABLabel`.
 */
export function contactVcard(profile: SiteProfile, photo?: ContactPhoto): string {
  const links = profile.links.filter((link) => link.href !== profile.url).map(contactLinkOf);
  const labelled = [
    ...links.filter((link) => link.kind === 'labelled'),
    ...(profile.contactFormUrl === undefined
      ? []
      : [{ label: 'Contact form', href: profile.contactFormUrl }]),
  ];
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vcardName(profile)}`,
    `FN:${vcardText(profile.name)}`,
    ...(profile.kind === 'org' ? [`ORG:${vcardText(profile.name)}`, 'X-ABShowAs:COMPANY'] : []),
    ...(profile.jobTitle === undefined ? [] : [`TITLE:${vcardText(profile.jobTitle)}`]),
    ...(profile.bioPlainText === undefined ? [] : [`NOTE:${vcardText(profile.bioPlainText)}`]),
    ...(photo === undefined
      ? []
      : [`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.bytes.toString('base64')}`]),
    `URL;type=pref:${profile.url}`,
    ...links.flatMap((link) =>
      link.kind === 'social'
        ? [
            `X-SOCIALPROFILE;type=${vcardParameter(link.service)};x-user=${vcardParameter(link.username)}:${link.href}`,
          ]
        : [],
    ),
    ...labelled.flatMap((link, index) => [
      `item${String(index + 1)}.URL:${link.href}`,
      `item${String(index + 1)}.X-ABLabel:${vcardText(link.label)}`,
    ]),
    'END:VCARD',
  ];
  return lines.map(foldVcardLine).join('');
}

/**
 * `Family;Given;Additional;Prefix;Suffix`. Apple Contacts heads a card with
 * its `NICKNAME` when it has one, so the card carries none and is headed by
 * this name.
 */
function vcardName(profile: SiteProfile): string {
  const { given, family } = nameParts(profile);
  return `${vcardText(family)};${vcardText(given)};;;`;
}

function nameParts(profile: SiteProfile): { given: string; family: string } {
  if (profile.kind === 'org') return { given: '', family: '' };
  if (profile.givenName !== undefined || profile.familyName !== undefined) {
    return { given: profile.givenName ?? '', family: profile.familyName ?? '' };
  }
  const words = profile.name.trim().split(/\s+/);
  if (words.length === 1) return { given: words[0] ?? '', family: '' };
  return { given: words.slice(0, -1).join(' '), family: words.at(-1) ?? '' };
}

/** The escaping of a TEXT value, the same in vCard 3.0 and 4.0. */
function vcardText(value: string): string {
  return value.replace(/[\\,;]/g, '\\$&').replace(/\r\n|\r|\n/g, '\\n');
}

/** vCard 3.0 quotes a parameter value instead of escaping it, so a value cannot hold a quote. */
function vcardParameter(value: string): string {
  const bare = value.replace(/["\r\n]/g, '');
  return /[:;, ]/.test(bare) ? `"${bare}"` : bare;
}

const PHOTO_MIN_WIDTH = 256;

const PHOTO_MAX_BYTES = 1024 * 1024;

const PHOTO_TYPES: ReadonlyMap<string, ContactPhoto['type']> = new Map([
  ['jpeg', 'JPEG'],
  ['png', 'PNG'],
]);

export async function contactPhoto(
  config: ImageConfig,
  avatar: string | undefined,
): Promise<ContactPhoto | undefined> {
  const parsed = avatar === undefined ? undefined : parseIconSetting(avatar);
  if (parsed === undefined || !('source' in parsed)) return undefined;
  const record = await generateImageVariants(config, parsed.source);
  const candidates = (record?.variants ?? []).filter((variant) => PHOTO_TYPES.has(variant.format));
  const chosen =
    candidates.find((variant) => variant.width >= PHOTO_MIN_WIDTH) ?? candidates.at(-1);
  if (record === undefined || chosen === undefined) return undefined;

  const asset = await findImageVariant(config, `${record.source}/${chosen.file}`);
  const type = PHOTO_TYPES.get(chosen.format);
  if (asset === undefined || type === undefined || asset.stats.size > PHOTO_MAX_BYTES) {
    return undefined;
  }
  return { type, bytes: await readFile(asset.file) };
}

/**
 * One content line folded at 75 octets (RFC 6350 §3.2), each continuation
 * opening with a space, and ended with CRLF. A fold never splits a character:
 * the octet limit is counted in UTF-8, the cut made between code points.
 */
function foldVcardLine(line: string): string {
  const pieces: string[] = [];
  let piece = '';
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    const limit = pieces.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      pieces.push(piece);
      piece = '';
      octets = 0;
    }
    piece += character;
    octets += size;
  }
  pieces.push(piece);
  return `${pieces.join('\r\n ')}\r\n`;
}

/** AboutSpec and ContactSpec ask publishers to allow CORS; their readers send `If-None-Match`. */
export function profileFileResponse(
  c: Context<GeekityEnv>,
  body: string,
  contentType: string,
): Response {
  const etag = contentEtag(contentType, body);
  const headers = new Headers({
    etag,
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*',
  });
  if (isNotModified(conditionalHeaders(c), etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set('content-type', contentType);
  return new Response(body, { headers });
}
