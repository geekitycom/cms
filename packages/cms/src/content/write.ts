import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { readAltTexts, undescribedImages, undescribedPhotos } from './alt-text.ts';
import type { UndescribedImage } from './alt-text.ts';
import { absoluteUrl } from '../util/url.ts';
import { authorNames, userForAuthor } from './authors.ts';
import type { AuthorUser } from './authors.ts';
import { CITATION_PROPERTIES, citesAnImage, shownInFull } from './citation.ts';
import type { CitationProperty, CitedPage } from './citation.ts';
import type { Document, DocumentContent } from './document.ts';
import { CITATION_FIELDS, extraFromForm, formInReplyTo, splitTags } from './document-form.ts';
import type { EditorForm, ResolvedMedia } from './document-form.ts';
import type { DocumentKind } from './document-kind.ts';
import { enclosureOf, isUploadUrl, isWebUrl } from './enclosure.ts';
import { resolveEnclosure } from './enclosure-form.ts';
import { resolveEvent } from './event-form.ts';
import type { EditorField, Refusal } from './form-error.ts';
import { keptProperties } from './kept-properties.ts';
import type { KeptProperties } from './kept-properties.ts';
import { LANGUAGE_TAG_PATTERN } from './language.ts';
import type { PostLocation } from './location.ts';
import { resolveLocation } from './location-form.ts';
import { postLocations } from './locations.ts';
import { renderMarkdown } from './markdown.ts';
import { parseDocument } from './parser.ts';
import type { Photo } from './photo.ts';
import { isLibraryImage, resolvePhotos } from './photo-form.ts';
import { PINNED_POST_LIMIT, pinnedAt } from './pinned.ts';
import { discoverPostType, replyTarget } from './post-type.ts';
import type { PostType } from './post-type.ts';
import { resolveRead } from './read-form.ts';
import { RSVP_VALUES, rsvpValue } from './rsvp.ts';
import { contentFilePath, freeSlug, saveDocument } from './save.ts';
import { htmlToText } from './search.ts';
import { isServed } from './served.ts';
import { defaultPermalink, slugify } from './slug.ts';
import { DuplicatePermalinkError, isTrashedPath, TRASH_DIRECTORY } from './store.ts';
import type {
  ArchiveReader,
  DocumentLookup,
  IndexClock,
  IndexWriter,
  TaxonomyReader,
} from './store.ts';
import type { DocumentChange } from './sync.ts';
import type { SyndicationTarget } from './syndicate-to.ts';
import { respellTags } from './tags.ts';
import type { Respelling } from './tags.ts';
import { calendarDayIn, toUtcInstant } from './time.ts';

export interface SiteRecords {
  readonly users: () => readonly AuthorUser[];
  readonly syndicationTargets: () => readonly SyndicationTarget[];
  readonly hasComments: (slug: string) => boolean;
}

export interface WriteConfig {
  readonly contentDir: string;
  readonly dataDir: string;
  readonly baseUrl: string;
  readonly requireAltText: boolean;
}

/** What a write needs from the site, as plain values rather than a request. */
export interface DocumentSite extends SiteRecords {
  readonly store: DocumentLookup & ArchiveReader & TaxonomyReader & IndexWriter & IndexClock;
  readonly config: WriteConfig;
  readonly announce: (change: DocumentChange) => Promise<void>;
  /** The username of whoever is writing: the author a new document starts on. */
  readonly writer: string | undefined;
  readonly timezone: string;
  readonly citedContext: (target: string) => Promise<CitedPage | undefined>;
  readonly storedContext: (target: string) => CitedPage | undefined;
  readonly learnHandles: (body: string) => Promise<void>;
}

/** What {@link writeDocument} is asked to write. */
export interface DocumentWrite {
  readonly kind: DocumentKind;
  /** The document being replaced, or `undefined` when one is being made. */
  readonly document: Document | undefined;
  readonly form: EditorForm;
  /** Whether it is saved as a draft, which the editor's buttons decide. */
  readonly draft: boolean;
  readonly keptProperties?: KeptProperties | undefined;
}

/** What came of a {@link writeDocument}. */
export type WriteOutcome =
  | {
      readonly outcome: 'saved';
      readonly saved: Document;
      /** Images published without alt text, which the editor warns about. */
      readonly undescribed: readonly UndescribedImage[];
      /** Tags written in the site's spelling rather than as typed, which the editor says. */
      readonly respelled: readonly Respelling[];
    }
  | ({ readonly outcome: 'refused' } & Refusal)
  | {
      readonly outcome: 'conflict';
      /** The document as the form loaded it, which only an edit has. */
      readonly document: Document;
      /** The recording and the photos the form resolved to. */
      readonly media: ResolvedMedia;
      readonly conflict: Conflict;
    };

type Refused = { readonly outcome: 'refused' } & Refusal;

function refused(message: string, field?: EditorField): Refused {
  return { outcome: 'refused', message, field };
}

/**
 * The write path behind the editor and Micropub (TASK-164): one form in, one
 * file out, announced to every subscriber.
 *
 * The order matters: the form is checked before anything is touched, the
 * on-disk file is re-hashed and compared with the hash the form loaded with
 * (doc-1's conflict rule), and only then is a file written. A write that is
 * refused leaves the content directory exactly as it was.
 */
export async function writeDocument(
  site: DocumentSite,
  write: DocumentWrite,
): Promise<WriteOutcome> {
  const checked = await checkForm(site, write);
  if ('outcome' in checked) return checked;
  const identity = await resolveIdentity(site, write, checked);
  return await persist(site, write, checked, identity);
}

interface CheckedForm {
  readonly media: ResolvedMedia;
  readonly location: PostLocation | undefined;
  readonly undescribed: readonly UndescribedImage[];
  readonly timezone: string;
  readonly date: string | undefined;
}

async function checkForm(site: DocumentSite, write: DocumentWrite): Promise<CheckedForm | Refused> {
  const { store, config, writer } = site;
  const { kind, document, form, draft } = write;
  const contentDir = config.contentDir;

  // A post is a reply only when the target is a URL (Post Type Discovery), so
  // anything else would be saved as a reply that is not one.
  if (kind.replies && form.inReplyTo !== '' && replyTarget(form) === undefined) {
    return refused(
      'In reply to has to be a web address, like https://example.com/a-post/.',
      'editor-in-reply-to',
    );
  }

  if (form.rsvp !== '') {
    if (rsvpValue(form.rsvp) === undefined) {
      return refused(`RSVP is ${RSVP_VALUES.join(', ')}, not ${form.rsvp}.`, 'editor-rsvp');
    }
    if (form.inReplyTo === '') {
      return refused(
        'An RSVP answers an event. Put the event’s address in In reply to.',
        'editor-in-reply-to',
      );
    }
  }

  for (const property of CITATION_PROPERTIES) {
    const cited = form[CITATION_FIELDS[property]];
    if (cited !== '' && !isWebUrl(cited)) {
      return refused(
        `${CITATION_LABELS[property]} has to be a web address, like https://example.com/a-post/.`,
        `editor-${property}`,
      );
    }
  }
  const read = resolveRead(form.readStatus, form.readOf);
  if ('error' in read) return refused(read.error, read.field);
  const cover = read.read?.of.photo?.url;
  if (cover !== undefined && isUploadUrl(cover) && !isLibraryImage(cover, contentDir)) {
    return refused(
      `The cover ${cover} is not an image in the media library.`,
      'editor-read-of-photo',
    );
  }
  if (read.read !== undefined && form.description !== '') {
    return refused(
      'A read is described by what it says, so it keeps no Description. Empty Description to save it.',
      'editor-description',
    );
  }

  if (form.lang !== '' && !LANGUAGE_TAG_PATTERN.test(form.lang)) {
    return refused('That is not a language tag, such as en, fr or pt-BR.', 'editor-lang');
  }

  const recording = resolveEnclosure(
    form.enclosure,
    document === undefined ? undefined : enclosureOf(document.extra),
    contentDir,
  );
  if ('error' in recording) return refused(recording.error, recording.field);
  const photos = resolvePhotos(form.photos, contentDir);
  if ('error' in photos) return refused(photos.error, photos.field);
  const media: ResolvedMedia = { recording: recording.enclosure, photos: photos.photos };

  const located = resolveLocation(form.location);
  if ('error' in located) return refused(located.error, located.field);
  const { location } = located;

  // TASK-207: a pin is new when the file does not carry one yet, and only a
  // new one can take an author past Mastodon's limit.
  if (form.pinned && (document === undefined || pinnedAt(document) === undefined)) {
    const users = site.users();
    const author = userForAuthor(users, chosenAuthor(users, form.author, document, writer) ?? '');
    const names = author === undefined ? [] : authorNames(users, author);
    if (store.listPinnedByAuthor(names).length >= PINNED_POST_LIMIT) {
      return refused(
        `You can pin up to ${String(PINNED_POST_LIMIT)} posts. Unpin one first.`,
        'editor-pinned',
      );
    }
  }

  // TASK-141: an image nobody described is a problem to fix before readers
  // meet it. A draft is not checked, since nobody meets a draft.
  // A photo counts too, unless the media library describes it (TASK-166).
  const library = readAltTexts(contentDir);
  const undescribed = draft
    ? []
    : [
        ...undescribedPhotos(media.photos, library),
        ...undescribedImages(renderMarkdown(form.body), library),
      ];
  if (undescribed.length > 0 && config.requireAltText) {
    return refused(`This site publishes no image without alt text. ${missingAltText(undescribed)}`);
  }
  if (!draft && config.requireAltText && (await citesUndescribedImage(site, document, form))) {
    return refused(
      'This site publishes no image without alt text. Describe the image this post reposts in its alt text field.',
      'editor-cited-alt',
    );
  }

  const { timezone } = site;

  const event = resolveEvent(form.event, timezone);
  if ('error' in event) return refused(event.error, event.field);
  if (event.event !== undefined && form.title === '') {
    return refused('An event needs a name. Put it in Title.', 'editor-title');
  }

  // decision-11: what the file gets is a UTC instant, and an offset-less field
  // is the site's own wall clock rather than the server's.
  const typed = kind.dated ? (form.date === '' ? store.now().toISOString() : form.date) : undefined;
  if (typed !== undefined && !/^\d{4}-\d{2}-\d{2}/.test(typed)) {
    return refused(
      'A date has to start with a year, a month and a day, like 2026-03-04.',
      'editor-date',
    );
  }
  const date = typed === undefined ? undefined : toUtcInstant(typed, timezone);
  if (typed !== undefined && date === undefined) {
    return refused('That date is not one anybody can read. Try 2026-03-04 09:00.', 'editor-date');
  }

  return { media, location, undescribed, timezone, date };
}

interface Identity {
  readonly target: string;
  readonly permalink: string;
  readonly promised: Document | undefined;
}

async function resolveIdentity(
  site: DocumentSite,
  write: DocumentWrite,
  checked: CheckedForm,
): Promise<Identity> {
  const { store, config } = site;
  const { kind, document, form } = write;
  const { date, timezone } = checked;
  const contentDir = config.contentDir;

  const slug =
    slugify(form.slug) ||
    slugify(form.title) ||
    (document?.slug ?? '') ||
    noteSlug(form.body) ||
    slugify(form.readOf.name) ||
    (await typeSlug(kind, form, checked.media.photos, site.citedContext)) ||
    'untitled';
  const trashed = document !== undefined && isTrashedPath(document.path);
  // The calendar day the document is filed under: the site zone's day at its
  // date for a new one, and the day already in the filename for one whose date
  // has not moved, so a zone changed later never moves a URL that exists.
  const filed = filedDay({ date, document, timezone });

  // A new document gets out of the way of anything that already holds its
  // name; an existing one keeps the slug it was given.
  const finalSlug =
    document === undefined
      ? await freeSlug({ contentDir, store, type: kind.type, slug, date: filed })
      : slug;

  // A URL somebody has been shown only moves when the author asks it to, by
  // editing the slug or the permalink: correcting a date refiles the file and
  // leaves the URL where it was. An empty permalink field is a form that
  // carried none, not a request to move.
  const promised = promisedDocument(site, document);
  const submitted = normalizePermalink(form.permalink);
  const asked =
    promised !== undefined &&
    (finalSlug !== promised.slug || (submitted !== undefined && submitted !== promised.permalink));

  const permalink =
    promised !== undefined && !asked
      ? promised.permalink
      : resolvePermalink({
          kind,
          form,
          slug: finalSlug,
          date: filed,
          document,
          timezone,
        });
  const target = documentPath({ kind, slug: finalSlug, date: filed, trashed });

  return { target, permalink, promised };
}

async function persist(
  site: DocumentSite,
  write: DocumentWrite,
  checked: CheckedForm,
  identity: Identity,
): Promise<WriteOutcome> {
  const { store, config, writer } = site;
  const { kind, document, form, draft } = write;
  const { media, date, timezone } = checked;
  const { target, permalink, promised } = identity;
  const contentDir = config.contentDir;

  if (document !== undefined) {
    const conflict = await conflictWith(contentDir, document, form.hash);
    if (conflict !== undefined) {
      return { outcome: 'conflict', document, media, conflict };
    }
  }

  if (target !== document?.path && store.getByPath(target) !== undefined) {
    return refused(`Another ${kind.singular} already lives in ${target}.`, 'editor-slug');
  }

  const tags = respellTags(kind.tagged ? splitTags(form.tags) : [], (tag) =>
    store.tagSpelling(tag, { excluding: document?.path }),
  );

  const content: DocumentContent = {
    title: form.title,
    ...(date === undefined ? {} : { date }),
    updated: store.now().toISOString(),
    permalink,
    ...optional('redirectFrom', formerPermalinks(document, promised, permalink)),
    tags: tags.tags,
    categories: kind.categorised ? splitTags(form.categories) : [],
    draft,
    ...(form.description === '' ? {} : { description: form.description }),
    ...optional('author', chosenAuthor(site.users(), form.author, document, writer)),
    ...optional('inReplyTo', formInReplyTo(kind, form, document)),
    ...optional('activitypub', keptIdentity(kind, document, promised, permalink, config.baseUrl)),
    extra: keptGuid(
      kind,
      extraFromForm(kind, document, form, store.now(), media, site.syndicationTargets(), timezone),
      promised,
      permalink,
      config.baseUrl,
    ),
    body: form.body,
  };

  await site.learnHandles(content.body);

  const saved = await replaceFile(site, { previous: document, target, content, timezone });
  if ('outcome' in saved) return saved;

  const moved = document !== undefined && document.permalink !== saved.permalink;
  if (kind.located) {
    const locations = postLocations(config.dataDir);
    if (moved) await locations.move(document.permalink, saved.permalink);
    await locations.set(saved.permalink, checked.location);
  }
  const kept = keptProperties(config.dataDir);
  if (moved) await kept.move(document.permalink, saved.permalink);
  if (write.keptProperties !== undefined) {
    await kept.set(saved.permalink, write.keptProperties);
  }

  // Announced rather than left to the watcher: the index already holds what
  // was written, so the watcher's re-read is a no-op and nobody would ever
  // hear that this post was published. Awaited, so a subscriber that writes
  // back to the file — the federation stamping `activitypub` into a post it
  // has just announced — has finished before the editor is reloaded with a
  // hash that would otherwise be one save behind.
  await site.announce({
    type: document === undefined ? 'created' : 'updated',
    path: saved.path,
    previous: document,
    next: saved,
    origin: 'admin',
  });

  return { outcome: 'saved', saved, undescribed: checked.undescribed, respelled: tags.respelled };
}

async function replaceFile(
  site: DocumentSite,
  input: {
    previous: Document | undefined;
    target: string;
    content: DocumentContent;
    timezone: string;
  },
): Promise<Document | Refused> {
  const { store, config } = site;
  const { previous, target } = input;
  const contentDir = config.contentDir;

  const renamedFrom = previous !== undefined && previous.path !== target ? previous : undefined;
  const restoreRow =
    renamedFrom === undefined ? () => undefined : releasePermalink(store, renamedFrom);

  let saved: Document;
  try {
    saved = await saveDocument({
      contentDir,
      store,
      path: target,
      content: input.content,
      timezone: input.timezone,
    });
  } catch (error) {
    restoreRow();
    if (error instanceof DuplicatePermalinkError) return refused(error.message);
    throw error;
  }

  if (renamedFrom !== undefined) {
    await rm(path.join(contentDir, ...renamedFrom.path.split('/')), { force: true });
  }
  return saved;
}

export function releasePermalink(store: IndexWriter, row: Document): () => void {
  store.remove(row.path);
  return () => {
    store.upsert(row);
  };
}

async function citesUndescribedImage(
  site: DocumentSite,
  document: Document | undefined,
  form: EditorForm,
): Promise<boolean> {
  if (form.previewHidden || form.citedAlt !== '' || form.title !== '') return false;
  for (const property of CITATION_PROPERTIES) {
    const url = form[CITATION_FIELDS[property]];
    if (url === '' || !shownInFull(property, { kind: 'photo' })) continue;
    const context = document === undefined ? await site.citedContext(url) : site.storedContext(url);
    if (context !== undefined && citesAnImage(context)) return true;
  }
  return false;
}

/** What a save says about the images it found with no alt text, naming each. */
export function missingAltText(images: readonly UndescribedImage[]): string {
  const names = images.map((image) => image.name).join(', ');
  const count = images.length === 1 ? '1 image has' : `${String(images.length)} images have`;
  return (
    `${count} no alt text: ${names}. Describe each one inside its ![…](…), ` +
    'or mark an upload decorative in the media library.'
  );
}

/** How many of an untitled post's first words its slug is made from. */
const NOTE_SLUG_WORDS = 5;

/** The slug a note takes from its first words, or empty when it has none. */
function noteSlug(body: string): string {
  const words = htmlToText(renderMarkdown(body)).split(' ').slice(0, NOTE_SLUG_WORDS);
  return slugify(words.join(' '));
}

const TARGET_SLUG_WORDS = 4;

const CITED_SLUGS: Partial<
  Record<
    PostType,
    { readonly prefix: string; readonly field: 'repostOf' | 'likeOf' | 'inReplyTo' | 'bookmarkOf' }
  >
> = {
  repost: { prefix: 'reposted', field: 'repostOf' },
  like: { prefix: 'liked', field: 'likeOf' },
  reply: { prefix: 'reply-to', field: 'inReplyTo' },
  rsvp: { prefix: 'rsvp', field: 'inReplyTo' },
  bookmark: { prefix: 'bookmarked', field: 'bookmarkOf' },
};

async function typeSlug(
  kind: DocumentKind,
  form: EditorForm,
  photos: readonly Photo[],
  citedContext: DocumentSite['citedContext'],
): Promise<string> {
  if (!kind.replies) return '';
  const type = discoverPostType({
    'repost-of': form.repostOf,
    'like-of': form.likeOf,
    'in-reply-to': form.inReplyTo,
    rsvp: form.rsvp,
    'bookmark-of': form.bookmarkOf,
    photo: photos.map((photo) => photo.url),
  });
  if (type === 'photo') return slugWords(photos[0]?.alt ?? '', NOTE_SLUG_WORDS) || 'photo';
  const cited = CITED_SLUGS[type];
  if (cited === undefined) return '';
  const target = form[cited.field];
  const title = slugWords((await citedContext(target))?.name ?? '', NOTE_SLUG_WORDS);
  return `${cited.prefix}-${title || targetWords(target)}`;
}

function targetWords(address: string): string {
  const url = new URL(address);
  const segments = url.pathname.split('/').map(decodedSegment).filter(holdsALetter);
  return slugWords([url.hostname.replace(/^www\./, ''), ...segments].join(' '), TARGET_SLUG_WORDS);
}

function slugWords(text: string, cap: number): string {
  return slugify(text).split('-').slice(0, cap).join('-');
}

function holdsALetter(segment: string): boolean {
  return /\p{L}/u.test(segment);
}

function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Where a document's file goes, trash included. */
function documentPath(input: {
  kind: DocumentKind;
  slug: string;
  date: string | undefined;
  trashed: boolean;
}): string {
  const relative = contentFilePath({ type: input.kind.type, slug: input.slug, date: input.date });
  return input.trashed ? `${TRASH_DIRECTORY}/${relative}` : relative;
}

/**
 * The document whose URL has already been promised, or `undefined` when
 * nothing has been promised yet.
 *
 * A published post or page is at a URL readers, search engines and other
 * sites may hold, a post that was ever announced is at one its followers hold
 * even while it is a draft, and one with comments is at the URL they were
 * left on. A draft nobody was told about, a trashed document and one whose
 * date has not arrived have been shown to nobody, and may move without
 * leaving anything behind.
 */
function promisedDocument(
  site: DocumentSite,
  document: Document | undefined,
): Document | undefined {
  if (document === undefined) return undefined;
  const announced = document.activitypub?.published !== undefined;
  const answered = site.hasComments(document.slug);
  return isServed(document, site.store.now()) || announced || answered ? document : undefined;
}

/**
 * The URLs a document is saved as having lived at (TASK-127).
 *
 * Every entry names the document itself rather than the next hop, so a chain
 * of renames collapses by construction: the URL it is leaving joins the ones
 * it already left, and all of them redirect straight to where it is now. The
 * URL it is arriving at leaves the list, because a document moved back to an
 * old URL lives there again.
 */
function formerPermalinks(
  document: Document | undefined,
  promised: Document | undefined,
  permalink: string,
): string[] | undefined {
  const left =
    promised !== undefined && promised.permalink !== permalink ? [promised.permalink] : [];
  const former = [...new Set([...(document?.redirectFrom ?? []), ...left])].filter(
    (url) => url !== permalink,
  );
  return former.length === 0 ? undefined : former;
}

/**
 * The `activitypub` block to write, which pins the object id when a promised
 * post moves (decision-20).
 *
 * decision-13 makes a post's object id its permalink, and a fediverse server
 * cannot rename an object it holds. So the URL the post is leaving is written
 * as its stored id, and the stored-id path does the rest: a peer at the old
 * URL still gets the `Article`, a browser there is sent on, and every `Update`
 * names the id the followers already have. An id the file already stores
 * stays, since it is already what they hold.
 */
function keptIdentity(
  kind: DocumentKind,
  document: Document | undefined,
  promised: Document | undefined,
  permalink: string,
  baseUrl: string,
): Document['activitypub'] {
  const block = document?.activitypub;
  if (promised === undefined || !kind.federated || promised.permalink === permalink) {
    return block;
  }
  if (block?.id !== undefined) return block;
  return { ...block, id: absoluteUrl(promised.permalink, baseUrl) };
}

/**
 * The extra front matter to write, which pins the feed guid when a promised
 * page moves.
 *
 * A page has no object id, so its feed guid is its permalink (decision-12),
 * and the `/replies/` feed a reader subscribed to is keyed by that guid. The
 * URL the page is leaving is written as its stored `guid`, as a moved post's
 * is written as its `activitypub.id`.
 */
function keptGuid(
  kind: DocumentKind,
  extra: Record<string, unknown>,
  promised: Document | undefined,
  permalink: string,
  baseUrl: string,
): Record<string, unknown> {
  if (promised === undefined || kind.federated || promised.permalink === permalink) {
    return extra;
  }
  if (extra['guid'] !== undefined) return extra;
  return { ...extra, guid: absoluteUrl(promised.permalink, baseUrl) };
}

/**
 * The permalink to write.
 *
 * A permalink is explicit in the file and the stored value is what counts
 * (doc-2), so one that was customised is never quietly rewritten. One that is
 * still the URL its old slug and date implied follows them to the new ones,
 * which is what makes renaming a slug in the editor do what it looks like it
 * does.
 */
function resolvePermalink(input: {
  kind: DocumentKind;
  form: EditorForm;
  slug: string;
  /** The calendar day the document is filed under, per {@link filedDay}. */
  date: string | undefined;
  document: Document | undefined;
  /** The site's zone, for reading the day an existing document was filed under. */
  timezone: string;
}): string {
  const fallback = defaultPermalink({
    type: input.kind.type,
    slug: input.slug,
    date: input.date,
  });

  const submitted = normalizePermalink(input.form.permalink);
  if (submitted === undefined) return fallback;

  const document = input.document;
  if (
    document !== undefined &&
    submitted === previousDefaultPermalink(input.kind, document, input.timezone)
  ) {
    return fallback;
  }
  return submitted;
}

/**
 * The permalink a document would have had if it had never been customised:
 * its own slug over the day it is filed under, which is the day in its
 * filename rather than one re-derived from a setting that may have moved.
 */
function previousDefaultPermalink(
  kind: DocumentKind,
  document: Document,
  timezone: string,
): string | undefined {
  try {
    return defaultPermalink({
      type: kind.type,
      slug: document.slug,
      date: filedDay({ date: document.date, document, timezone }),
    });
  } catch {
    return undefined;
  }
}

/**
 * The calendar day a document is filed under, which is what its filename and
 * its `/{yyyy}/{mm}/` permalink are cut from.
 *
 * For a new document it is the day the site's own zone was on at its date, so
 * a post published at half past midnight on 1 October in Berlin is filed under
 * October rather than the September UTC was still on.
 *
 * For a document whose date has not moved it is the day already in its
 * filename. That is the whole of decision-11's promise that changing the
 * timezone setting cannot move an existing URL: the instant is the same, the
 * zone is a lens, and the day this post was filed under was decided once, when
 * it was written, and is on disk where no setting can reach it.
 */
function filedDay(input: {
  date: string | undefined;
  document: Document | undefined;
  timezone: string;
}): string | undefined {
  const { document } = input;
  const date = input.date === undefined ? undefined : toUtcInstant(input.date, input.timezone);
  if (date === undefined) return undefined;

  const was =
    document?.date === undefined ? undefined : toUtcInstant(document.date, input.timezone);
  if (was === date) {
    const existing = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/.exec(document?.path ?? '')?.[1];
    if (existing !== undefined) return existing;
  }

  return calendarDayIn(date, input.timezone) ?? date;
}

/** A submitted permalink as a URL path, or `undefined` when the field is empty. */
function normalizePermalink(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const last = withLeading.split('/').at(-1) ?? '';
  // `/feed.xml` is a file and keeps its name; everything else is a directory
  // and gets the trailing slash that is canonical here.
  if (last === '' || last.includes('.')) return withLeading;
  return `${withLeading}/`;
}

/**
 * What a save writes into the front matter's `author`.
 *
 * The submitted value is resolved through the same rule the public site reads
 * it by ({@link userForAuthor}), and what is written is that user's login: so
 * a file carrying a display name from before decision-14 is rewritten as a
 * username the first time somebody saves it, which is exactly the "until it is
 * next saved" doc-2 promises.
 *
 * A value naming nobody this site has changes nothing. There is no form this
 * CMS renders that could submit one — the select only ever offers the users
 * and, for a file that names a stranger, that file's own value — so the case
 * is either a hand-made request or a user deleted between the load and the
 * save, and neither is a reason to reattribute somebody's post.
 */
function chosenAuthor(
  users: readonly AuthorUser[],
  submitted: string,
  document: Document | undefined,
  writer: string | undefined,
): string | undefined {
  const named = userForAuthor(users, submitted);
  if (named !== undefined) return named.username;
  return document?.author ?? writer;
}

/** The file as it is now, when it is not the file the form was filled in from. */
export interface Conflict {
  /** The text of the file on disk. */
  current: string;
  /** Its hash, which is what a resubmission has to carry to go through. */
  hash: string;
}

/**
 * Whether the file has moved on since the form loaded, per doc-1: files win,
 * and an edit made behind the editor's back is never silently overwritten.
 *
 * The file is read and re-parsed rather than trusted to the index, so the
 * check is right even when the watcher is off or has not caught up.
 */
async function conflictWith(
  contentDir: string,
  document: Document,
  submittedHash: string,
): Promise<Conflict | undefined> {
  const file = path.join(contentDir, ...document.path.split('/'));

  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    // The file is gone. There is nothing to lose by writing it again.
    return undefined;
  }

  let hash: string;
  try {
    hash = parseDocument(source, { path: document.path, type: document.type }).hash;
  } catch {
    // A file that will not parse cannot be compared, and overwriting it would
    // throw away whatever is wrong with it before anyone has seen it.
    hash = '';
  }

  if (hash === submittedHash) return undefined;
  return { current: source, hash };
}

/** What the editor calls each citing field, which a refusal names. */
const CITATION_LABELS: Readonly<Record<CitationProperty, string>> = {
  'repost-of': 'Repost of',
  'like-of': 'Like of',
  'bookmark-of': 'Bookmark of',
};

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
