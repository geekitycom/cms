/**
 * The Web Crypto types Fedify's declarations reach for.
 *
 * They are `lib.dom` globals, and this package compiles without `lib.dom` — a
 * server has no `document` and should not be able to name one. Node ships the
 * same three shapes under `crypto.webcrypto`, so pointing the global names at
 * those keeps Fedify's signatures resolvable without dragging the browser
 * library in behind them.
 */
import type { webcrypto } from 'node:crypto';

declare global {
  type CryptoKey = webcrypto.CryptoKey;
  type CryptoKeyPair = webcrypto.CryptoKeyPair;
  type JsonWebKey = webcrypto.JsonWebKey;
}
