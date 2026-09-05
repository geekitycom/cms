import type { MailAddress, MailDelivery, MailProvider, OutgoingMail } from './provider.ts';

/**
 * Brevo's transactional API, as one {@link MailProvider}.
 *
 * The HTTP half of sending: one POST with a JSON body and an `api-key` header,
 * no connection to keep open and no TLS negotiation to get wrong, which is why
 * it is the provider a site on a host that blocks port 587 can still use.
 *
 * Nothing here reads a file or a setting. The key is handed in, because the
 * service reads `data/mail.json` on every send and builds the provider from
 * what it found — so a key pasted into the settings screen sends the next
 * message without a restart.
 */

/** The endpoint Brevo documents for a transactional message. */
export const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * How long Brevo has to answer before the call is abandoned.
 *
 * Sending happens off the request that caused it, so this is not somebody
 * waiting on a page — but an abandoned call is a failure the service can
 * retry, and a hung one is a queue that never moves again.
 */
export const BREVO_TIMEOUT_MS = 15_000;

/** What {@link createBrevoProvider} needs. */
export interface BrevoProviderOptions {
  /** The account's API key, `xkeysib-…`. */
  apiKey: string;
  /** The HTTP client. Defaults to the global `fetch`; a test hands in its own. */
  fetch?: typeof fetch | undefined;
  /** How long Brevo has to answer. */
  timeoutMs?: number | undefined;
}

/** A provider that hands each message to Brevo. */
export function createBrevoProvider(options: BrevoProviderOptions): MailProvider {
  const call = options.fetch ?? globalThis.fetch;

  return {
    name: 'brevo',

    async deliver(message: OutgoingMail): Promise<MailDelivery> {
      const response = await call(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': options.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(bodyFor(message)),
        signal: AbortSignal.timeout(options.timeoutMs ?? BREVO_TIMEOUT_MS),
      });

      const said = await response.text();
      if (!response.ok) {
        // Brevo's own words, not a summary of them: `sender is missing` is
        // what tells somebody which field of the settings screen to fix, and
        // a status on its own never has.
        throw new Error(`Brevo answered ${String(response.status)}: ${said.trim()}`);
      }

      return { messageId: messageIdOf(said) };
    },
  };
}

/** The message as Brevo's `POST /v3/smtp/email` documents it. */
function bodyFor(message: OutgoingMail): Record<string, unknown> {
  return {
    sender: recipient(message.from),
    to: message.to.map(recipient),
    ...(message.replyTo === undefined ? {} : { replyTo: recipient(message.replyTo) }),
    subject: message.subject,
    textContent: message.text,
    // Left out rather than sent empty: a message with an empty `htmlContent`
    // is a multipart message whose HTML half is blank, which is worse in a
    // reader than a message that never claimed to have one.
    ...(message.html === undefined || message.html === '' ? {} : { htmlContent: message.html }),
  };
}

/** One address as Brevo spells it: `email`, and `name` only when there is one. */
function recipient(address: MailAddress): Record<string, string> {
  return {
    email: address.address,
    ...(address.name === undefined || address.name === '' ? {} : { name: address.name }),
  };
}

/** The `messageId` out of an accepted answer, or nothing when it carried none. */
function messageIdOf(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const id = (parsed as Record<string, unknown>)['messageId'];
  return typeof id === 'string' && id !== '' ? id : undefined;
}
