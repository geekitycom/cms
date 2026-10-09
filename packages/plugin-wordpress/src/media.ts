import type { WordPressExport, WordPressItem } from './wxr.ts';

export const WORDPRESS_UPLOADS = '/wp-content/uploads/';

const UPLOADS = '/uploads/';

export type UploadPath = string;

/**
 * A WordPress size variant's name: `photo-1024x575.png`, or `photo-scaled.png`
 * for the copy WordPress serves in place of a very large original.
 */
const VARIANT = /^(.*)-(?:\d+x\d+|scaled)(\.[^./]+)$/i;

export function variantCandidates(upload: UploadPath): UploadPath[] {
  const candidates = [upload];
  for (
    let match = VARIANT.exec(upload);
    match !== null;
    match = VARIANT.exec(candidates.at(-1) ?? '')
  ) {
    candidates.push(`${match[1] ?? ''}${match[2] ?? ''}`);
  }
  return candidates;
}

export function uploadUrl(upload: UploadPath): string {
  return `${UPLOADS}${encodeURI(upload)}`;
}

export interface WordPressMedia {
  readonly originals: ReadonlyMap<UploadPath, WordPressItem>;
  originalOf(upload: UploadPath): UploadPath;
  references(text: string): UploadPath[];
  rewrite(text: string, origin?: string): string;
}

export function wordPressMedia(
  exported: WordPressExport,
  origins: string | true | undefined,
): WordPressMedia {
  const originals = new Map<UploadPath, WordPressItem>();
  for (const item of exported.items) {
    if (item.type !== 'attachment') continue;
    const attached = attachedFile(item);
    if (attached !== undefined) originals.set(withoutScaled(attached), item);
  }

  const site = new URL(exported.site.baseSiteUrl || exported.site.link);
  const hosts = new Set(
    [exported.site.link, exported.site.baseSiteUrl, exported.site.baseBlogUrl]
      .filter((url) => URL.canParse(url))
      .map((url) => new URL(url).host.toLowerCase()),
  );
  for (const host of otherHosts(origins)) hosts.add(host);
  const pattern = uploadsPattern(`${site.pathname.replace(/\/+$/, '')}${WORDPRESS_UPLOADS}`);

  const originalOf = (upload: UploadPath): UploadPath =>
    variantCandidates(upload).find((candidate) => originals.has(candidate)) ?? upload;

  const each = (text: string, found: (upload: UploadPath, match: string) => string): string =>
    text.replace(pattern, (match, host: string | undefined, written: string) => {
      if (host !== undefined && !hosts.has(host.toLowerCase())) return match;
      const trimmed = written.replace(/[.,;:!]+$/, '');
      const upload = decoded(trimmed);
      return `${found(upload, match)}${written.slice(trimmed.length)}`;
    });

  return {
    originals,
    originalOf,
    references(text) {
      const found = new Set<UploadPath>();
      each(text, (upload, match) => {
        found.add(upload);
        return match;
      });
      return [...found];
    },
    rewrite: (text, origin = '') =>
      each(text, (upload) => `${origin}${uploadUrl(originalOf(upload))}`),
  };
}

function attachedFile(item: WordPressItem): UploadPath | undefined {
  const meta = item.meta.find((entry) => entry.key === '_wp_attached_file')?.value;
  if (meta !== undefined && meta !== '') return meta;
  const url = item.attachmentUrl;
  if (url === undefined || !URL.canParse(url)) return undefined;
  const { pathname } = new URL(url);
  const at = pathname.indexOf(WORDPRESS_UPLOADS);
  return at === -1 ? undefined : decoded(pathname.slice(at + WORDPRESS_UPLOADS.length));
}

function withoutScaled(upload: UploadPath): UploadPath {
  return upload.replace(/-scaled(\.[^./]+)$/i, '$1');
}

function otherHosts(origins: string | true | undefined): string[] {
  if (origins === undefined) return [];
  if (origins === true) {
    throw new Error('--origins needs the other origins, such as https://staging.example.com.');
  }
  return origins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
    .map((origin) => {
      const url = URL.parse(origin.includes('://') ? origin : `https://${origin}`);
      if (url === null) throw new Error(`--origins: ${origin} is not an origin.`);
      return url.host.toLowerCase();
    });
}

const CAPTURED_HOST = String.raw`(?:https?:)?//([^/\s"'<>()]+)`;
const NOT_INSIDE_A_LONGER_PATH = String.raw`(?<![\w/.:-])`;
const CAPTURED_UPLOAD_PATH = String.raw`([^\s"'<>()\[\]\\?#]+)`;

function uploadsPattern(prefix: string): RegExp {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:${CAPTURED_HOST}|${NOT_INSIDE_A_LONGER_PATH})${escapedPrefix}${CAPTURED_UPLOAD_PATH}`,
    'gi',
  );
}

export function decoded(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}
