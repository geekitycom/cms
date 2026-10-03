/**
 * Location and camera metadata, taken out of an upload before it is stored.
 *
 * One stripper per container format, each a pure function from the file's
 * bytes to the bytes to store, keyed by the upload's extension — which the
 * upload has already been held to by its signature, so the extension names
 * the format. Every stripper removes what it removes without re-encoding: the
 * pixels and the media data come out byte for byte.
 *
 * A format with no entry here passes through unchanged: audio, WebM, PDF and
 * the text formats.
 */
import { stripGif } from './gif.ts';
import { stripAvif, stripMovie } from './isobmff.ts';
import { stripJpeg } from './jpeg.ts';
import { stripPng } from './png.ts';
import type { Stripped, Stripper } from './shared.ts';
import { stripWebp } from './webp.ts';

export { UnreadableMetadataError } from './shared.ts';
export type { Stripped } from './shared.ts';

const STRIPPERS: ReadonlyMap<string, Stripper> = new Map([
  ['.jpg', stripJpeg],
  ['.jpeg', stripJpeg],
  ['.png', stripPng],
  ['.gif', stripGif],
  ['.webp', stripWebp],
  ['.avif', stripAvif],
  ['.mp4', stripMovie],
  ['.m4v', stripMovie],
]);

/** Whether files with this extension can carry metadata this module removes. */
export function strippable(extension: string): boolean {
  return STRIPPERS.has(extension.toLowerCase());
}

/**
 * The file with its location and camera metadata removed.
 *
 * @throws {UnreadableMetadataError} when the file's structure cannot be walked
 *   far enough to know where its metadata is.
 */
export function stripMetadata(extension: string, bytes: Uint8Array): Stripped {
  const stripper = STRIPPERS.get(extension.toLowerCase());
  return stripper === undefined ? { bytes, removed: [] } : stripper(bytes);
}
