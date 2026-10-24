/**
 * What {@link ConversationEvents.onConversationWrite} hears: a comment on the post of
 * that slug, or an activity naming these objects as what it is about or what
 * it answers. `approved` says this write is the one that approved the comment,
 * so it is on the page now and was not before.
 */
export type ConversationWrite =
  | {
      readonly kind: 'comment';
      readonly slug: string;
      readonly id: string;
      readonly approved: boolean;
    }
  | { readonly kind: 'activity'; readonly about: readonly string[] };

export interface ConversationEvents {
  /**
   * Hear about every comment written or forgotten and every activity logged,
   * as it happens. A rebuild of either index is not news and says
   * nothing. Returns the function that stops listening.
   */
  onConversationWrite(listener: (written: ConversationWrite) => void): () => void;
}

export function conversationEvents(): {
  events: ConversationEvents;
  written: (change: ConversationWrite) => void;
} {
  const listeners = new Set<(written: ConversationWrite) => void>();
  return {
    events: {
      onConversationWrite(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    written(change) {
      for (const listener of listeners) listener(change);
    },
  };
}
