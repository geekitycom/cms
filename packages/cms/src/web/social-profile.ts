import type { Context } from 'hono';

import { contactOpen } from '../contact/form.ts';
import { rewriteMarkdownLinks } from '../content/markdown-links.ts';
import { isServed } from '../content/served.ts';
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
  readonly url: string;
  readonly summary?: string | undefined;
  readonly bioMarkdown?: string | undefined;
  readonly bioPlainText?: string | undefined;
  readonly avatar?: string | undefined;
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
  const avatar = owner?.avatar ?? site.avatar;
  const tagline = oneLine(site.tagline ?? '');
  const contactPage = view.store
    .listAll({ type: 'page', draft: false, scheduled: false })
    .find((page) => contactOpen(page) && isServed(page, view.store.now()));

  return {
    kind: owner === undefined ? 'org' : 'individual',
    name: owner?.name ?? site.title,
    url: absolute('/'),
    summary: tagline === '' ? undefined : tagline,
    bioMarkdown:
      owner?.bio === undefined
        ? undefined
        : rewriteMarkdownLinks(owner.bio, (href) =>
            href.startsWith('/') ? absolute(href) : undefined,
          ),
    bioPlainText: owner?.bioText,
    avatar: avatar === undefined || avatar === '' ? undefined : absolute(avatar),
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

export function contactVcard(profile: SiteProfile): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `KIND:${profile.kind}`,
    `FN:${vcardText(profile.name)}`,
    ...(profile.jobTitle === undefined ? [] : [`TITLE:${vcardText(profile.jobTitle)}`]),
    ...(profile.bioPlainText === undefined ? [] : [`NOTE:${vcardText(profile.bioPlainText)}`]),
    ...(profile.avatar === undefined ? [] : [`PHOTO:${profile.avatar}`]),
    `URL;PREF=1:${profile.url}`,
    ...profile.links.filter((link) => link.href !== profile.url).map((link) => `URL:${link.href}`),
    // RFC 8605: CONTACT-URI holds an email address or a web form location.
    ...(profile.contactFormUrl === undefined ? [] : [`CONTACT-URI:${profile.contactFormUrl}`]),
    'END:VCARD',
  ];
  return lines.map(foldVcardLine).join('');
}

/** RFC 6350 §3.4's escaping of a TEXT value. */
function vcardText(value: string): string {
  return value.replace(/[\\,;]/g, '\\$&').replace(/\r\n|\r|\n/g, '\\n');
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
