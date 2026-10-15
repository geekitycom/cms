import { declareDataFile } from '../files/data-files.ts';
import { isRecord } from '../util/guards.ts';
import { declareNamespace } from './declare.ts';
import { boolean, port, text } from './kinds.ts';

const IMPLICIT_TLS_PORT = 465;
const SUBMISSION_PORT = 587;

function tlsMatchesPort(namespaceAfterSet: Readonly<Record<string, unknown>>): string | undefined {
  if ((namespaceAfterSet['smtp_host'] ?? '') === '') return undefined;
  if (
    namespaceAfterSet['smtp_port'] === IMPLICIT_TLS_PORT &&
    namespaceAfterSet['smtp_secure'] !== true
  ) {
    return `mail.smtp_port ${String(IMPLICIT_TLS_PORT)} is TLS from the first byte, so smtp_secure must be true.`;
  }
  if (
    namespaceAfterSet['smtp_port'] === SUBMISSION_PORT &&
    namespaceAfterSet['smtp_secure'] === true
  ) {
    return `mail.smtp_port ${String(SUBMISSION_PORT)} upgrades with STARTTLS, so smtp_secure must be false.`;
  }
  return undefined;
}

export const MAIL_FILE = declareDataFile({
  pattern: 'mail.json',
  dataClass: { kind: 'credential' },
  lost: 'The Brevo key or SMTP login, typed in again on Settings > Email.',
});

export const MAIL = declareNamespace({
  namespace: 'mail',
  storage: { kind: 'file', under: 'data', file: MAIL_FILE },
  envPrefix: 'GEEKITY_MAIL',
  legacy: flattenNestedMailFile,
  settings: {
    brevo_api_key: {
      type: text,
      default: '',
      secret: true,
      description: "Brevo's API key, used when the mail provider is brevo.",
    },
    smtp_host: {
      type: text,
      default: '',
      description: 'The SMTP server, used when the mail provider is smtp. Empty means no server.',
    },
    smtp_port: {
      type: port,
      default: SUBMISSION_PORT,
      description: 'The SMTP port: 587 upgrades with STARTTLS, 465 is TLS from the first byte.',
      check: (_value, namespaceAfterSet) => tlsMatchesPort(namespaceAfterSet),
    },
    smtp_secure: {
      type: boolean,
      default: false,
      description: 'Whether the SMTP connection is TLS from the first byte.',
      check: (_value, namespaceAfterSet) => tlsMatchesPort(namespaceAfterSet),
    },
    smtp_user: {
      type: text,
      default: '',
      description: 'The SMTP username. Empty for a server that wants no credentials.',
    },
    smtp_password: {
      type: text,
      default: '',
      secret: true,
      description: 'The SMTP password.',
    },
  },
});

function flattenNestedMailFile(raw: unknown): unknown {
  if (!isRecord(raw) || !('brevo' in raw || 'smtp' in raw)) return raw;
  const { brevo, smtp, ...rest } = raw;
  const flat: Record<string, unknown> = { ...rest };

  const apiKey =
    isRecord(brevo) && typeof brevo['apiKey'] === 'string' ? brevo['apiKey'].trim() : '';
  if (apiKey !== '') flat['brevo_api_key'] = apiKey;

  const host = isRecord(smtp) && typeof smtp['host'] === 'string' ? smtp['host'].trim() : '';
  if (isRecord(smtp) && host !== '') {
    const secure = smtp['secure'] === true;
    const stored = Number(smtp['port']);
    flat['smtp_host'] = host;
    flat['smtp_port'] =
      Number.isInteger(stored) && stored > 0 && stored < 65536
        ? stored
        : secure
          ? IMPLICIT_TLS_PORT
          : SUBMISSION_PORT;
    flat['smtp_secure'] = secure;
    flat['smtp_user'] = typeof smtp['user'] === 'string' ? smtp['user'] : '';
    flat['smtp_password'] = typeof smtp['password'] === 'string' ? smtp['password'] : '';
  }
  return flat;
}
