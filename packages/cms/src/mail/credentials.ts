import { rm } from 'node:fs/promises';
import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomically } from '../files/atomic.ts';

/**
 * What a site needs to prove it may send: `data/mail.json`.
 *
 * A credential, not a setting, so it lives where the Akismet key and the
 * password hashes live — under `data/` at mode `0600` — and never in
 * `content/_data/site.json`, which is public, in git and published with the
 * site. Which provider is in use, who mail is from and where a reply goes are
 * settings and are in `site.json`; the key and the SMTP password are here.
 *
 * Read on every send, like the Akismet key, so a credential pasted into the
 * settings screen sends the next message and one removed stops sending at
 * once, neither of them needing a restart.
 */

/** Where the credentials live, under `dataDir`. */
export const MAIL_CREDENTIALS_FILE = 'mail.json';

/** Brevo's half: one API key. */
export interface BrevoCredential {
  /** The account's API key, `xkeysib-…`. */
  readonly apiKey: string;
}

/** SMTP's half: the whole connection, because all of it is a credential. */
export interface SmtpCredential {
  /** The server's hostname. */
  readonly host: string;
  /** The port: 587 for submission with STARTTLS, 465 for implicit TLS. */
  readonly port: number;
  /** Whether the connection is TLS from the first byte, which is port 465. */
  readonly secure: boolean;
  /** The username. Empty for a server that wants no credentials. */
  readonly user: string;
  /** The password. */
  readonly password: string;
}

/**
 * The file's whole contents: at most one entry per provider.
 *
 * Both may be present at once, and that is deliberate — a site trying SMTP
 * after Brevo should be able to switch the `mailProvider` setting back without
 * having to paste a key in again.
 */
export interface MailCredentials {
  /** Brevo's key, when the site has one. */
  readonly brevo?: BrevoCredential | undefined;
  /** The SMTP connection, when the site has one. */
  readonly smtp?: SmtpCredential | undefined;
}

/** Where one site's credential file is. */
export function mailCredentialsPath(dataDir: string): string {
  return path.join(dataDir, MAIL_CREDENTIALS_FILE);
}

/**
 * The stored credentials, or an empty object when the site has none.
 *
 * Read tolerantly and synchronously, like every other file this CMS treats as
 * truth: a file that will not parse, or an entry missing the one field that
 * makes it usable, is a site with no mail rather than a site that will not
 * boot.
 */
export function readMailCredentials(dataDir: string): MailCredentials {
  const raw = readFileIfPresentSync(mailCredentialsPath(dataDir));
  if (raw === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null) return {};
  const file = parsed as Record<string, unknown>;

  return {
    ...(brevoIn(file['brevo']) === undefined ? {} : { brevo: brevoIn(file['brevo']) }),
    ...(smtpIn(file['smtp']) === undefined ? {} : { smtp: smtpIn(file['smtp']) }),
  };
}

/** Write the credentials, private to the account the site runs as. */
export async function writeMailCredentials(
  dataDir: string,
  credentials: MailCredentials,
): Promise<void> {
  await writeFileAtomically(
    mailCredentialsPath(dataDir),
    `${JSON.stringify(credentials, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/** Forget them, which is how a site stops sending mail entirely. */
export async function removeMailCredentials(dataDir: string): Promise<void> {
  await rm(mailCredentialsPath(dataDir), { force: true });
}

/** One Brevo entry, or nothing when it carries no key. */
function brevoIn(value: unknown): BrevoCredential | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  const apiKey = typeof entry['apiKey'] === 'string' ? entry['apiKey'].trim() : '';
  return apiKey === '' ? undefined : { apiKey };
}

/** One SMTP entry, or nothing when it names no host to connect to. */
function smtpIn(value: unknown): SmtpCredential | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as Record<string, unknown>;

  const host = typeof entry['host'] === 'string' ? entry['host'].trim() : '';
  if (host === '') return undefined;

  const port = Number(entry['port']);
  const secure = entry['secure'] === true;

  return {
    host,
    // 465 when the connection is TLS from the first byte, 587 otherwise:
    // the two submission ports, so a file that lost its port still connects.
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : secure ? 465 : 587,
    secure,
    user: typeof entry['user'] === 'string' ? entry['user'] : '',
    password: typeof entry['password'] === 'string' ? entry['password'] : '',
  };
}
