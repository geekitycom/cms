import type { Context, Hono } from 'hono';

import { writeAltText } from '../content/alt-text.ts';
import { uploadPath } from '../content/image-tags.ts';
import { isReviewKind, REVIEW_KIND_WORDS } from '../content/review.ts';
import type { ReviewKind } from '../content/review.ts';
import { REVIEW_FIELDS, submittedReviewForm } from '../content/review-form.ts';
import type { ReviewForm } from '../content/review-form.ts';
import { isSearchKind, lookUpItem, searchItems } from '../item-lookup/lookup.ts';
import type { FoundItem } from '../item-lookup/lookup.ts';
import { refusedUpload, storeUpload } from '../media/uploads.ts';
import { TMDB } from '../settings/tmdb.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { findUserById } from '../site/users.ts';
import { trimmedField } from '../util/forms.ts';
import type { GeekityEnv } from '../web/env.ts';
import { imageExtensionOf } from '../webmention/cited-picture.ts';
import { fetchPublic } from '../webmention/fetch-public.ts';
import { libraryThumbnail } from './editor-fields.ts';

export const ITEM_LOOKUP_PATH = `${ADMIN_PREFIX}/item-lookup`;

export const ITEM_LOOKUP_BUTTON = 'lookup-item';

export const ITEM_SEARCH_PATH = `${ADMIN_PREFIX}/item-search`;

const ITEM_PICK_FIELD = 'item-pick';

const THUMBNAIL_MAX_BYTES = 300_000;

const PICTURE_TIMEOUT_MS = 10_000;

const FILLED = [
  'name',
  'by',
  'year',
  'season',
  'episode',
  'url',
  'streetAddress',
  'locality',
  'region',
  'countryName',
] as const;

export interface ItemLookupOutcome {
  readonly review: ReviewForm;
  readonly filled: readonly (keyof ReviewForm)[];
  readonly message: string;
  readonly failed: boolean;
}

export async function lookUpReviewItem(
  c: Context<GeekityEnv>,
  form: ReviewForm,
  pick = '',
): Promise<ItemLookupOutcome> {
  const unchanged = (message: string): ItemLookupOutcome => ({
    review: form,
    filled: [],
    message,
    failed: true,
  });
  const id = pick === '' ? form.uid : pick;
  if (id === '') {
    return unchanged('Type an ISBN, a DOI or a link in the box first, then press Look up.');
  }

  const { config, settings } = c.var;
  const found = await lookUpItem(id, {
    lookup: config.hostLookup,
    tmdbKey: (await settings.values(TMDB)).key.trim(),
    contact: signedInEmail(c),
  });
  if (!found.ok) return unchanged(found.message);

  const { item } = found;
  const review: ReviewForm = { ...form };
  const filled: (keyof ReviewForm)[] = [];
  if (form.uid === '' && pick !== '') {
    review.uid = pick;
    filled.push('uid');
  }
  for (const key of FILLED) {
    const value = item[key];
    if (form[key] === '' && value !== undefined) {
      review[key] = value;
      filled.push(key);
    }
  }

  const kind = item.kind ?? (isReviewKind(form.kind) ? form.kind : 'other');
  const picture = REVIEW_KIND_WORDS[kind].picture;
  let pictureNote = '';
  if (form.photo === '' && item.picture !== undefined && review.name !== '') {
    const alt = form.photoAlt === '' ? `${picture} for ${review.name}` : form.photoAlt;
    const stored = await storePicture(c, item.picture, `${review.name} ${picture}`, alt);
    if (stored.ok) {
      review.photo = stored.url;
      filled.push('photo');
      if (form.photoAlt === '') {
        review.photoAlt = alt;
        filled.push('photoAlt');
      }
    } else {
      pictureNote = ` The ${picture.toLowerCase()} could not be copied: ${stored.reason}.`;
    }
  }

  return {
    review,
    filled,
    message: `${filledSentence(filled, item, kind, review.uid)}${pictureNote}`,
    failed: false,
  };
}

function filledSentence(
  filled: readonly (keyof ReviewForm)[],
  item: FoundItem,
  kind: ReviewKind,
  uid: string,
): string {
  const words: Partial<Record<keyof ReviewForm, string>> = {
    uid: uid.startsWith('isbn:') ? 'ISBN' : 'link',
    name: kind === 'place' || kind === 'other' ? 'name' : 'title',
    by: (REVIEW_KIND_WORDS[kind].by || 'maker').toLowerCase(),
    year: 'year',
    season: 'season',
    episode: 'episode',
    url: kind === 'place' ? 'website' : 'address',
    streetAddress: 'street address',
    locality: 'locality',
    region: 'region',
    countryName: 'country',
    photo: REVIEW_KIND_WORDS[kind].picture.toLowerCase(),
  };
  const named = filled.flatMap((key) => words[key] ?? []);
  if (named.length === 0) {
    return `${item.source} found it, and every box it could fill already has something in it.`;
  }
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''}`;
  return `Filled in the ${list ?? ''} from ${item.source}.`;
}

function signedInEmail(c: Context<GeekityEnv>): string | undefined {
  const id = c.var.session?.userId;
  return id == null ? undefined : findUserById(c.var.config.dataDir, id)?.email;
}

type StoredPicture =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

async function storePicture(
  c: Context<GeekityEnv>,
  url: string,
  name: string,
  alt: string,
): Promise<StoredPicture> {
  const { config } = c.var;
  const fetched = await fetchPublic(url, {
    lookup: config.hostLookup,
    signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS),
    maxBytes: config.uploadMaxBytes,
    accept: 'image/avif, image/webp, image/png, image/gif, image/jpeg;q=0.9',
    contentType: { pattern: /^\s*image\//i, name: 'an image' },
  });
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  const extension = imageExtensionOf(fetched.body);
  if (extension === undefined) return { ok: false, reason: 'it is not an image the site takes' };

  const stored = await storeUpload(
    new File([new Uint8Array(fetched.body)], `${name}${extension}`, {
      type: fetched.type.split(';')[0]?.trim() ?? '',
    }),
    config,
    { imagesOnly: true },
  );
  if (refusedUpload(stored)) return { ok: false, reason: stored.error.replace(/\.$/, '') };
  const source = uploadPath(stored.url);
  if (source !== undefined) {
    await writeAltText(config.contentDir, source, { kind: 'described', text: alt });
  }
  return { ok: true, url: stored.url };
}

export function mountItemLookup(app: Hono<GeekityEnv>): void {
  app.post(ITEM_LOOKUP_PATH, async (c) => {
    const body = await c.req.parseBody();
    const outcome = await lookUpReviewItem(
      c,
      submittedReviewForm(body),
      trimmedField(body, ITEM_PICK_FIELD),
    );
    return c.json({
      ok: !outcome.failed,
      message: outcome.message,
      fields: Object.fromEntries(
        outcome.filled.map((key) => [REVIEW_FIELDS[key], outcome.review[key]]),
      ),
      thumbnail: libraryThumbnail(c.var.config, outcome.review.photo) ?? null,
    });
  });
}

export function mountItemSearch(app: Hono<GeekityEnv>): void {
  app.get(ITEM_SEARCH_PATH, async (c) => {
    const kind = c.req.query('kind') ?? '';
    if (!isSearchKind(kind)) {
      return c.json({
        ok: false,
        message:
          'Find searches for books, movies, TV shows, albums and places. For anything else, paste a link in the box below and press Look up.',
        matches: [],
        credit: '',
      });
    }
    const { config, settings } = c.var;
    const found = await searchItems(kind, c.req.query('q') ?? '', {
      lookup: config.hostLookup,
      tmdbKey: (await settings.values(TMDB)).key.trim(),
    });
    if (!found.ok) return c.json({ ok: false, message: found.message, matches: [], credit: '' });
    const signal = AbortSignal.timeout(PICTURE_TIMEOUT_MS);
    const matches = await Promise.all(
      found.matches.map(async ({ picture, ...match }) => ({
        ...match,
        thumbnail: picture === undefined ? null : await thumbnail(c, picture, signal),
      })),
    );
    return c.json({ ok: true, message: '', matches, credit: found.credit ?? '' });
  });
}

async function thumbnail(
  c: Context<GeekityEnv>,
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  const fetched = await fetchPublic(url, {
    lookup: c.var.config.hostLookup,
    signal,
    maxBytes: THUMBNAIL_MAX_BYTES,
    accept: 'image/avif, image/webp, image/png, image/gif, image/jpeg;q=0.9',
    contentType: { pattern: /^\s*image\/(?:avif|webp|png|gif|jpeg)\b/i, name: 'an image' },
  });
  if (!fetched.ok) return null;
  const type = fetched.type.split(';')[0]?.trim().toLowerCase() ?? 'image/jpeg';
  return `data:${type};base64,${Buffer.from(fetched.body).toString('base64')}`;
}
