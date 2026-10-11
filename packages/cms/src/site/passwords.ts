import { argon2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id parameters, close to the OWASP baseline for a server that also
 * serves pages: 19 MiB of memory, two passes, one lane.
 *
 * They are written into every hash (see {@link hashPassword}), so raising them
 * later does not invalidate a password stored under the old ones.
 */
export const ARGON2_PARAMETERS = {
  /** Memory cost in KiB. */
  memory: 19456,
  /** Time cost: how many passes over that memory. */
  passes: 2,
  /** Lanes. One, because a web request has no cores to spare. */
  parallelism: 1,
  /** Length of the derived tag, in bytes. */
  tagLength: 32,
  /** Salt length, in bytes. */
  saltLength: 16,
  /**
   * The Argon2 version the encoding records. 19 is 0x13, the current one, and
   * the only one `node:crypto` computes: it has no version parameter. The
   * number is written into the hash so a reader can see which it is, and a
   * hash claiming any other version is refused rather than mis-verified.
   */
  version: 19,
} as const;

/**
 * Hash a password with argon2id, encoded as a PHC string:
 *
 * ```
 * $argon2id$v=19$m=19456,t=2,p=1$<salt>$<tag>
 * ```
 *
 * The salt and the cost parameters travel with the hash, so
 * {@link verifyPasswordHash} needs nothing but the stored string, and a later
 * change to {@link ARGON2_PARAMETERS} leaves existing passwords verifiable.
 *
 * Node 24 hashes natively, so there is no argon2 dependency to build.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(ARGON2_PARAMETERS.saltLength);
  const tag = derive(password, salt, {
    memory: ARGON2_PARAMETERS.memory,
    passes: ARGON2_PARAMETERS.passes,
    parallelism: ARGON2_PARAMETERS.parallelism,
    tagLength: ARGON2_PARAMETERS.tagLength,
  });

  const parameters = `m=${String(ARGON2_PARAMETERS.memory)},t=${String(ARGON2_PARAMETERS.passes)},p=${String(ARGON2_PARAMETERS.parallelism)}`;
  return `$argon2id$v=${String(ARGON2_PARAMETERS.version)}$${parameters}$${base64(salt)}$${base64(tag)}`;
}

/**
 * Whether `password` is the one `encoded` was made from.
 *
 * A hash this function cannot parse is a `false`, not a throw: a corrupted row
 * must fail the login rather than take the request down. The comparison is
 * constant time.
 */
export function verifyPasswordHash(encoded: string, password: string): boolean {
  const parsed = parsePhc(encoded);
  if (parsed === undefined) return false;

  const tag = derive(password, parsed.salt, {
    memory: parsed.memory,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
    tagLength: parsed.tag.length,
  });

  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag);
}

interface DeriveParameters {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}

function derive(password: string, salt: Buffer, parameters: DeriveParameters): Buffer {
  return Buffer.from(
    argon2Sync('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      memory: parameters.memory,
      passes: parameters.passes,
      parallelism: parameters.parallelism,
      tagLength: parameters.tagLength,
    }),
  );
}

interface ParsedHash extends DeriveParameters {
  salt: Buffer;
  tag: Buffer;
}

/** The PHC string back apart, or `undefined` when it is not one of ours. */
function parsePhc(encoded: string): ParsedHash | undefined {
  const parts = encoded.split('$');
  // ['', 'argon2id', 'v=19', 'm=..,t=..,p=..', salt, tag]
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id') return undefined;

  // Only 0x13 is computable here, so any other version is unverifiable rather
  // than merely unusual.
  if (parts[2] !== `v=${String(ARGON2_PARAMETERS.version)}`) return undefined;

  const costs = new Map(
    (parts[3] ?? '').split(',').map((pair) => {
      const [key, value] = pair.split('=');
      return [key ?? '', Number(value)] as const;
    }),
  );
  const memory = costs.get('m');
  const passes = costs.get('t');
  const parallelism = costs.get('p');
  if (!isPositiveInteger(memory) || !isPositiveInteger(passes) || !isPositiveInteger(parallelism)) {
    return undefined;
  }

  const salt = fromBase64(parts[4]);
  const tag = fromBase64(parts[5]);
  if (salt === undefined || tag === undefined || salt.length === 0 || tag.length === 0) {
    return undefined;
  }

  return { memory, passes, parallelism, tagLength: tag.length, salt, tag };
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

/** PHC uses unpadded standard base64. */
function base64(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '');
}

function fromBase64(value: string | undefined): Buffer | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^[A-Za-z0-9+/]+$/.test(value)) return undefined;
  return Buffer.from(value, 'base64');
}
