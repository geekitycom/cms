import nodemailer from 'nodemailer';

import type { MailAddress, MailDelivery, MailProvider, OutgoingMail } from './provider.ts';

/**
 * Any SMTP server, as one {@link MailProvider}.
 *
 * The other half of the pair Brevo's API is: an account on Fastmail, a relay
 * on the same machine, Brevo's own SMTP relay, or whatever the host provides.
 * nodemailer does the protocol; everything here is the two lines of
 * translation between this package's {@link OutgoingMail} and the shape it
 * wants.
 *
 * A transport is built per message rather than kept open. Sending is rare — a
 * password reset, a comment notification — and a pooled connection to a server
 * that has since restarted is a failure that only shows up on the message that
 * mattered.
 */

/** How long a whole SMTP conversation is given. */
export const SMTP_TIMEOUT_MS = 20_000;

/** What {@link createSmtpProvider} needs. Exactly what `data/mail.json` holds. */
export interface SmtpProviderOptions {
  /** The server's hostname. */
  host: string;
  /** The port: 587 for submission with STARTTLS, 465 for implicit TLS. */
  port: number;
  /**
   * Whether the connection is TLS from the first byte, which is what port 465
   * means. On 587 this is `false` and the connection is upgraded with
   * STARTTLS when the server offers it.
   */
  secure: boolean;
  /** The username, or empty for a server that wants no credentials. */
  user?: string | undefined;
  /** The password. */
  password?: string | undefined;
  /** How long the conversation is given. */
  timeoutMs?: number | undefined;
}

/** A provider that hands each message to an SMTP server. */
export function createSmtpProvider(options: SmtpProviderOptions): MailProvider {
  return {
    name: 'smtp',

    async deliver(message: OutgoingMail): Promise<MailDelivery> {
      const timeout = options.timeoutMs ?? SMTP_TIMEOUT_MS;
      const transport = nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        ...(options.user === undefined || options.user === ''
          ? {}
          : { auth: { user: options.user, pass: options.password ?? '' } }),
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout: timeout,
      });

      try {
        const sent = await transport.sendMail({
          from: address(message.from),
          to: message.to.map(address),
          ...(message.replyTo === undefined ? {} : { replyTo: address(message.replyTo) }),
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined || message.html === '' ? {} : { html: message.html }),
        });

        return { messageId: sent.messageId };
      } finally {
        // The transport holds a socket even unpooled; closing it is what keeps
        // a long-running process from accumulating them.
        transport.close();
      }
    },
  };
}

/** One address as nodemailer wants it. */
function address(value: MailAddress): { name: string; address: string } {
  return { name: value.name ?? '', address: value.address };
}
