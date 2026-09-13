import { readSiteSettings } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import type { ResolvedConfig } from '../config.ts';
import { createThemeSource } from '../web/themes.ts';
import type { ThemeSource } from '../web/themes.ts';
import { createBrevoProvider } from './brevo.ts';
import { readMailCredentials } from './credentials.ts';
import type { MailAddress, MailProvider, MailProviderName, OutgoingMail } from './provider.ts';
import { createSmtpProvider } from './smtp.ts';
import { createMailTemplates } from './templates.ts';
import type { MailTemplates } from './templates.ts';

/**
 * The one door out of this CMS for email.
 *
 * Every feature that emails — a password reset (TASK-54), a moderation notice
 * (TASK-55), a contact form (TASK-56) — calls {@link MailService.send} and
 * nothing else. What carries the message, whether the site is configured to
 * send at all, how many times a refusal is worth trying again and where the
 * attempts are written down are all decided here, once.
 *
 * Three things follow from that, and they are the whole design:
 *
 * - **A site with no mail configuration still works.** `send` resolves
 *   successfully, having sent nothing and said so in the log. A feature that
 *   emails is not a feature that breaks without a mail account.
 * - **Nothing is decided at boot.** The settings and `data/mail.json` are read
 *   per send, so a key pasted into the settings screen sends the next message
 *   and a provider switched there takes effect at once, neither needing a
 *   restart — the same way every other setting behaves under decision-9.
 * - **Sending is off the request.** Messages go on one queue, one at a time,
 *   and a refusal is tried again after a growing wait. A caller that wants the
 *   answer — the Send test email button — awaits the promise; a caller that
 *   does not simply drops it.
 */

/** How many times a message is tried before the service gives up. */
export const DEFAULT_MAIL_ATTEMPTS = 3;

/** How long to wait before attempt `n + 1`: 2s, then 8s, then 18s. */
export function defaultMailBackoffMs(attempt: number): number {
  return attempt * attempt * 2000;
}

/** Where the service says what it did and what it could not do. `console` will do. */
export interface MailLogger {
  /** One line per message that went, and one per message that was not sent. */
  info(message: string): void;
  /** One line per attempt that failed, and one when the service gives up. */
  warn(message: string): void;
}

/** Anything that can be addressed: an address, or one with a name on it. */
export type MailRecipient = string | MailAddress;

/** What {@link MailService.send} takes: a template, and who to send it to. */
export interface TemplateMail {
  /** Who it goes to. One address or several. */
  to: MailRecipient | readonly MailRecipient[];
  /** Which message under `mail/` in the theme to render. */
  template: string;
  /**
   * The subject, when the caller would rather decide it than let the
   * template's `.subject.njk` do it.
   */
  subject?: string | undefined;
  /** What the template renders against, on top of `site` and `baseUrl`. */
  data?: Record<string, unknown> | undefined;
  /** Where a reply goes, when it is not the site's own reply-to setting. */
  replyTo?: MailRecipient | undefined;
}

/** What {@link MailService.sendRaw} takes: a message the caller built itself. */
export interface RawMail {
  /** Who it goes to. */
  to: MailRecipient | readonly MailRecipient[];
  /** The subject line. */
  subject: string;
  /** The plain text body. */
  text: string;
  /** The HTML twin, when there is one. */
  html?: string | undefined;
  /** Where a reply goes, when it is not the site's own reply-to setting. */
  replyTo?: MailRecipient | undefined;
}

/** What became of one message. Never throws; this is the whole answer. */
export interface MailResult {
  /**
   * Whether the caller may carry on. True for a message that went **and** for
   * one a site with no mail configuration never sent: neither is a failure of
   * the thing that asked for it.
   */
  readonly ok: boolean;
  /** Whether it was never sent because the site sends no mail. */
  readonly skipped: boolean;
  /** Which provider carried it, or `none`. */
  readonly provider: MailProviderName;
  /** Who it was addressed to. */
  readonly to: readonly string[];
  /** The subject that was sent, after the template and the caller had their say. */
  readonly subject: string;
  /** How many attempts it took, or 0 when nothing was attempted. */
  readonly attempts: number;
  /** The id the provider gave it, which is what finds it in their logs. */
  readonly messageId?: string | undefined;
  /** Why it did not go, when it did not. */
  readonly error?: string | undefined;
}

/** What {@link createMailService} needs. */
export interface CreateMailServiceOptions {
  /**
   * Config after defaults: the base URL, the content directory the settings
   * are read from, the data directory the credentials are in, the theme
   * directory the messages are looked up in, and whether templates are cached.
   */
  config: Pick<ResolvedConfig, 'baseUrl' | 'contentDir' | 'dataDir' | 'themesDir' | 'watch'>;
  /**
   * A provider named by the site, which wins outright over the settings and
   * `data/mail.json` — the way a `commentChecker` in the config wins over the
   * Akismet key. {@link createMemoryMailProvider} is what a test names here.
   */
  provider?: MailProvider | undefined;
  /** The messages. Defaults to the theme's, packaged theme behind it. */
  templates?: MailTemplates | undefined;
  /**
   * Which theme the messages come from, when this service builds its own
   * templates. Defaults to one over the config's themes directory and the
   * site's `theme` setting; `createCms` hands in the one the pages use, so a
   * site has a single answer to which theme it is running.
   */
  themes?: ThemeSource | undefined;
  /** Where attempts are logged. Defaults to `console`. */
  logger?: MailLogger | undefined;
  /** How many times one message is tried. Defaults to {@link DEFAULT_MAIL_ATTEMPTS}. */
  attempts?: number | undefined;
  /**
   * How long to wait before attempt `n + 1`. Defaults to
   * {@link defaultMailBackoffMs}; a test hands in something instant.
   */
  backoffMs?: ((attempt: number) => number) | undefined;
  /** How the wait is taken. Defaults to a timer; a test hands in a stub. */
  wait?: ((ms: number) => Promise<void>) | undefined;
}

/** Sends a site's email, or explains in the log why it did not. */
export interface MailService {
  /**
   * Whether anything would actually be sent: a provider named in the config,
   * or a provider chosen in the settings whose credential is in
   * `data/mail.json`. Read per call, so it changes the moment the file does.
   */
  configured(): boolean;
  /** Which provider would carry the next message, or `none`. */
  providerName(): MailProviderName;
  /** The From line the next message would carry. */
  from(): MailAddress;
  /**
   * Render a message from the theme and queue it.
   *
   * The promise resolves when the message has been sent, or given up on, or
   * skipped — a caller that wants to report the outcome awaits it, and one
   * that does not drops it with `void`. It never rejects: a failure is a
   * result with `ok: false` and the provider's own words in `error`.
   */
  send(message: TemplateMail): Promise<MailResult>;
  /** The same, for a caller that built the message itself and wants no template. */
  sendRaw(message: RawMail): Promise<MailResult>;
  /** Resolve once every queued message has finished, however it finished. */
  settled(): Promise<void>;
}

/** Build the mail service for one site. */
export function createMailService(options: CreateMailServiceOptions): MailService {
  const { config } = options;
  const logger = options.logger ?? console;
  const attempts = Math.max(1, options.attempts ?? DEFAULT_MAIL_ATTEMPTS);
  const backoffMs = options.backoffMs ?? defaultMailBackoffMs;
  const wait =
    options.wait ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

  const templates =
    options.templates ??
    createMailTemplates({
      themes:
        options.themes ??
        createThemeSource({
          themesDir: config.themesDir,
          chosen: () => readSiteSettings(config.contentDir).theme,
        }),
      baseUrl: config.baseUrl,
      noCache: config.watch,
    });

  // Messages are chained rather than sent at once, and the chain never
  // rejects: one provider that hangs delays the next message and nothing else.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.then(ignore, ignore);
    return result;
  }

  /**
   * The provider that would carry the next message, built from the file as it
   * reads now, or `undefined` when the site sends no mail.
   *
   * Built per send rather than held: it is how a credential saved on the
   * settings screen reaches the very next message, and how one removed stops
   * the one after it.
   */
  function provider(): MailProvider | undefined {
    if (options.provider !== undefined) return options.provider;

    const settings = readSiteSettings(config.contentDir);
    const credentials = readMailCredentials(config.dataDir);

    if (settings.mailProvider === 'brevo' && credentials.brevo !== undefined) {
      return createBrevoProvider({ apiKey: credentials.brevo.apiKey });
    }
    if (settings.mailProvider === 'smtp' && credentials.smtp !== undefined) {
      return createSmtpProvider(credentials.smtp);
    }
    return undefined;
  }

  /** The From line, as the settings say it now. */
  function from(settings: SiteSettings): MailAddress {
    const address =
      settings.mailFromAddress === '' ? fallbackAddress(config.baseUrl) : settings.mailFromAddress;
    const name = settings.mailFromName === '' ? settings.title : settings.mailFromName;
    return name === '' ? { address } : { name, address };
  }

  /** Try one message until it goes or the site runs out of patience. */
  async function deliver(carrier: MailProvider, message: OutgoingMail): Promise<MailResult> {
    const to = message.to.map((recipient) => recipient.address);
    const where = `"${message.subject}" to ${to.join(', ')} via ${carrier.name}`;
    let lastError = '';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const which = `attempt ${String(attempt)} of ${String(attempts)}`;
      try {
        const delivery = await carrier.deliver(message);
        logger.info(`Sent ${where} (${which}): ${delivery.messageId ?? 'no message id'}`);
        return {
          ok: true,
          skipped: false,
          provider: carrier.name,
          to,
          subject: message.subject,
          attempts: attempt,
          ...(delivery.messageId === undefined ? {} : { messageId: delivery.messageId }),
        };
      } catch (thrown) {
        lastError = messageOf(thrown);
        logger.warn(`Could not send ${where} (${which}): ${lastError}`);
        if (attempt < attempts) await wait(backoffMs(attempt));
      }
    }

    logger.warn(`Gave up sending ${where} after ${String(attempts)} attempts: ${lastError}`);
    return {
      ok: false,
      skipped: false,
      provider: carrier.name,
      to,
      subject: message.subject,
      attempts,
      error: lastError,
    };
  }

  /**
   * The one path both `send` and `sendRaw` take: settle the provider, build
   * the message, and queue it.
   *
   * `build` runs inside the queue rather than before it, so a template read is
   * one of the things that is serialised — and so a template edited while a
   * message is waiting is the one that goes out.
   */
  function queue(
    to: MailRecipient | readonly MailRecipient[],
    replyTo: MailRecipient | undefined,
    build: (settings: SiteSettings) => { subject: string; text: string; html?: string | undefined },
  ): Promise<MailResult> {
    const recipients = addressesOf(to);
    const carrier = provider();

    if (carrier === undefined) {
      // Not a failure. A site with no mail account is a site whose password
      // resets are done from the shell and whose moderation happens on the
      // Comments screen, and neither of those should throw here.
      logger.info(
        `No mail is configured, so a message to ${recipients
          .map((recipient) => recipient.address)
          .join(', ')} was not sent.`,
      );
      return Promise.resolve({
        ok: true,
        skipped: true,
        provider: 'none',
        to: recipients.map((recipient) => recipient.address),
        subject: '',
        attempts: 0,
      });
    }

    return enqueue(async () => {
      const settings = readSiteSettings(config.contentDir);

      let body: { subject: string; text: string; html?: string | undefined };
      try {
        body = build(settings);
      } catch (thrown) {
        // A template that will not render is a mistake in this site's own
        // files, not a provider that refused: there is nothing to retry, and
        // the message names the file to fix.
        const error = messageOf(thrown);
        logger.warn(
          `Could not build a message for ${recipients.map((r) => r.address).join(', ')}: ${error}`,
        );
        return {
          ok: false,
          skipped: false,
          provider: carrier.name,
          to: recipients.map((recipient) => recipient.address),
          subject: '',
          attempts: 0,
          error,
        };
      }

      const answerTo = replyTo === undefined ? replyToIn(settings) : addressOf(replyTo);

      return await deliver(carrier, {
        from: from(settings),
        to: recipients,
        ...(answerTo === undefined ? {} : { replyTo: answerTo }),
        subject: body.subject,
        text: body.text,
        ...(body.html === undefined ? {} : { html: body.html }),
      });
    });
  }

  return {
    configured() {
      return provider() !== undefined;
    },

    providerName() {
      return provider()?.name ?? 'none';
    },

    from() {
      return from(readSiteSettings(config.contentDir));
    },

    send(message) {
      return queue(message.to, message.replyTo, (settings) => {
        const rendered = templates.render(message.template, {
          site: settings,
          baseUrl: config.baseUrl,
          ...message.data,
        });
        return {
          // The caller's own subject wins: a reset link's subject is the
          // feature's to decide, and a template that offers one is a default.
          subject: message.subject ?? (rendered.subject === '' ? '(no subject)' : rendered.subject),
          text: rendered.text,
          ...(rendered.html === undefined ? {} : { html: rendered.html }),
        };
      });
    },

    sendRaw(message) {
      return queue(message.to, message.replyTo, () => ({
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      }));
    },

    async settled() {
      await chain;
    },
  };
}

/** Where a reply goes, as the settings say it, or nowhere in particular. */
function replyToIn(settings: SiteSettings): MailAddress | undefined {
  return settings.mailReplyTo === '' ? undefined : { address: settings.mailReplyTo };
}

/**
 * The address a site sends as when its settings name none: `no-reply@` at the
 * base URL's host.
 *
 * A guess, and a documented one — a provider only accepts a sender it has
 * verified, so a site that sends anything real fills the field in. It exists
 * so that a site which has pasted a key but not yet typed an address gets a
 * message it can read the refusal from, rather than silence.
 */
function fallbackAddress(baseUrl: string): string {
  try {
    return `no-reply@${new URL(baseUrl).hostname}`;
  } catch {
    return 'no-reply@localhost';
  }
}

/** One recipient as an address. */
function addressOf(recipient: MailRecipient): MailAddress {
  return typeof recipient === 'string' ? { address: recipient } : recipient;
}

/** However the caller spelled the recipients, as a list of addresses. */
function addressesOf(to: MailRecipient | readonly MailRecipient[]): MailAddress[] {
  if (typeof to === 'string') return [{ address: to }];
  if (Array.isArray(to)) return (to as readonly MailRecipient[]).map(addressOf);
  return [addressOf(to as MailRecipient)];
}

/** What a thrown value has to say for itself. */
function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function ignore(): void {
  // A failed send is already logged; the queue carries on regardless.
}
