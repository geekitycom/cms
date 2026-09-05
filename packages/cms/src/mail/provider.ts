/**
 * The seam every way of sending email goes through.
 *
 * The CMS knows about mail services the way it knows about spam services
 * (doc-6): one interface, and nothing else. Two implementations ship — Brevo's
 * transactional API and plain SMTP through nodemailer — and a site may hand in
 * its own, which is what {@link createMemoryMailProvider} is for in a test.
 *
 * A provider has exactly one job: hand this message to something that will
 * carry it, and either say what it was given as an id or throw. It decides
 * nothing about retries, queueing, templates or whether the site is configured
 * to send at all; that is {@link MailService}'s, and keeping it there is what
 * makes a second provider a file rather than a redesign.
 */

/** Which of the ways of sending a site has chosen. */
export type MailProviderName =
  /** The site sends no mail. `send` is a logged no-op. */
  | 'none'
  /** Brevo's transactional HTTP API. */
  | 'brevo'
  /** Any SMTP server, through nodemailer. */
  | 'smtp'
  /** The in-memory provider a test observes. */
  | 'memory';

/**
 * The providers a site may choose on the settings screen, in the order the
 * form offers them.
 *
 * `memory` is not among them: it is a test double a site names in its config,
 * not something anybody should be able to switch a live site to from a form.
 */
export const MAIL_PROVIDERS: readonly MailProviderName[] = ['none', 'brevo', 'smtp'];

/** Somebody a message is from, to, or answered to. */
export interface MailAddress {
  /** The address itself, `ada@example.com`. */
  readonly address: string;
  /** The display name, when there is one. */
  readonly name?: string | undefined;
}

/**
 * One message, as a provider receives it: addresses settled, templates already
 * rendered, nothing left to decide.
 */
export interface OutgoingMail {
  /** Who it is from. */
  readonly from: MailAddress;
  /** Who it is to. At least one. */
  readonly to: readonly MailAddress[];
  /** Where a reply should go, when that is not the sender. */
  readonly replyTo?: MailAddress | undefined;
  /** The subject line. */
  readonly subject: string;
  /** The plain text body, which every message has. */
  readonly text: string;
  /** The HTML twin, when the template has one. */
  readonly html?: string | undefined;
}

/** What a provider says about a message it accepted. */
export interface MailDelivery {
  /**
   * The id the provider gave it, when it gave one. It is what makes a message
   * findable in the provider's own logs, which is the whole reason the service
   * writes it down.
   */
  readonly messageId?: string | undefined;
}

/** Something that carries a message. */
export interface MailProvider {
  /** Which kind it is, for the log and for the settings screen. */
  readonly name: MailProviderName;
  /**
   * Hand the message over.
   *
   * Throws when it was not accepted — a refusal, a timeout, a connection that
   * would not open. The service catches it, logs it and decides whether to try
   * again, so a provider never has to know how patient the site is.
   */
  deliver(message: OutgoingMail): Promise<MailDelivery>;
}
