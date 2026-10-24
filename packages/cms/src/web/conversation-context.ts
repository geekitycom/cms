import type { ConversationSite } from '../comments/conversation.ts';
import type { ArchiveReader, DocumentLookup, IndexClock, ReplyReader } from '../content/store.ts';
import type { User } from '../site/users.ts';
import type { AdminStore } from '../store/admin-store.ts';

/** What reading a conversation needs: both indexes and the site's origin. */
export interface ConversationContext {
  /** Where the fediverse interactions are logged. */
  readonly admin: AdminStore;
  /**
   * Where the posts are, for the site-wide reading: an answer is only worth
   * showing while the post it is about is there to read.
   */
  readonly store: DocumentLookup & ArchiveReader & ReplyReader & IndexClock;
  /**
   * Where the quote approvals are: a quote of a post is shown only while the
   * post's author vouches for it (FEP-044f, TASK-171).
   */
  readonly contentDir: string;
  /** The site's public origin, for the post's object id. */
  readonly baseUrl: string;
  /** Who may sign in, for naming the author of a reply post (TASK-300). */
  readonly users: () => readonly User[];
}

export type Reading = ConversationContext & { readonly site: ConversationSite };
