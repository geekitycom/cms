/** A file with its metadata taken out, and what was taken. */
export interface Stripped {
  /** The file as it should be stored. The same array when nothing changed. */
  bytes: Uint8Array;
  /** What went, in words for a report: "EXIF", "XMP", "IPTC". Empty when nothing did. */
  removed: readonly string[];
}

/** Takes one container format's metadata out of a file of that format. */
export type Stripper = (bytes: Uint8Array) => Stripped;

/**
 * A file whose structure could not be walked far enough to know where its
 * metadata is. Storing it as it came would publish whatever it carries, so
 * the caller refuses it instead.
 */
export class UnreadableMetadataError extends Error {
  constructor(format: string, problem: string) {
    super(`This ${format} could not be read: ${problem}.`);
    this.name = 'UnreadableMetadataError';
  }
}

export function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

export function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

export function startsWith(bytes: Uint8Array, prefix: Uint8Array, at = 0): boolean {
  if (at + prefix.length > bytes.length) return false;
  return prefix.every((byte, index) => bytes[at + index] === byte);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => b[index] === byte);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The labels in the order they were first met, each once. */
export function unique(labels: readonly string[]): string[] {
  return [...new Set(labels)];
}

/** The answer for a file a stripper walked: the input itself when nothing went. */
export function stripped(
  original: Uint8Array,
  parts: readonly Uint8Array[],
  removed: readonly string[],
): Stripped {
  const bytes = concat(parts);
  if (sameBytes(bytes, original)) return { bytes: original, removed: [] };
  return { bytes, removed: unique(removed) };
}
