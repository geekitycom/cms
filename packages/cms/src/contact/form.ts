import type { Document } from '../content/document.ts';
import { FORM_LOADED_FIELD, FORM_TRAP_FIELD } from '../forms/protection.ts';

/**
 * The contact form: what it is called, what it carries, and when a page has
 * one at all.
 *
 * A page opts in with `contact: true` in its front matter — one key, ignored by
 * Eleventy, the same shape as `navigation: true` — and the theme renders
 * `partials/contact-form.njk` under the page's content. Nothing about where the
 * message goes is here or anywhere the template can reach: the address is read
 * when a submission arrives, so it cannot appear in the HTML however a theme is
 * written.
 */

/** The front matter key a page opts in with. */
export const CONTACT_FRONT_MATTER_KEY = 'contact';

/** Where the contact form posts, under the CMS's own prefix. */
export const CONTACT_POST_PATH = '/_geekity/contact';

/** The query the redirect after a submission carries. */
export const CONTACT_NOTICE_PARAM = 'contact';

/** The anchor the form and its thank-you sit at, so a redirect lands on them. */
export const CONTACT_ANCHOR = 'contact';

/**
 * What that query means, and what the sender is told.
 *
 * A redirect rather than a rendered page, so a refresh does not send the
 * message a second time; a query rather than a flash, because a visitor has no
 * session to hang one on.
 */
export const CONTACT_NOTICES: Readonly<Record<string, string>> = {
  sent: 'Thank you — your message has been sent.',
};

/** The fields the contact form submits. */
export const CONTACT_FIELDS = {
  /** Which page the form was on, as its slug. */
  page: 'page',
  /** The sender's name. Required. */
  name: 'name',
  /** Their email, which the message replies to. Required. */
  email: 'email',
  /** What it is about. Optional. */
  subject: 'subject',
  /** The message itself, as plain text. Required. */
  message: 'message',
  /** The honeypot, which every public form here spells the same way. */
  trap: FORM_TRAP_FIELD,
  /** When the form was rendered, in epoch milliseconds. */
  loaded: FORM_LOADED_FIELD,
} as const;

/** A submitted contact form, as strings, which is what a form has. */
export type ContactForm = Record<
  'page' | 'name' | 'email' | 'subject' | 'message' | 'trap' | 'loaded',
  string
>;

/** The longest a name may be. */
export const MAXIMUM_CONTACT_NAME_LENGTH = 80;

/** The longest an email address may be. */
export const MAXIMUM_CONTACT_EMAIL_LENGTH = 500;

/** The longest a subject may be. */
export const MAXIMUM_CONTACT_SUBJECT_LENGTH = 200;

/** The longest a message may be, in characters. */
export const MAXIMUM_CONTACT_MESSAGE_LENGTH = 10_000;

/** What a form got wrong, one message per field. Empty means it is fine. */
export type ContactProblems = Partial<Record<'name' | 'email' | 'subject' | 'message', string>>;

/**
 * The contact form as a template receives it.
 *
 * `contactForm` is on the context only when the page asked for one, so a layout
 * asks `{% if contactForm %}` rather than reading front matter for itself.
 */
export interface ContactFormContext {
  /** Where the form posts. */
  action: string;
  /** The name each field is submitted under. */
  fields: typeof CONTACT_FIELDS;
  /** Which page the form is on, as the hidden field carries it. */
  page: string;
  /**
   * When this form was rendered, in epoch milliseconds, as the hidden field
   * carries it. What the minimum submit time is measured against.
   */
  loaded: string;
  /** What is in the fields: empty on a fresh form, what was typed on a refused one. */
  values: Record<'name' | 'email' | 'subject' | 'message', string>;
  /** One message per field somebody has to put right. Empty on a fresh form. */
  problems: ContactProblems;
  /** A message about the submission as a whole, when there is one. */
  error?: string | undefined;
  /** The longest a name may be, for the field's `maxlength`. */
  nameLength: number;
  /** The longest a subject may be, for the field's `maxlength`. */
  subjectLength: number;
  /** The longest a message may be, for the textarea's `maxlength`. */
  messageLength: number;
}

/** Whether this document offers a contact form. */
export function contactOpen(document: Document): boolean {
  return document.extra[CONTACT_FRONT_MATTER_KEY] === true;
}

/** A fresh, empty form for a page that asked for one. */
export function contactForm(document: Document, now: Date = new Date()): ContactFormContext {
  return refilledContactForm(document, blankContactValues(), {}, now);
}

/**
 * The same form with what somebody typed still in it.
 *
 * What a refused submission is answered with: losing a paragraph because an
 * email address had a typo in it is the fastest way to lose a message.
 */
export function refilledContactForm(
  document: Document,
  values: ContactFormContext['values'],
  problems: ContactProblems,
  now: Date = new Date(),
  error?: string,
): ContactFormContext {
  return {
    action: CONTACT_POST_PATH,
    fields: CONTACT_FIELDS,
    page: document.slug,
    loaded: String(now.getTime()),
    values,
    problems,
    nameLength: MAXIMUM_CONTACT_NAME_LENGTH,
    subjectLength: MAXIMUM_CONTACT_SUBJECT_LENGTH,
    messageLength: MAXIMUM_CONTACT_MESSAGE_LENGTH,
    ...(error === undefined ? {} : { error }),
  };
}

/** What a form holds before anybody has typed in it. */
export function blankContactValues(): ContactFormContext['values'] {
  return { name: '', email: '', subject: '', message: '' };
}

/** What a submitted form typed, for putting back in a refused one. */
export function contactValuesOf(form: ContactForm): ContactFormContext['values'] {
  return {
    name: form.name,
    email: form.email,
    subject: form.subject,
    message: form.message,
  };
}

/**
 * The form for a document, or `undefined` when it does not offer one.
 *
 * What the renderer is handed at boot, and asked per render: a `contact: true`
 * added to a page in the editor puts a form on it on the very next request.
 */
export function contactFormFor(options: {
  document: Document;
  now: Date;
}): ContactFormContext | undefined {
  if (!contactOpen(options.document)) return undefined;
  return contactForm(options.document, options.now);
}

/**
 * The thank-you a sender is shown after a submission, from the query the
 * redirect carried, or `undefined` when the URL says nothing.
 *
 * An unknown value says nothing at all rather than being printed, so the query
 * cannot be used to put words on somebody's page.
 */
export function contactNoticeFor(query: string | undefined): string | undefined {
  return query === undefined ? undefined : CONTACT_NOTICES[query];
}

/**
 * What is wrong with a submitted form, as a person would be told it.
 *
 * Only the things a person can fix. The honeypot, the form's age and the rate
 * limit are not here: none of them is the sender's mistake, and two of them
 * should not be explained to whoever tripped them.
 */
export function contactProblems(form: ContactForm): ContactProblems {
  const problems: ContactProblems = {};

  const name = form.name.trim();
  if (name === '') problems.name = 'A message needs a name to come from.';
  else if (name.length > MAXIMUM_CONTACT_NAME_LENGTH) {
    problems.name = `That name is longer than ${String(MAXIMUM_CONTACT_NAME_LENGTH)} characters.`;
  }

  // Required, unlike a comment's, because the whole message is a request for
  // an answer: a reply-to is what the site is being asked for.
  const email = form.email.trim();
  if (email === '') problems.email = 'A message needs an address to reply to.';
  else if (!isEmail(email)) problems.email = 'That does not look like an email address.';

  if (form.subject.trim().length > MAXIMUM_CONTACT_SUBJECT_LENGTH) {
    problems.subject = `That subject is longer than ${String(MAXIMUM_CONTACT_SUBJECT_LENGTH)} characters.`;
  }

  const message = form.message.trim();
  if (message === '') problems.message = 'A message needs something in it.';
  else if (message.length > MAXIMUM_CONTACT_MESSAGE_LENGTH) {
    problems.message = `That message is longer than ${String(MAXIMUM_CONTACT_MESSAGE_LENGTH)} characters.`;
  }

  return problems;
}

/**
 * Whether something looks like an email address.
 *
 * Deliberately loose, and the same rule the comment form uses: the only thing
 * a stricter one would buy is refusing valid addresses. Whether it can be
 * delivered to is a question the provider answers.
 */
function isEmail(value: string): boolean {
  if (value.length > MAXIMUM_CONTACT_EMAIL_LENGTH) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}
