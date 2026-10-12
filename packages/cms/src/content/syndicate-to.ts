import { nonEmptyStrings } from '../util/guards.ts';

/** The front matter key a post lists the ids of its targets under. */
export const SYNDICATE_TO_FRONT_MATTER_KEY = 'syndicate-to';

/** One place a post can be syndicated to. */
export interface SyndicationTarget {
  /** What `syndicate-to` names it by, and its Micropub uid. */
  readonly id: string;
  /** What the editor's checkbox and the post's link say. */
  readonly name: string;
  /**
   * The page the post links to and the webmention is sent to. As declared it
   * may hold a `{lang}` placeholder, which the post's language fills once the
   * target is selected for it.
   */
  readonly url: string;
  /** A tag that selects this target without the post listing it. */
  readonly tag?: string | undefined;
  /**
   * The languages, as canonical BCP 47 tags, the target takes posts in. A post
   * in any other language does not select it. Absent means every language.
   */
  readonly languages?: readonly string[] | undefined;
}

/** The ids a post's `syndicate-to` lists, as written. */
export function syndicateToOf(extra: Record<string, unknown>): string[] {
  return nonEmptyStrings(extra[SYNDICATE_TO_FRONT_MATTER_KEY]);
}
