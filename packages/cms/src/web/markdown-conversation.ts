import { isWithheld } from '../comments/conversation.ts';
import type {
  CommentThread,
  Conversation,
  Interaction,
  InteractionCounts,
  InteractionSource,
  ThreadReply,
} from '../comments/conversation.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import { markdownFromHtml } from '../content/html-to-markdown.ts';
import { parseHtml, textOf } from '../util/html-tree.ts';
import { escapeMarkdown } from './markdown-page.ts';

/** Somebody in a facepile, or a reply's author: their name, and where it links. */
export interface MarkdownPerson {
  readonly label: string;
  readonly url?: string | undefined;
}

/** A reply as the Markdown footer threads it, or the placeholder for a hidden one. */
export type MarkdownReply =
  | {
      readonly key: string;
      readonly source: InteractionSource;
      readonly author: MarkdownPerson;
      readonly url?: string | undefined;
      readonly published: Date;
      readonly rsvp?: { readonly value: RsvpValue; readonly label: string } | undefined;
      /** Its words as Markdown, empty when it has none. */
      readonly text: string;
      readonly replies: readonly MarkdownReply[];
    }
  | { readonly key: string; readonly withheld: true; readonly replies: readonly MarkdownReply[] };

/** {@link Conversation} with HTML turned into Markdown and each face into a link. */
export interface MarkdownConversation {
  readonly replies: readonly MarkdownReply[];
  readonly likes: readonly MarkdownPerson[];
  readonly boosts: readonly MarkdownPerson[];
  readonly mentions: readonly MarkdownPerson[];
  readonly rsvps: readonly {
    readonly value: RsvpValue;
    readonly label: string;
    readonly people: readonly MarkdownPerson[];
  }[];
  readonly counts: InteractionCounts;
}

/** A reply a reader can see, as {@link MarkdownReply} has it. */
export type MarkdownSaid = Exclude<MarkdownReply, { readonly withheld: true }>;

/** A native comment's page as `layouts/comment.njk` draws it, for the Markdown partials. */
export interface MarkdownCommentThread {
  readonly post: {
    readonly label: string;
    readonly url: string;
    readonly author?: MarkdownPerson | undefined;
    /** Its date as the front matter writes it, which the `date` filter reads. */
    readonly date?: string | undefined;
    /** Its summary as plain text, empty when it has none. */
    readonly summary: string;
  };
  /**
   * What the comment answers, from the top-level comment down to its parent,
   * each without its replies. `null` is one a reader may not see.
   */
  readonly ancestors: readonly (MarkdownSaid | null)[];
  /** The comment, with its replies threaded under it. */
  readonly comment: MarkdownSaid;
  readonly onPostUrl: string;
}

/** A comment's thread with HTML turned into Markdown; `post` is what the code knows of the post. */
export function markdownCommentThread(
  thread: CommentThread,
  post: MarkdownCommentThread['post'],
  onPostUrl: string,
): MarkdownCommentThread {
  return {
    post,
    ancestors: thread.ancestors.map((step) =>
      step === null ? null : markdownSaid({ ...step, replies: [] }),
    ),
    comment: markdownSaid(thread.comment),
    onPostUrl,
  };
}

/**
 * The conversation `conversation.njk` draws, for the Markdown partials. A
 * like or a boost links to its person and a mention to its page, as the
 * facepiles do.
 */
export function markdownConversation(conversation: Conversation): MarkdownConversation {
  const person = (item: Interaction): MarkdownPerson => ({
    label: item.author.name,
    url: item.author.url ?? item.url ?? undefined,
  });
  return {
    replies: conversation.replies.map(markdownReply),
    likes: conversation.likes.map(person),
    boosts: conversation.boosts.map(person),
    mentions: conversation.mentions.map((item) => ({
      label: item.author.name,
      url: item.url ?? item.author.url ?? undefined,
    })),
    rsvps: conversation.rsvps.map(({ value, label, people }) => ({
      value,
      label,
      people: people.map(person),
    })),
    counts: conversation.counts,
  };
}

function markdownReply(reply: ThreadReply): MarkdownReply {
  if (isWithheld(reply)) {
    return { key: reply.key, withheld: true, replies: reply.replies.map(markdownReply) };
  }
  return markdownSaid(reply);
}

function markdownSaid(reply: Interaction): MarkdownSaid {
  return {
    key: reply.key,
    source: reply.source,
    author: { label: reply.author.name, url: reply.author.url ?? undefined },
    url: reply.url ?? undefined,
    published: reply.published,
    ...(reply.rsvp === undefined ? {} : { rsvp: reply.rsvp }),
    text: markdownText(reply.content),
    replies: reply.replies.map(markdownReply),
  };
}

function markdownText(html: string): string {
  if (html.trim() === '') return '';
  return markdownFromHtml(html) ?? escapeMarkdown(textOf(parseHtml(html)));
}
