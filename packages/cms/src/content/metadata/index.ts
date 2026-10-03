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

export function strippable(extension: string): boolean {
  return STRIPPERS.has(extension.toLowerCase());
}

export function stripMetadata(extension: string, bytes: Uint8Array): Stripped {
  const stripper = STRIPPERS.get(extension.toLowerCase());
  return stripper === undefined ? { bytes, removed: [] } : stripper(bytes);
}
