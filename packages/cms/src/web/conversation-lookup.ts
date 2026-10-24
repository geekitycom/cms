import { commentKeyAt, heldComment } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import { activityStreamsId, permalinkOfObjectId } from '../content/permalinks.ts';
import type { DocumentLookup } from '../content/store.ts';
import { isObjectIdOf, naturalObjectId, readObjectIds } from '../federation/object-ids.ts';
import { replyFrom } from '../store/inbox-replies.ts';
import type { ConversationContext, Reading } from './conversation-context.ts';

const MAXIMUM_NOTE_DEPTH = 32;

export function documentNamed(
  context: ConversationContext,
  url: string,
  depth = 0,
): Document | undefined {
  if (depth > MAXIMUM_NOTE_DEPTH) return undefined;
  let named: URL;
  try {
    named = new URL(url);
  } catch {
    return undefined;
  }

  if (named.origin === new URL(context.baseUrl).origin) {
    const key = commentKeyAt(named.pathname);
    if (key !== undefined) {
      const comment = context.admin.getComment(key);
      return comment === undefined ? undefined : context.store.getBySlug(comment.slug);
    }
    return ownDocumentNamed(context, named.href);
  }

  const comment =
    context.admin.listCommentsAt(named.href)[0] ?? heldComment(context.admin, named.href);
  if (comment !== undefined) return context.store.getBySlug(comment.slug);

  for (const activity of context.admin.listActivitiesAbout([named.href])) {
    const reply = replyFrom(activity);
    if (reply?.id !== named.href) continue;
    return documentNamed(context, reply.inReplyTo, depth + 1);
  }
  return context.store.getByStoredObjectId(named.href);
}

function ownDocumentNamed(context: ConversationContext, url: string): Document | undefined {
  const natural = naturalObjectId(url);
  if (!isObjectIdOf(readObjectIds(context.contentDir), natural, url)) return undefined;
  const permalink = permalinkOfObjectId(natural, context.baseUrl);
  const found = permalink === undefined ? undefined : context.store.getByPermalink(permalink);
  return found ?? context.store.getByStoredObjectId(natural);
}

export function threadRootOf(
  context: Reading,
  document: Document,
  seen: Set<string> = new Set(),
): Document | undefined {
  seen.add(document.path);
  if (document.inReplyTo === undefined) return undefined;
  const named = documentNamed(context, document.inReplyTo);
  if (named === undefined || seen.has(named.path)) return undefined;
  return threadRootOf(context, named, seen) ?? named;
}

export function rootOf(context: Reading, document: Document): string {
  return activityStreamsId(document, context.baseUrl, context.store.now()) ?? document.permalink;
}

export function commentedPost(
  context: Pick<ConversationContext, 'admin'> & { readonly store: DocumentLookup },
  key: string,
): Document | undefined {
  const stored = context.admin.getComment(key);
  if (stored?.source !== 'comment' || stored.status !== 'approved') return undefined;
  return context.store.getBySlug(stored.slug);
}

// A post migrated from WordPress keeps the `?p=813` object id its followers
// already hold, and no permalink spells that.
export class PostsByObjectId {
  readonly #context: Reading;
  readonly #found = new Map<string, Document | undefined>();
  #all: Map<string, Document> | undefined;

  constructor(context: Reading) {
    this.#context = context;
  }

  get(objectId: string): Document | undefined {
    if (!this.#found.has(objectId)) this.#found.set(objectId, this.#resolve(objectId));
    return this.#found.get(objectId);
  }

  #resolve(objectId: string): Document | undefined {
    const natural = naturalObjectId(objectId);
    if (!isObjectIdOf(readObjectIds(this.#context.contentDir), natural, objectId)) return undefined;
    const permalink = permalinkOfObjectId(natural, this.#context.baseUrl);
    if (permalink !== undefined) {
      const document = this.#context.store.getByPermalink(permalink);
      if (
        document !== undefined &&
        activityStreamsId(document, this.#context.baseUrl, this.#context.store.now()) === natural
      ) {
        return document;
      }
    }
    return this.#everything().get(natural);
  }

  #everything(): Map<string, Document> {
    if (this.#all === undefined) {
      this.#all = new Map();
      for (const document of this.#context.store.listPosts()) {
        const id = activityStreamsId(document, this.#context.baseUrl, this.#context.store.now());
        if (id !== undefined) this.#all.set(id, document);
      }
    }
    return this.#all;
  }
}
