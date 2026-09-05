import { listUsers } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { MailService } from '../mail/service.ts';
import type { ContactMessage } from './records.ts';

/**
 * Where a contact message is sent, and what it looks like when it gets there.
 *
 * The address is decided here, when a message arrives, and is never on a
 * render context, in a template or in a form: that is the whole of the "the
 * destination address never appears in the HTML" rule, and it holds however a
 * theme is written because the theme is never told.
 *
 * A site that has not filled the setting in still has somewhere to write —
 * the first admin with an email — so a fresh install with a mail credential
 * takes messages without anybody visiting the settings screen. A site with
 * neither stores the message and says so in the log; the Messages screen is
 * the notification, exactly as it was before there was any email at all.
 */

/** The message the site's contact address gets. */
export const CONTACT_MESSAGE_TEMPLATE = 'contact-message';

/** What {@link contactRecipient} reads. */
export interface ContactRecipientOptions {
  /** Where `site.json` is, for the `contactEmail` setting. */
  contentDir: string;
  /** Where `users.json` is, for the fallback. */
  dataDir: string;
}

/**
 * Who a contact message goes to, or `undefined` when nobody has an address.
 *
 * The setting first, because a site that typed one meant it. Otherwise the
 * first admin with an email, by username, which is what `listUsers` orders by:
 * a stable answer rather than whichever account happens to come back first.
 */
export function contactRecipient(options: ContactRecipientOptions): string | undefined {
  const setting = readSiteSettings(options.contentDir).contactEmail.trim();
  if (setting !== '') return setting;

  for (const user of listUsers(options.dataDir)) {
    if (user.email !== undefined && user.email !== '') return user.email;
  }
  return undefined;
}

/** What {@link sendContactMessage} needs around it. */
export interface SendContactMessageOptions {
  /** The one door out for email. */
  mail: MailService;
  /** Where `site.json` is. */
  contentDir: string;
  /** Where `users.json` is. */
  dataDir: string;
  /** The site's public origin, so the message can link to the Messages screen. */
  baseUrl: string;
  /** The message that has just been stored. */
  message: ContactMessage;
}

/**
 * Send one stored message on to the site's contact address.
 *
 * Nothing is awaited by the request that caused it: the message is already on
 * disk, so the sender is thanked now and the mail goes out behind them. The
 * reply-to is the sender's own address, which is the point of the whole
 * feature — an answer is a Reply in whatever the site reads its mail in.
 *
 * A message a checker called spam is not sent. It is on the Messages screen
 * where somebody can look at it and decide, and mailing every spam submission
 * to the site owner would make the feature its own flood.
 */
export function sendContactMessage(options: SendContactMessageOptions): void {
  const { message } = options;
  if (message.status !== 'received') return;

  const to = contactRecipient(options);
  if (to === undefined) return;

  void options.mail.send({
    to,
    template: CONTACT_MESSAGE_TEMPLATE,
    // The sender, so answering it is a Reply. The From line stays the site's
    // own, because that is the address a provider has verified and the one a
    // spam filter expects mail from this site to come from.
    replyTo: { name: message.from.name, address: message.from.email },
    data: {
      message: {
        id: message.id,
        subject: message.subject,
        text: message.message,
        received: message.received,
      },
      from: { name: message.from.name, email: message.from.email },
      page: {
        ...message.page,
        url: absolute(message.page.permalink, options.baseUrl),
      },
      messagesUrl: absolute('/admin/messages', options.baseUrl),
    },
  });
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}
