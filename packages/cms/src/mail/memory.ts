import type { MailDelivery, MailProvider, OutgoingMail } from './provider.ts';

/**
 * A {@link MailProvider} that keeps every message instead of sending it.
 *
 * Exported from the package rather than hidden in a test directory, because
 * every feature that emails needs one: a test of a password reset, a
 * moderation notice or a contact form wants to read the message that would
 * have gone out, and stubbing `fetch` or standing up an SMTP server to do that
 * would be testing the provider all over again.
 *
 * Name it as `mailProvider` in the config and it wins outright over whatever
 * `data/mail.json` and the settings say, exactly as a `commentChecker` does:
 *
 * ```ts
 * const provider = createMemoryMailProvider();
 * const cms = createCms({ mailProvider: provider });
 * // …
 * assert.match(provider.sent[0].subject, /Reset your password/);
 * ```
 */

/** A provider that remembers, and can be told to fail. */
export interface MemoryMailProvider extends MailProvider {
  /** Every message it was given, in the order they were sent. */
  readonly sent: readonly OutgoingMail[];
  /** Forget them all. */
  clear(): void;
  /**
   * Refuse the next `count` messages, so a test can watch the service retry.
   * A message refused is not a message sent: it never joins {@link sent}.
   */
  failNext(count: number, error?: string): void;
}

/** Build one. */
export function createMemoryMailProvider(): MemoryMailProvider {
  const sent: OutgoingMail[] = [];
  let failures = 0;
  let failure = 'the memory mail provider was told to fail';

  return {
    name: 'memory',
    sent,

    clear() {
      sent.length = 0;
    },

    failNext(count, error) {
      failures = count;
      if (error !== undefined) failure = error;
    },

    deliver(message: OutgoingMail): Promise<MailDelivery> {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error(failure));
      }

      sent.push(message);
      // Ids that count from one, so a test can assert on the one it expects
      // rather than on whatever a random generator produced.
      return Promise.resolve({ messageId: `memory-${String(sent.length)}` });
    },
  };
}
