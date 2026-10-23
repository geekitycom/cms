import {
  X509Certificate,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

import type { ResolvedConfig } from '../config.ts';
import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { GEMINI_CERTIFICATE, GEMINI_KEY, dataFolder, dataPath } from '../files/data-files.ts';
import { lockFileFor, withLockFile } from '../jobs/lock-file.ts';
import { messageOf } from '../util/errors.ts';

export type GeminiCertificateConfig = Pick<ResolvedConfig, 'dataDir' | 'geminiCert' | 'geminiKey'>;

export interface GeminiCertificate {
  /** `generated` is the pair under `data/gemini/`; `operator` is the files the config names. */
  readonly source: 'generated' | 'operator';
  readonly certFile: string;
  readonly keyFile: string;
  /** PEM. */
  readonly cert: string;
  /** PEM. */
  readonly key: string;
  readonly subject: string;
  readonly validTo: Date;
  /** Colon-separated upper-case hex, as Gemini clients show it. */
  readonly fingerprint256: string;
  /** Whether it names the host it was asked about. */
  readonly coversHost: boolean;
}

export type GeminiCertificateResult =
  | { readonly ok: true; readonly certificate: GeminiCertificate }
  | { readonly ok: false; readonly problem: string };

/**
 * Long enough that no client sees it expire. Gemini clients pin a certificate
 * on first sight (decision-60), so an expiry is a forced change of identity.
 */
const VALID_YEARS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_MODE = 0o600;
const CERT_MODE = 0o644;
const FOLDER_MODE = 0o700;

/** The certificate in effect, without making one. */
export async function readGeminiCertificate(
  config: GeminiCertificateConfig,
  host: string,
): Promise<GeminiCertificateResult> {
  const operator = operatorFiles(config);
  if (operator !== undefined) return await readOperator(operator, host);
  const files = generatedFiles(config.dataDir);
  if (readFileIfPresentSync(files.cert) === undefined) {
    return {
      ok: false,
      problem: `There is no Gemini certificate yet. One is generated at ${files.cert} when the site starts with Gemini on.`,
    };
  }
  return readGenerated(files, host);
}

/**
 * The certificate in effect, generated for `host` when the site has none.
 * A stored certificate is never replaced here, whatever host it names: a new
 * one is a new identity to every client that pinned the old one.
 */
export async function ensureGeminiCertificate(
  config: GeminiCertificateConfig,
  host: string,
  now: Date,
): Promise<GeminiCertificateResult> {
  const operator = operatorFiles(config);
  if (operator !== undefined) return await readOperator(operator, host);
  return await underLock(config.dataDir, (files) => {
    if (readFileIfPresentSync(files.cert) === undefined) writePair(config.dataDir, host, now);
    return readGenerated(files, host);
  });
}

/** Replace the generated certificate with a new one for `host`. Refused for operator files. */
export async function regenerateGeminiCertificate(
  config: GeminiCertificateConfig,
  host: string,
  now: Date,
): Promise<GeminiCertificateResult> {
  if (operatorFiles(config) !== undefined) {
    return {
      ok: false,
      problem: `The Gemini certificate is the operator's own, named by ${CERT_SETTING} and ${KEY_SETTING}. Replace those files instead.`,
    };
  }
  return await underLock(config.dataDir, (files) => {
    writePair(config.dataDir, host, now);
    return readGenerated(files, host);
  });
}

const CERT_SETTING = 'GEEKITY_GEMINI_CERT (geminiCert)';
const KEY_SETTING = 'GEEKITY_GEMINI_KEY (geminiKey)';

interface PairFiles {
  readonly cert: string;
  readonly key: string;
}

/** What the config names, which may be one file without the other. */
interface NamedFiles {
  readonly cert: string | undefined;
  readonly key: string | undefined;
}

/** `undefined` when the config names neither file, so the generated pair is in use. */
function operatorFiles(config: GeminiCertificateConfig): NamedFiles | undefined {
  const { geminiCert: cert, geminiKey: key } = config;
  return cert === undefined && key === undefined ? undefined : { cert, key };
}

function generatedFiles(dataDir: string): PairFiles {
  return { cert: dataPath(dataDir, GEMINI_CERTIFICATE), key: dataPath(dataDir, GEMINI_KEY) };
}

async function underLock(
  dataDir: string,
  task: (files: PairFiles) => GeminiCertificateResult,
): Promise<GeminiCertificateResult> {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(dataFolder(dataDir, GEMINI_KEY), { recursive: true, mode: FOLDER_MODE });
  const files = generatedFiles(dataDir);
  return await withLockFile(lockFileFor(files.cert), () => Promise.resolve(task(files)));
}

async function readOperator(files: NamedFiles, host: string): Promise<GeminiCertificateResult> {
  const { cert: certFile, key: keyFile } = files;
  if (certFile === undefined || keyFile === undefined) {
    const [set, unset] =
      certFile === undefined ? [KEY_SETTING, CERT_SETTING] : [CERT_SETTING, KEY_SETTING];
    return {
      ok: false,
      problem: `${set} is set without ${unset}. Set both, or neither to use the generated certificate.`,
    };
  }
  const texts: string[] = [];
  for (const [file, setting] of [
    [certFile, CERT_SETTING],
    [keyFile, KEY_SETTING],
  ] as const) {
    try {
      texts.push(await readFile(file, 'utf8'));
    } catch (error) {
      return {
        ok: false,
        problem: `${setting} names ${file}, which cannot be read: ${messageOf(error)}`,
      };
    }
  }
  const [cert = '', key = ''] = texts;
  return parsePair({ cert: certFile, key: keyFile }, { cert, key }, 'operator', host);
}

function readGenerated(files: PairFiles, host: string): GeminiCertificateResult {
  const cert = readFileIfPresentSync(files.cert);
  const key = readFileIfPresentSync(files.key);
  if (cert === undefined) return { ok: false, problem: `${files.cert} cannot be read.` };
  if (key === undefined) return { ok: false, problem: `${files.key} cannot be read.` };
  return parsePair(files, { cert, key }, 'generated', host);
}

function parsePair(
  files: PairFiles,
  pem: { readonly cert: string; readonly key: string },
  source: GeminiCertificate['source'],
  host: string,
): GeminiCertificateResult {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(pem.cert);
  } catch (error) {
    return { ok: false, problem: `${files.cert} is not a PEM certificate: ${messageOf(error)}` };
  }
  let matches: boolean;
  try {
    matches = x509.checkPrivateKey(createPrivateKey(pem.key));
  } catch (error) {
    return { ok: false, problem: `${files.key} is not a PEM private key: ${messageOf(error)}` };
  }
  if (!matches) {
    return { ok: false, problem: `${files.key} is not the key of the certificate ${files.cert}.` };
  }
  return {
    ok: true,
    certificate: {
      source,
      certFile: files.cert,
      keyFile: files.key,
      cert: pem.cert,
      key: pem.key,
      subject: x509.subject,
      validTo: new Date(x509.validTo),
      fingerprint256: x509.fingerprint256,
      coversHost: covers(x509, host),
    },
  };
}

function covers(x509: X509Certificate, host: string): boolean {
  const bare = unbracketed(host);
  return isIP(bare) === 0 ? x509.checkHost(bare) !== undefined : x509.checkIP(bare) !== undefined;
}

function unbracketed(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** The key first and the certificate last, so a certificate on disk always has its key. */
function writePair(dataDir: string, host: string, now: Date): void {
  const { cert, key } = selfSignedCertificate(unbracketed(host).toLowerCase(), now);
  writeFileAtomicallySync(dataPath(dataDir, GEMINI_KEY), key, { mode: KEY_MODE });
  writeFileAtomicallySync(dataPath(dataDir, GEMINI_CERTIFICATE), cert, { mode: CERT_MODE });
}

const OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  subjectAltName: '2.5.29.17',
} as const;

/**
 * An X.509 v3 certificate signed by its own ECDSA P-256 key, naming `host`
 * as its common name and its one subject alternative name. Node can sign but
 * not build a certificate, so the few DER structures it needs are written
 * here rather than taken from a dependency.
 */
export function selfSignedCertificate(host: string, now: Date): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = sequence(set(sequence(oid(OID.commonName), utf8(host))));
  const notBefore = new Date(now.getTime() - DAY_MS);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + VALID_YEARS);
  const algorithm = sequence(oid(OID.ecdsaWithSha256));
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    algorithm,
    name,
    sequence(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, sequence(sequence(oid(OID.subjectAltName), octets(sequence(altName(host)))))),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = sequence(tbs, algorithm, bitString(signature));
  return {
    cert: pem('CERTIFICATE', der),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function altName(host: string): Buffer {
  const family = isIP(host);
  if (family === 4) return tagged(0x87, Buffer.from(host.split('.').map(Number)));
  if (family === 6) return tagged(0x87, ipv6Bytes(host));
  return tagged(0x82, Buffer.from(host, 'ascii'));
}

function ipv6Bytes(address: string): Buffer {
  const [head = '', tail] = address.split('::');
  const groups = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const middle = Array.from({ length: 8 - left.length - right.length }, () => '0');
  const bytes = Buffer.alloc(16);
  [...left, ...middle, ...right].forEach((group, index) => {
    bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2);
  });
  return bytes;
}

function tagged(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function sequence(...parts: Buffer[]): Buffer {
  return tagged(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return tagged(0x31, Buffer.concat(parts));
}

function explicit(number: number, content: Buffer): Buffer {
  return tagged(0xa0 + number, content);
}

/** DER wants the fewest bytes: no leading zeros, and one zero only to keep a high bit positive. */
function integer(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const minimal = bytes.subarray(start);
  return tagged(
    0x02,
    (minimal[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), minimal]) : minimal,
  );
}

function octets(content: Buffer): Buffer {
  return tagged(0x04, content);
}

function bitString(content: Buffer): Buffer {
  return tagged(0x03, Buffer.concat([Buffer.from([0]), content]));
}

function utf8(text: string): Buffer {
  return tagged(0x0c, Buffer.from(text, 'utf8'));
}

function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const base128 = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) base128.unshift((value & 0x7f) | 0x80);
    bytes.push(...base128);
  }
  return tagged(0x06, Buffer.from(bytes));
}

/** UTCTime until 2049, GeneralizedTime from 2050, as RFC 5280 requires. */
function time(at: Date): Buffer {
  const iso = at.toISOString();
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return at.getUTCFullYear() < 2050
    ? tagged(0x17, Buffer.from(digits.slice(2), 'ascii'))
    : tagged(0x18, Buffer.from(digits, 'ascii'));
}

function pem(label: string, der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
