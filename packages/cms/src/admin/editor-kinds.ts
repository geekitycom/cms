import type { EditorForm } from '../content/document-form.ts';
import { discoverPostType } from '../content/post-type.ts';
import type { PostType } from '../content/post-type.ts';
import type { ReviewKind } from '../content/review.ts';

export const POST_KINDS = [
  'note',
  'photo',
  'link',
  'rsvp',
  'event',
  'checkin',
  'episode',
  'review',
] as const;

export type PostKind = (typeof POST_KINDS)[number];

export type EditorSection = 'photos' | 'link' | 'rsvp' | 'event' | 'checkin' | 'episode' | 'review';

type TitleRule = 'optional' | 'named' | 'none';

export interface EditorKind {
  readonly label: string;
  readonly noun: string;
  readonly blurb: string;
  readonly icon: string;
  readonly title: TitleRule;
  readonly body: string;
  readonly sections: readonly EditorSection[];
}

export const EDITOR_KINDS: Readonly<Record<PostKind, EditorKind>> = {
  note: {
    label: 'Note',
    noun: 'note',
    blurb: 'A short post. Add a title and it becomes an article.',
    icon: 'M4 6h16M4 12h16M4 18h10',
    title: 'optional',
    body: 'Body',
    sections: [],
  },
  photo: {
    label: 'Photo',
    noun: 'photo',
    blurb: 'One or more photos with a caption.',
    icon: 'M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    title: 'optional',
    body: 'Caption',
    sections: ['photos'],
  },
  link: {
    label: 'Link',
    noun: 'link',
    blurb: 'Reply to, like, repost or bookmark a page on the web.',
    icon: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    title: 'optional',
    body: 'Your words',
    sections: ['link'],
  },
  rsvp: {
    label: 'RSVP',
    noun: 'RSVP',
    blurb: 'Say whether you are going to somebody else’s event.',
    icon: 'M8 7V3m8 4V3M3 11h18M5 5h14v16H5zM9 16l2 2 4-4',
    title: 'none',
    body: 'Note',
    sections: ['rsvp'],
  },
  event: {
    label: 'Event',
    noun: 'event',
    blurb: 'Something you are hosting, with a time and a place.',
    icon: 'M8 7V3m8 4V3M3 11h18M5 5h14v16H5z',
    title: 'named',
    body: 'Details',
    sections: ['event'],
  },
  checkin: {
    label: 'Check-in',
    noun: 'check-in',
    blurb: 'Where you are right now, with an optional note and photo.',
    icon: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    title: 'none',
    body: 'Note',
    sections: ['checkin', 'photos'],
  },
  episode: {
    label: 'Episode',
    noun: 'episode',
    blurb: 'Audio or video: a podcast episode, a talk, a recording.',
    icon: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    title: 'named',
    body: 'Show notes',
    sections: ['episode'],
  },
  review: {
    label: 'Review',
    noun: 'review',
    blurb: 'A rating and review of a book, movie, show, album, place or anything else.',
    icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    title: 'optional',
    body: 'Your review',
    sections: ['review', 'photos'],
  },
};

export const PAGE_CHOICE = {
  label: 'Page',
  blurb: 'A standing page like About or Now. No date, not in the feed.',
  icon: 'M6 3h9l4 4v14H6zM14 3v5h5',
} as const;

export function isPostKind(value: unknown): value is PostKind {
  return POST_KINDS.includes(value as PostKind);
}

const KIND_OF_TYPE: Readonly<Record<PostType, PostKind>> = {
  event: 'event',
  rsvp: 'rsvp',
  repost: 'link',
  like: 'link',
  reply: 'link',
  review: 'review',
  photo: 'photo',
  bookmark: 'link',
  note: 'note',
  article: 'note',
};

export function discoveredKind(form: EditorForm): PostKind {
  const kind =
    KIND_OF_TYPE[
      discoverPostType({
        name: form.title,
        content: form.body,
        summary: form.description,
        'in-reply-to': form.inReplyTo,
        start: form.event.start,
        rsvp: form.rsvp,
        photo: form.photos.map((photo) => photo.url),
        'repost-of': form.repostOf,
        'like-of': form.likeOf,
        'bookmark-of': form.bookmarkOf,
        item: form.review.name,
      })
    ];
  if (kind !== 'note' && kind !== 'photo') return kind;
  if (form.enclosure.url !== '') return 'episode';
  if (form.location.checkin) return 'checkin';
  return kind;
}

export const REVIEW_EDITOR_WORDS: Readonly<
  Record<ReviewKind, { name: string; uid: string; url: string }>
> = {
  book: { name: 'Title', uid: 'ISBN or link', url: 'Address' },
  movie: { name: 'Title', uid: 'Link on TMDb or IMDb', url: 'Address' },
  tv: { name: 'Title', uid: 'Link on TMDb or IMDb', url: 'Address' },
  album: { name: 'Title', uid: 'Link on MusicBrainz', url: 'Address' },
  place: { name: 'Name', uid: 'Link on a map', url: 'Website' },
  other: { name: 'Name', uid: 'ID or link', url: 'Link' },
};
