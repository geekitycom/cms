import { blankForm, POST_KIND, writeDocument } from '../admin/documents.ts';
import type { DocumentSite, WriteOutcome } from '../admin/documents.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { Document } from '../content/document.ts';
import { commentPageHref, visibleReply } from '../web/conversation.ts';
import type { Conversation, Interaction } from '../web/conversation.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { commentKeys, commentProblems } from './submission.ts';
import type { CommentForm, CommentRefusal, CommentThrottle } from './submission.ts';

/**
 * What a signed-in user's reply becomes (TASK-300, decision-47), from the
 * thread or the moderation screen (TASK-326): a reply post, written through
 * the same path as the editor and Micropub, so it federates, sends its
 * webmentions, fetches its reply context and tells the commenter it answers
 * the way any reply post does. The thread shows it inline because its
 * `in-reply-to` names what it answers there.
 */

/** What {@link writeReplyPost} writes. */
export interface ReplyPostWrite {
  /** The post whose thread it is said in. */
  readonly document: Document;
  /** What it answers in that thread, or `undefined` for the post itself. */
  readonly answered: Answered | undefined;
  readonly body: string;
  /** Public when set; Unlisted, its own page and no listing or feed, otherwise. */
  readonly listed: boolean;
}

/** Enough of a reply, a thread entry or a stored comment, to name it. */
export type Answered = Pick<Interaction, 'source' | 'id' | 'url'>;

/** Save a signed-in user's reply as a reply post. */
export async function writeReplyPost(
  site: DocumentSite,
  write: ReplyPostWrite,
): Promise<WriteOutcome> {
  const { baseUrl, contentDir } = site.config;
  return await writeDocument(site, {
    kind: POST_KIND,
    document: undefined,
    draft: false,
    form: {
      ...blankForm(POST_KIND, readSiteSettings(contentDir).timezone, site.store.now()),
      body: write.body,
      inReplyTo:
        write.answered === undefined
          ? absoluteUrl(write.document.permalink, baseUrl)
          : answeredAt(write.answered, baseUrl),
      visibility: write.listed ? 'public' : 'unlisted',
    },
  });
}

/** What {@link submitReplyPost} needs around a submission. */
export interface SubmitReplyPostOptions {
  /** The write path behind the editor and Micropub, as this request reaches it. */
  readonly site: DocumentSite;
  /** The post whose thread the reply was written in. */
  readonly document: Document;
  /** That post's thread, which the form's `in_reply_to` names an entry of. */
  readonly conversation: Conversation;
  readonly form: CommentForm;
  readonly throttle: CommentThrottle;
  readonly address?: string | undefined;
}

/** What became of a signed-in reply. */
export type ReplyPostOutcome =
  | { readonly kind: 'saved'; readonly saved: Document }
  | { readonly kind: 'refused'; readonly refusal: CommentRefusal };

/** Take a signed-in reply from the thread and save it as a reply post. */
export async function submitReplyPost(options: SubmitReplyPostOptions): Promise<ReplyPostOutcome> {
  const { form, throttle } = options;

  const problems = commentProblems(form, true);
  if (Object.keys(problems).length > 0) return refused({ kind: 'invalid', problems });

  const keys = commentKeys(options.address);
  const wait = throttle.retryAfter(keys);
  if (wait !== undefined) return refused({ kind: 'rate-limited', retryAfter: wait });

  const written = await writeReplyPost(options.site, {
    document: options.document,
    answered: visibleReply(options.conversation.replies, form.inReplyTo.trim()),
    body: form.body.trim(),
    listed: form.listed.trim() !== '',
  });
  throttle.fail(keys);

  if (written.outcome !== 'saved') {
    const message = written.outcome === 'refused' ? written.message : 'That reply was not saved.';
    return refused({ kind: 'invalid', problems: { body: message } });
  }
  return { kind: 'saved', saved: written.saved };
}

/**
 * The URL a reply post answering this entry names: a comment written here by
 * its own page, a webmention by the page it was sent from, a fediverse reply by
 * the note's id, and a reply post by its permalink.
 */
function answeredAt(reply: Answered, baseUrl: string): string {
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

function refused(refusal: CommentRefusal): ReplyPostOutcome {
  return { kind: 'refused', refusal };
}
