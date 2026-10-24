import type { ConversationSite } from '../comments/conversation.ts';
import type { ArchiveReader, DocumentLookup, IndexClock, ReplyReader } from '../content/store.ts';
import type { User } from '../site/users.ts';
import type { AdminStore } from '../store/admin-store.ts';

export interface ConversationContext {
  readonly admin: AdminStore;
  readonly store: DocumentLookup & ArchiveReader & ReplyReader & IndexClock;
  readonly contentDir: string;
  readonly baseUrl: string;
  readonly users: () => readonly User[];
}

export type Reading = ConversationContext & { readonly site: ConversationSite };
