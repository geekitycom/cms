import type { Context, Hono } from 'hono';

import { clientAddress, createLoginThrottle } from '../admin/throttle.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { isPublicDocument } from '../web/documents.ts';
import { sendContactMessage } from './delivery.ts';
import {
  CONTACT_ANCHOR,
  CONTACT_FIELDS,
  CONTACT_NOTICE_PARAM,
  CONTACT_POST_PATH,
  contactOpen,
  contactValuesOf,
  refilledContactForm,
} from './form.ts';
import type { ContactForm, ContactFormContext } from './form.ts';
import {
  CONTACT_RATE_LIMIT,
  CONTACT_RATE_WINDOW_SECONDS,
  submitContactMessage,
} from './submission.ts';
import type { ContactThrottle } from './submission.ts';

/**
 * The one public endpoint the contact form adds: where the form on a page
 * posts to.
 *
 * A single path rather than one per page because the page is a field of the
 * form. That keeps it out of the way of every permalink a site might mint — a
 * path under `/_geekity/` is the CMS's own, like the comment endpoint beside
 * it — and means the route table does not grow with the site.
 *
 * Everything it answers is either a redirect or the page rendered again with
 * the form still filled in. There is no JSON, no fragment and no script.
 */

/** Register the contact endpoint. Mounted by the public site. */
export function mountContact(app: Hono<GeekityEnv>): void {
  // One limiter for the whole mount, built on the first submission because the
  // clock is on the context. It holds nothing but recent submissions, so it
  // belongs to the process rather than the database: a restart clears it,
  // which is the right trade for state an anonymous caller can create.
  let limiter: ContactThrottle | undefined;

  function throttle(config: ResolvedConfig): ContactThrottle {
    limiter ??= createLoginThrottle({
      attempts: CONTACT_RATE_LIMIT,
      lockoutSeconds: CONTACT_RATE_WINDOW_SECONDS,
      now: config.now,
    });
    return limiter;
  }

  app.post(CONTACT_POST_PATH, async (c) => {
    const { store, config } = c.var;
    const body = await c.req.parseBody();
    const form = formOf(body);

    const document = store.getBySlug(form.page);
    if (document === undefined || !isPublicDocument(document, store.now())) {
      return c.text('There is no such page to write to.', 404);
    }

    if (!contactOpen(document)) {
      // 403 rather than 404: the page is there, and a reader can see for
      // themselves that it is. It simply does not take messages.
      return c.text('That page is not taking messages.', 403);
    }

    const now = config.now();
    const outcome = await submitContactMessage({
      dataDir: config.dataDir,
      document,
      form,
      baseUrl: config.baseUrl,
      // The same checker comments go through, told this is a contact form.
      checker: config.commentChecker,
      address: clientAddress(c, config),
      userAgent: c.req.header('user-agent'),
      referrer: c.req.header('referer'),
      throttle: throttle(config),
      now,
    });

    if (outcome.kind === 'stored') {
      // The message is on disk already, so the sender is thanked now and the
      // mail goes out behind them. A provider that is down costs a
      // notification rather than the message.
      sendContactMessage({
        mail: c.var.mail,
        contentDir: config.contentDir,
        dataDir: config.dataDir,
        baseUrl: config.baseUrl,
        message: outcome.message,
      });

      return c.redirect(sentUrl(document), 303);
    }

    const refusal = outcome.refusal;
    if (refusal.kind === 'discarded') {
      // Nothing is said about why. A robot that filled the honeypot, or that a
      // checker recognised, learns exactly as much from this as from a
      // message that went — which is the point of both defences.
      return c.redirect(sentUrl(document), 303);
    }

    if (refusal.kind === 'rate-limited') {
      c.header('Retry-After', String(refusal.retryAfter));
      return page(c, document, 429, {
        ...refilledContactForm(document, contactValuesOf(form), {}, now),
        error: 'That is a lot of messages in a short time. Try again in a few minutes.',
      });
    }

    const message =
      refusal.kind === 'too-quick'
        ? 'That was sent faster than anybody types. Try again.'
        : refusal.kind === 'stale'
          ? 'That form had been open a long time. Here it is again — the words are still there.'
          : undefined;

    return page(c, document, 400, {
      ...refilledContactForm(document, contactValuesOf(form), problemsOf(refusal), now),
      ...(message === undefined ? {} : { error: message }),
    });
  });
}

/** Where a sender is redirected once the message is stored. */
function sentUrl(document: Document): string {
  return `${document.permalink}?${CONTACT_NOTICE_PARAM}=sent#${CONTACT_ANCHOR}`;
}

/** The statuses a refused submission is answered with. */
type RefusalStatus = 400 | 429;

/** The page itself, rendered again with this form on it. */
function page(
  c: Context<GeekityEnv>,
  document: Document,
  status: RefusalStatus,
  form: ContactFormContext,
): Response {
  c.status(status);
  return c.html(c.var.renderer.renderDocument(document, { contactForm: form }));
}

/** The per-field messages a refusal carries, if it carries any. */
function problemsOf(refusal: { kind: string; problems?: unknown }): Record<string, string> {
  return refusal.kind === 'invalid' ? ((refusal.problems ?? {}) as Record<string, string>) : {};
}

/** A submitted body as the form it is, every field a string. */
function formOf(body: Record<string, unknown>): ContactForm {
  return {
    page: text(body[CONTACT_FIELDS.page]),
    name: text(body[CONTACT_FIELDS.name]),
    email: text(body[CONTACT_FIELDS.email]),
    subject: text(body[CONTACT_FIELDS.subject]),
    message: text(body[CONTACT_FIELDS.message]),
    trap: text(body[CONTACT_FIELDS.trap]),
    loaded: text(body[CONTACT_FIELDS.loaded]),
  };
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
