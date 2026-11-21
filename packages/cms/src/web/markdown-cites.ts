import { CITATION_VERBS, citationsOf, citedPageName } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { replyTarget } from '../content/post-type.ts';
import { RSVP_PHRASES, rsvpOf } from '../content/rsvp.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import type { MarkdownCite } from './markdown-page.ts';
import { replyContextFor } from './page-context.ts';

export function markdownCites(
  document: Document,
  citedPage: ((url: string) => ReplyContext | undefined) | undefined,
): MarkdownCite[] {
  const cite = (verb: string, target: string): MarkdownCite =>
    markdownCite(verb, target, citedPage?.(target));
  const target = replyTarget(document);
  const rsvp = rsvpOf(document.extra);
  return [
    ...(target === undefined
      ? []
      : [cite(rsvp === undefined ? 'In reply to' : RSVP_PHRASES[rsvp], target)]),
    ...citationsOf(document.extra).map((citation) =>
      cite(CITATION_VERBS[citation.property], citation.url),
    ),
  ];
}

function markdownCite(
  verb: string,
  target: string,
  context: ReplyContext | undefined,
): MarkdownCite {
  const url = context?.original ?? target;
  const name = citedPageName(url, context);
  const author = context?.author?.name.trim();
  const named =
    author !== undefined &&
    author !== '' &&
    name.trim().toLowerCase().endsWith(` by ${author.toLowerCase()}`);
  const { startDate, startZone, published } = replyContextFor(context ?? { url });
  return {
    verb,
    url,
    name,
    ...(author === undefined || named ? {} : { author }),
    ...(author === undefined && context?.site !== undefined ? { site: context.site } : {}),
    ...(startDate instanceof Date
      ? { startDate, ...(typeof startZone === 'string' ? { startZone } : {}) }
      : published instanceof Date
        ? { published }
        : {}),
    ...(context?.location === undefined ? {} : { location: context.location }),
    ...(context?.original === undefined ? {} : { copy: target }),
  };
}
