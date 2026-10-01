import { randomBytes } from 'node:crypto';

/**
 * The IndexNow key file (TASK-151): `/{key}.txt`, holding the key and nothing
 * else, which is how a search engine checks that whoever submitted a URL owns
 * the site. https://www.indexnow.org/documentation
 */

/** What IndexNow accepts as a key: 8 to 128 letters, digits and dashes. */
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/** Whether a string is a key IndexNow would accept. */
export function isIndexNowKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** A new key: 32 hex digits, the length the IndexNow documentation shows. */
export function generateIndexNowKey(): string {
  return randomBytes(16).toString('hex');
}

/** Where the key file is served, relative to the site's root. */
export function indexNowKeyPath(key: string): string {
  return `/${key}.txt`;
}

/** The key file. */
export function indexNowKeyResponse(key: string): Response {
  return new Response(key, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
