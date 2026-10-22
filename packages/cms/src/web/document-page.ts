import type { Context } from 'hono';

import { COMMENT_NOTICE_PARAM, COMMENT_REPLY_PARAM } from '../comments/form.ts';
import type { CommentViewer } from '../comments/form.ts';
import { commentNoticeFor, commentReplyTarget } from '../comments/page-form.ts';
import { commenterOf } from '../comments/viewer.ts';
import { CONTACT_NOTICE_PARAM, contactNoticeFor } from '../contact/form.ts';
import type { Document } from '../content/document.ts';
import { isListed } from '../content/served.ts';
import type { GeekityEnv } from './env.ts';
import { absoluteUrl } from '../util/url.ts';
import { pingbackEndpointFor } from '../webmention/pingback.ts';
import { WEBMENTION_PATH } from '../webmention/endpoint.ts';
import { documentMarkdown } from './markdown-representation.ts';
import {
  DOCUMENT_REPRESENTATIONS,
  documentJson,
  lastModifiedOf,
  notAcceptableResponse,
  representationEtag,
  representationResponse,
} from './negotiate.ts';
import type { Representation } from './negotiate.ts';
import { conditionalHeaders, drawnForSomebody, encodePath } from './request.ts';
import { servedPath, siteView } from './site-view.ts';

/**
 * One document in one representation, or the 406 an impossible `Accept` earns.
 *
 * It is served at {@link servedPath}: a page serving as the homepage is read at
 * `/`, and the canonical URL, the alternates, the theme's own links, the
 * Markdown's front matter and the JSON's `url` have to say so.
 */
export function negotiateDocument(
  c: Context<GeekityEnv>,
  document: Document,
  representation: Representation | undefined,
): Response {
  const path = servedPath(document, siteView(c).pages.home);
  const href = encodePath(path);
  if (representation === undefined) {
    return notAcceptableResponse(href, DOCUMENT_REPRESENTATIONS);
  }

  // Who the request's session says is reading, when it says anybody
  // (TASK-103). Only the HTML has a form on it, so only the HTML asks; the
  // Markdown and JSON of a post are the same bytes for everybody.
  const account = representation === 'html' ? c.var.signedIn : undefined;
  const viewer = account === undefined ? undefined : commenterOf(account);
  // And which document it is, so the admin bar can offer its editor.
  if (representation === 'html') c.set('shownDocument', document);
  const listed = isListed(document, c.var.store.now());

  // The thank-you after a comment was posted, which the redirect carried back
  // as a query, is the only thing about a document's HTML that the URL rather
  // than the file decides. A document served at `/` is the site's front page,
  // and the front page is the one place a theme may lay a page out differently.
  const page =
    representation === 'html'
      ? c.var.renderer.renderPage(document, {
          frontPage: path === '/',
          extra: { ...commentNotice(c, document, viewer), ...(listed ? {} : { noindex: true }) },
          viewer,
        })
      : undefined;

  const served = path === document.permalink ? document : { ...document, permalink: path };
  const markdown =
    representation === 'markdown' || representation === 'text'
      ? documentMarkdown(c, document, path)
      : undefined;
  const body =
    markdown ??
    (representation === 'json'
      ? documentJson(served, { baseUrl: c.var.config.baseUrl })
      : page?.html);

  const response = representationResponse({
    body,
    representation,
    href,
    available: DOCUMENT_REPRESENTATIONS,
    noindex: !listed,
    // Where a webmention about this page is sent. It is a header rather than
    // only a `<link>` because a sender is allowed to find the endpoint without
    // parsing the page, and because the JSON and Markdown representations of a
    // post have no head to put one in (TASK-51).
    links: webmentionLinks(c),
    ...(drawnForSomebody(c, representation) ? { private: true } : {}),
    ...validatorsFor(representation, document, page?.fingerprint ?? markdown),
    conditional: conditionalHeaders(c),
  });

  const pingback = pingbackEndpointFor(c.var.renderer.site());
  if (pingback !== undefined) {
    response.headers.set('x-pingback', absoluteUrl(pingback, c.var.config.baseUrl));
  }
  return response;
}

function validatorsFor(
  representation: Representation,
  document: Document,
  drawnBytes: string | undefined,
): { etag: string; lastModified?: Date | undefined } {
  if (drawnBytes !== undefined) {
    return { etag: representationEtag(representation, drawnBytes) };
  }
  return {
    etag: representationEtag(representation, document.hash),
    lastModified: lastModifiedOf(document),
  };
}

/**
 * What the query string puts on a rendered post, if anything.
 *
 * A reader has no session, so the message after a submission travels in the
 * URL and is read back here. An unknown value says nothing at all rather than
 * being printed, so the query cannot be used to put words on somebody's post.
 */
function commentNotice(
  c: Context<GeekityEnv>,
  document: Document,
  viewer: CommentViewer | undefined,
): Record<string, unknown> {
  const notice = commentNoticeFor(c.req.query(COMMENT_NOTICE_PARAM));

  return {
    ...(notice === undefined ? {} : { commentNotice: notice }),
    // And who a Reply link says the form is answering, which travels the same
    // way and for the same reason: a reader has no session, and threading
    // should not need a line of JavaScript.
    ...commentReplyTarget({
      admin: c.var.admin,
      document,
      id: c.req.query(COMMENT_REPLY_PARAM),
      thread:
        viewer === undefined
          ? undefined
          : c.var.conversation.thread(document, c.var.siteAtRequestStart),
    }),
    // And the thank-you after a contact form was sent, which travels the same
    // way for the same reason (TASK-56).
    ...contactNotice(c),
  };
}

/**
 * The thank-you a contact form's redirect landed on, if the query names one.
 *
 * On the context rather than in the form's own state because the redirect is
 * what makes a refresh harmless: the page is drawn fresh, and the query is the
 * only thing that says a message went.
 */
function contactNotice(c: Context<GeekityEnv>): Record<string, unknown> {
  const notice = contactNoticeFor(c.req.query(CONTACT_NOTICE_PARAM));
  return notice === undefined ? {} : { contactNotice: notice };
}

/**
 * The `Link` header advertising this site's webmention endpoint, or none when
 * the site does not take them.
 *
 * Read per request off the settings, so turning webmentions off on the
 * settings screen takes the advertisement off the very next page rather than
 * off the next restart.
 */
function webmentionLinks(c: Context<GeekityEnv>): string[] {
  if (!c.var.siteAtRequestStart.webmentions_receive) return [];
  return [`<${WEBMENTION_PATH}>; rel="webmention"`];
}
