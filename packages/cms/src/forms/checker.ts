import type { PostComment } from '../store/admin-store.ts';

/**
 * The one seam a third-party opinion on what the public posts plugs into.
 *
 * A site names a {@link CommentChecker} as `commentChecker` in its config;
 * comments, webmentions and contact messages are all judged through it.
 * Everything Akismet's API asks for is on the submission it is handed, and
 * its four answers are the four the comment intake understands, so nothing
 * else in the CMS has to know such a service exists.
 */

/**
 * What a checker is told a submission is.
 *
 * Akismet's `comment_type`, which is an open vocabulary with a handful of
 * documented values. A checker is free to ignore it; the three here are the
 * three this CMS can produce.
 */
export type SubmissionType =
  /** Somebody filled in the comment form under a post. */
  | 'comment'
  /** Another site's page said it links here (TASK-51). */
  | 'webmention'
  /** Somebody filled in the contact form on a page (TASK-56). */
  | 'contact-form';

/** Everything a checker is told about a comment on its way in. */
export interface CommentSubmission {
  /** The comment as it would be stored, before anything has judged it. */
  comment: Omit<PostComment, 'id'>;
  /**
   * What this is, when it is not what the comment's `source` would say.
   *
   * A contact message is judged through this same seam — the rules, the fields
   * and the answers are the ones a comment gets, and a site that named a
   * `commentChecker` of its own meant that checker to see everything the
   * public can post at it. But it is not a comment on a post, and Akismet has
   * a word for what it is, so the caller names it. Absent means the comment
   * speaks for itself: `webmention` for one, `comment` for everything else.
   */
  type?: SubmissionType | undefined;
  /** The post it is on. */
  post: {
    /** Its slug. */
    slug: string;
    /** Its title, for a checker that reports to a human. */
    title: string;
    /** Its absolute URL, which is what Akismet calls the permalink. */
    url: string;
  };
  /**
   * Where the request came from, **unhashed**.
   *
   * A checker needs the address itself, and this is the only place it exists:
   * the stored comment keeps a salted hash, because the file it lives in is
   * published with the site.
   */
  address: string | undefined;
  /** The `User-Agent` the browser sent, as it sent it. */
  userAgent: string | undefined;
  /** The `Referer` the browser sent, which is the page the form was on. */
  referrer: string | undefined;
  /** The site's public origin. */
  baseUrl: string;
}

/** What a stored comment's later reclassification tells the checker. */
export interface CommentReport {
  /** The comment, as it now stands. */
  comment: PostComment;
  /** Its post's absolute URL. */
  url: string;
  /** The site's public origin. */
  baseUrl: string;
}

/**
 * What a checker can say.
 *
 * `spam` files the comment as spam, where a moderator can see it and change
 * its mind. `discard` throws it away without storing it at all, which is what
 * a service says about traffic so obviously mechanical that a queue of it
 * would only be noise. `ham` is a positive opinion and lets the comment
 * through even where the site would have held it. `unknown` is no opinion, and
 * is what a checker that could not be reached should return.
 */
export type CommentVerdict = 'spam' | 'discard' | 'ham' | 'unknown';

/**
 * A third-party opinion on comments: the one seam anything like Akismet plugs
 * into.
 *
 * A site names one as `commentChecker` in its config, and nothing else in the
 * CMS knows the service exists. The two report methods are optional and are
 * called when a moderator disagrees with what happened — marking an approved
 * comment as spam, or letting one out of the spam list — because that
 * correction is the only training signal such a service gets.
 */
export interface CommentChecker {
  /** Judge a comment on its way in. */
  check(submission: CommentSubmission): CommentVerdict | Promise<CommentVerdict>;
  /** Told when a moderator files something as spam. */
  reportSpam?(report: CommentReport): void | Promise<void>;
  /** Told when a moderator says something was not spam after all. */
  reportHam?(report: CommentReport): void | Promise<void>;
}
