/**
 * Look up on the review form (TASK-434): the item's ID in, the empty boxes
 * filled.
 *
 * The button is a submit button, so with no script the form posts to its own
 * editor route, which fills the boxes and draws the form again with nothing
 * saved, as Change type does. `admin/static/item-lookup.js` posts the same
 * form here instead and fills the boxes in place. Either way a box the author
 * has typed in is left as it is, and a lookup that fails changes nothing.
 *
 * The item's picture is copied into the media library rather than linked from
 * the site that has it, with its alt text written in the library and in the
 * form.
 *
 * Find (TASK-435) searches the item's source by title, and picking a match
 * posts the form here with the match's ID as `item-pick`: it is looked up in
 * place of the ID box, and fills the ID box too when that is empty. The find
 * box needs the script, so with none it is not shown.
 */

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

/** Where the editor's script posts the form for a lookup. */
export const ITEM_LOOKUP_PATH = `${ADMIN_PREFIX}/item-lookup`;

/** The editor button's name, which a form posted without a script carries. */
export const ITEM_LOOKUP_BUTTON = 'lookup-item';

/** Where the find box's script searches, with `kind` and `q`. */
export const ITEM_SEARCH_PATH = `${ADMIN_PREFIX}/item-search`;

/** The field a picked match's ID is posted in. */
const ITEM_PICK_FIELD = 'item-pick';

/** The most of a match's picture that is read for the list. */
const THUMBNAIL_MAX_BYTES = 300_000;

const PICTURE_TIMEOUT_MS = 10_000;

/** The boxes a lookup can fill beside the picture, in the order a sentence names them. */
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

/** What a lookup did to the form, and the sentence beside the button. */
export interface ItemLookupOutcome {
  readonly review: ReviewForm;
  /** The boxes it filled. */
  readonly filled: readonly (keyof ReviewForm)[];
  readonly message: string;
  readonly failed: boolean;
}

/**
 * Look the item up and fill in what the author left empty. `pick` is the ID
 * of a match picked from Find, looked up in place of the ID box.
 */
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

/** The signed-in user's email, which Crossref's polite pool asks for. */
function signedInEmail(c: Context<GeekityEnv>): string | undefined {
  const id = c.var.session?.userId;
  return id == null ? undefined : findUserById(c.var.config.dataDir, id)?.email;
}

type StoredPicture =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

/** Copy a picture into the media library under `name`, with its alt text. */
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

/**
 * The endpoint the editor's script posts the form to. It answers the boxes
 * the lookup filled, by their field names, and the sentence for beside the
 * button.
 */
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

/**
 * The find box's search: the matches for a title at the source for the item
 * kind, each with its picture read here and answered as a `data:` URI, so the
 * admin's `img-src` never names the sources and they never see who is
 * searching.
 */
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
