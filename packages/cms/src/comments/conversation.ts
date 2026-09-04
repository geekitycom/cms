import type { AdminStore, PostComment } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import type { Interaction } from '../web/conversation.ts';

/**
 * Native comments as the conversation sees them.
 *
 * `web/conversation.ts` deliberately knows nothing about where an answer came
 * from, so this is the translation: a stored comment becomes an
 * {@link Interaction} and joins the fediverse replies in the same thread,
 * nested by the same rule. Nothing about a comment survives the trip that a
 * theme would have to special-case — the source is on the record so a theme
 * *may*, not so it must.
 *
 * Only approved comments come through. A comment waiting for a moderator and
 * one filed as spam are both in the file and both in the index, and neither is
 * anything a reader should be shown.
 */

/** The approved comments on a post, as interactions, oldest first. */
export function commentInteractions(admin: AdminStore, document: Document): Interaction[] {
  return admin
    .listCommentsFor(document.slug)
    .filter((comment) => comment.status === 'approved')
    .map((comment) => interactionOf(comment, document));
}

/** One stored comment as the thread's own shape. */
export function interactionOf(comment: PostComment, document: Document): Interaction {
  return {
    id: comment.id,
    source: comment.source,
    kind: comment.kind,
    author: {
      name: comment.author.name,
      // A commenter has no fediverse identity: they gave a name, maybe a
      // website, and nothing that names them anywhere else.
      handle: null,
      url: comment.author.url,
      // Only a webmention has one: it came out of the source page's `h-card`,
      // and a form asks nobody for a picture.
      avatar: comment.author.avatar,
      actorId: null,
    },
    // Where it can be read. A comment written here lives here, at its own
    // anchor; a webmention lives on the page it was sent from, and its `url`
    // says so. A theme that prints `url` for a fediverse reply prints a
    // working link for either.
    url: comment.url ?? `${document.permalink}#${commentAnchor(comment.id)}`,
    content: comment.content.html,
    published: new Date(comment.submitted),
    inReplyTo: comment.inReplyTo,
    status: comment.status,
    replies: [],
  };
}

/**
 * The `id` a comment is anchored at on the page.
 *
 * Prefixed rather than bare so a comment can never collide with a heading
 * anchor the post's own Markdown produced.
 */
export function commentAnchor(id: string): string {
  return `comment-${id}`;
}
