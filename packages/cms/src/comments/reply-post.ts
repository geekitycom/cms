import { blankForm, POST_KIND, writeDocument } from '../admin/documents.ts';
import type { DocumentSite } from '../admin/documents.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { PostComment } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import { commentPageHref, visibleReply } from '../web/conversation.ts';
import type { Conversation, Interaction } from '../web/conversation.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import type { CommentNotices } from './records.ts';
import { commentKeys, commentProblems } from './submission.ts';
import type { CommentForm, CommentRefusal, CommentThrottle } from './submission.ts';
import type { CommentViewer } from './form.ts';

/**
 * What a signed-in user's reply in a thread becomes (TASK-300, decision-47): a
 * reply post, written through the same path as the editor and Micropub, so it
 * federates, sends its webmentions and fetches its reply context the way any
 * reply post does. The thread shows it inline because its `in-reply-to` names
 * what it answers there.
 */

/** What {@link submitReplyPost} needs around a submission. */
export interface SubmitReplyPostOptions {
  /** The write path behind the editor and Micropub, as this request reaches it. */
  readonly site: DocumentSite;
  /** The post whose thread the reply was written in. */
  readonly document: Document;
  /** That post's thread, which the form's `in_reply_to` names an entry of. */
  readonly conversation: Conversation;
  readonly form: CommentForm;
  readonly viewer: CommentViewer;
  readonly throttle: CommentThrottle;
  readonly address?: string | undefined;
  /** Who to tell when the reply answers a comment whose writer asked (TASK-55). */
  readonly notices?: CommentNotices | undefined;
}

/** What became of a signed-in reply. */
export type ReplyPostOutcome =
  | { readonly kind: 'saved'; readonly saved: Document }
  | { readonly kind: 'refused'; readonly refusal: CommentRefusal };

/** Take a signed-in reply from the thread and save it as a reply post. */
export async function submitReplyPost(options: SubmitReplyPostOptions): Promise<ReplyPostOutcome> {
  const { site, document, form, throttle } = options;
  const { baseUrl, contentDir } = site.config;

  const problems = commentProblems(form, true);
  if (Object.keys(problems).length > 0) return refused({ kind: 'invalid', problems });

  const keys = commentKeys(options.address);
  const wait = throttle.retryAfter(keys);
  if (wait !== undefined) return refused({ kind: 'rate-limited', retryAfter: wait });

  const answered = visibleReply(options.conversation.replies, form.inReplyTo.trim());
  const body = form.body.trim();
  const written = await writeDocument(site, {
    kind: POST_KIND,
    document: undefined,
    draft: false,
    form: {
      ...blankForm(POST_KIND, readSiteSettings(contentDir).timezone, site.store.now()),
      body,
      inReplyTo:
        answered === undefined
          ? absoluteUrl(document.permalink, baseUrl)
          : answeredAt(answered, baseUrl),
      visibility: form.listed.trim() === '' ? 'unlisted' : 'public',
    },
  });
  throttle.fail(keys);

  if (written.outcome !== 'saved') {
    const message = written.outcome === 'refused' ? written.message : 'That reply was not saved.';
    return refused({ kind: 'invalid', problems: { body: message } });
  }

  if (answered?.source === 'comment') {
    options.notices?.replyApproved(
      replyNotice(answered, written.saved, document, options.viewer, body, baseUrl),
    );
  }
  return { kind: 'saved', saved: written.saved };
}

/**
 * The URL a reply post answering this entry names: a comment written here by
 * its own page, a webmention by the page it was sent from, a fediverse reply by
 * the note's id, and a reply post by its permalink.
 */
function answeredAt(reply: Interaction, baseUrl: string): string {
  switch (reply.source) {
    case 'comment':
      return absoluteUrl(commentPageHref(reply.id), baseUrl);
    case 'activitypub':
      return reply.id;
    case 'webmention':
    case 'post':
      return absoluteUrl(reply.url ?? reply.id, baseUrl);
  }
}

/**
 * The reply post as the reply notice reads one: the commenter who asked to be
 * told about replies is told about this one, with a link to the reply post.
 */
function replyNotice(
  parent: Interaction,
  saved: Document,
  document: Document,
  viewer: CommentViewer,
  markdown: string,
  baseUrl: string,
): PostComment {
  return {
    id: saved.permalink,
    slug: document.slug,
    permalink: document.permalink,
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name: viewer.name, url: viewer.url, email: viewer.email, avatar: null },
    content: { markdown, html: saved.html },
    submitted: saved.date ?? new Date().toISOString(),
    addressHash: null,
    inReplyTo: parent.id,
    url: absoluteUrl(saved.permalink, baseUrl),
    notify: false,
  };
}

function refused(refusal: CommentRefusal): ReplyPostOutcome {
  return { kind: 'refused', refusal };
}
