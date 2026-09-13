/**
 * An Eleventy 3 config that builds a Geekity content directory.
 *
 * Copy this to `eleventy.config.js` in the root of your site and run
 * `npx @11ty/eleventy`. The same `content/` directory that the CMS serves
 * becomes a static site at the same URLs, which is the promise this file
 * exists to keep: nothing here is Geekity-specific magic, only the rules the
 * CMS follows written out in Eleventy's own terms.
 *
 * 1. `draft: true` hides a document.
 * 2. A `date` in the future holds a post back until it arrives.
 * 3. A document with no `permalink` gets the CMS default:
 *    `/{yyyy}/{mm}/{slug}/` for posts, `/{slug}/` for pages.
 * 4. `content/uploads/` is copied through to `/uploads/`.
 * 5. `content/_trash/` is not built.
 * 6. `categories`, the CMS's second taxonomy, becomes `collections.categories`.
 * 7. The site menu becomes `collections.menu`.
 * 8. A `date` filter that reads a UTC instant through `site.timezone`.
 * 9. `content/_data/federation/` — the followers and the inbox log — is data.
 * 10. A `conversation` filter that builds a post's replies, likes, boosts and
 *     mentions out of that log — and the approved comments and webmentions
 *     from `content/_data/comments/` alongside them — sanitised and nested, as the
 *     CMS's own theme gets them.
 *
 * You supply the layouts. The directory data files name them — `posts.json`
 * says `"layout": "post"`, `pages.json` says `"layout": "page"` — so
 * `content/_includes/post.njk` and `content/_includes/page.njk` need to exist.
 *
 * This file has no dependencies beyond Eleventy itself, so it stays copyable.
 * It is not part of the published package; it lives in the repository, and the
 * package's `test:11ty` suite builds the test fixtures with it to prove the
 * URLs still match.
 */

import { readFileSync } from 'node:fs';

/** The content subdirectory that holds dated posts; everything else is a page. */
const POSTS_DIRECTORY = 'posts';

/**
 * The zone the CMS shows its dates in.
 *
 * Dates in the files are UTC instants; the `timezone` setting is the lens they
 * are read through, and the settings screen mirrors it into `site.json`. It is
 * read here rather than off the template context because a filter's `this`
 * differs between Eleventy's template engines and a build has one site.
 */
function siteTimezone() {
  try {
    const site = JSON.parse(readFileSync('content/_data/site.json', 'utf8'));
    return typeof site.timezone === 'string' && site.timezone !== '' ? site.timezone : 'UTC';
  } catch {
    return 'UTC';
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The calendar day a zone was on at an instant, `YYYY-MM-DD`. */
function calendarDayIn(date, zone) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Letters that Unicode decomposition leaves alone, spelled out before the
 * ASCII filter throws them away. Mirrors `slugify` in the CMS.
 */
const TRANSLITERATIONS = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ|ð/g, 'd'],
  [/ł/g, 'l'],
  [/þ/g, 'th'],
  [/ħ/g, 'h'],
  [/ı/g, 'i'],
  [/ŋ/g, 'n'],
];

/** Turn a title into a URL slug: lowercase ASCII letters, digits and hyphens. */
function slugify(title) {
  let value = String(title).normalize('NFKD').toLowerCase();

  for (const [pattern, replacement] of TRANSLITERATIONS) {
    value = value.replace(pattern, replacement);
  }

  return value
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The year and month a post is filed under, read from the date as written
 * rather than shifted into UTC: a post published at 00:30 on 1 October in
 * Berlin belongs to October.
 */
function yearAndMonth(date) {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})/.exec(date);
    if (match) return { year: match[1], month: match[2] };
  }

  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return {
    year: String(parsed.getUTCFullYear()).padStart(4, '0'),
    month: String(parsed.getUTCMonth() + 1).padStart(2, '0'),
  };
}

/** One document's `categories`, which Eleventy hands over as written. */
function categoriesOf(data) {
  const value = data?.categories;
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((category) => typeof category === 'string' && category !== '');
}

/** Whether a content-relative input path is a post rather than a page. */
function isPost(inputPath) {
  return String(inputPath).split('/').includes(POSTS_DIRECTORY);
}

/**
 * The permalink the CMS would compute for a document whose front matter has
 * none. Returns undefined when there is nothing to compute it from, in which
 * case Eleventy falls back to its own filename-based URL.
 */
function defaultPermalink(data) {
  const slug = slugify(data.title ?? '') || data.page?.fileSlug;
  if (!slug) return undefined;

  if (!isPost(data.page?.inputPath ?? '')) return `/${slug}/`;

  // `data.date` is what the file wrote; `page.date` is Eleventy's parse of it.
  const filed = yearAndMonth(data.date ?? data.page?.date);
  if (!filed) return undefined;

  return `/${filed.year}/${filed.month}/${slug}/`;
}

/**
 * The slug that names a post in the fediverse: its permalink's last segment,
 * or — for a file that has neither a permalink nor one computed above — the
 * slug of its title. Mirrors the CMS's own rule.
 */
function slugOf(data) {
  const permalink = typeof data.permalink === 'string' ? data.permalink : '';
  const last = permalink
    .split('/')
    .filter((segment) => segment !== '')
    .pop();
  if (last !== undefined && last !== '') return last.replace(/\.[^.]+$/, '');

  return slugify(data.title ?? '') || data.page?.fileSlug || undefined;
}

/**
 * A path on the site as an absolute URL, on the site's own base URL.
 *
 * A base URL carrying a path — a site served from a subdirectory — puts that
 * path in front of a root-relative one, exactly as the CMS's own `absoluteUrl`
 * does, so a post's object id is the same string on both sides.
 */
function absoluteUrl(pathname, url) {
  try {
    const base = new URL(String(url).endsWith('/') ? String(url) : `${String(url)}/`);
    const directory = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
    return new URL(
      pathname.startsWith('/') ? `${directory}${pathname}` : pathname,
      base,
    ).toString();
  } catch {
    return undefined;
  }
}

/** A JSON-LD value as the one absolute URI it names, or undefined. */
function uriOf(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = uriOf(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  // A node object names its subject with `id`; a Link names its target with
  // `href`, which is how a note usually spells its `url`.
  if (value && typeof value === 'object') return uriOf(value.id ?? value['@id'] ?? value.href);
  if (typeof value !== 'string') return undefined;

  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/** A JSON-LD value as the one string it holds, or undefined. */
function textOf(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textOf(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') return textOf(value['@value']);
  return typeof value === 'string' ? value : undefined;
}

/** `@user@host` for an actor URL, the way the CMS guesses one. */
function handleOf(actorId) {
  try {
    const url = new URL(actorId);
    const last = url.pathname
      .split('/')
      .filter((segment) => segment !== '')
      .pop();
    return last === undefined ? undefined : `@${last.replace(/^@/, '')}@${url.host}`;
  } catch {
    return undefined;
  }
}

/**
 * One post's approved comments, as `content/_data/comments/{slug}.json` says
 * them (TASK-50).
 *
 * Read from disk rather than through Eleventy's data cascade on purpose. A
 * namespaced `_data/comments/` directory would arrive as a global called
 * `comments`, and `comments: true` or `comments: false` in a post's front
 * matter is a real key that would shadow it on exactly the pages that need it.
 *
 * A missing file is a post nobody has commented on, and a file that will not
 * parse is treated the same way: a build should not fail over one broken
 * comment file, which is the rule the CMS applies to it too.
 */
function nativeCommentsFor(slug) {
  if (typeof slug !== 'string' || slug === '') return [];

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(`content/_data/comments/${slug}.json`, 'utf8'));
  } catch {
    return [];
  }

  const held = Array.isArray(parsed?.comments) ? parsed.comments : [];
  return held.filter((entry) => entry?.status === 'approved' && typeof entry.id === 'string');
}

/** Every activity in the log, oldest month first and in arrival order. */
function activitiesIn(inbox) {
  const months = Object.keys(inbox ?? {}).sort();
  return months.flatMap((month) => (Array.isArray(inbox[month]) ? inbox[month] : []));
}

/**
 * The conversation under one post, as the CMS builds it.
 *
 * A reply is a `Create` whose object names what it answers; a like and a boost
 * are a `Like` and an `Announce` of the post itself, counted once per actor. A
 * `Delete` of a note or an `Undo` of a like takes it back, but only when the
 * actor sending it is the one who did it in the first place — otherwise anyone
 * could delete anybody's comment off the page. Replies are nested by
 * `inReplyTo`, and one whose target was deleted moves up to whatever that was
 * answering rather than disappearing with it.
 */
function conversationIn(inbox, objectId, slug) {
  const empty = {
    replies: [],
    likes: [],
    boosts: [],
    mentions: [],
    counts: { replies: 0, likes: 0, boosts: 0, mentions: 0, total: 0 },
  };

  // What a top-level answer names. A post that has never been delivered has no
  // object id and so no fediverse replies, but it can still have comments, and
  // they have to hang off something.
  const root = typeof objectId === 'string' && objectId !== '' ? objectId : '\u0000post';

  const activities = root === objectId ? activitiesIn(inbox) : [];
  const owners = new Map();
  const withdrawn = new Set();
  const notes = [];
  const likes = [];
  const boosts = [];
  const mentions = [];
  const reacted = new Set();

  const author = (actorId) => {
    const handle = handleOf(actorId);
    return { name: handle ?? actorId, handle: handle ?? null, url: actorId, avatar: null, actorId };
  };

  for (const activity of activities) {
    const actorId = uriOf(activity.actor);
    if (actorId === undefined) continue;
    const type = activity.type;
    const target = uriOf(activity.object);
    if (target !== undefined) owners.set(target, actorId);
    const own = uriOf(activity.id);
    if (own !== undefined) owners.set(own, actorId);

    if (type === 'Create' && activity.object && typeof activity.object === 'object') {
      const note = activity.object;
      const id = uriOf(note.id);
      const inReplyTo = uriOf(note.inReplyTo);
      if (id === undefined || inReplyTo === undefined) continue;
      notes.push({
        id,
        source: 'activitypub',
        kind: 'reply',
        author: author(actorId),
        url: uriOf(note.url) ?? id,
        content: sanitizeComment(textOf(note.content) ?? ''),
        published: textOf(note.published) ?? activity.receivedAt ?? '',
        inReplyTo,
        status: 'published',
        replies: [],
      });
      continue;
    }

    if ((type === 'Like' || type === 'Announce') && target === objectId) {
      const kind = type === 'Like' ? 'like' : 'boost';
      const key = `${kind} ${actorId}`;
      if (reacted.has(key)) continue;
      reacted.add(key);
      (kind === 'like' ? likes : boosts).push({
        id: own ?? `${actorId}#${kind}`,
        source: 'activitypub',
        kind,
        author: author(actorId),
        url: actorId,
        content: '',
        published: activity.receivedAt ?? '',
        inReplyTo: null,
        status: 'published',
        replies: [],
      });
    }
  }

  // The comments people left on the site itself, and the webmentions other
  // pages sent it. They are the same shape as a fediverse reply, so they thread
  // with them rather than sitting in a section of their own — which is the
  // whole reason an entry says its `source`. A webmention lives on the page it
  // came from, so its `url` is that page rather than an anchor here; a repost
  // is a boost by another name and joins them; and a mention is neither an
  // answer nor a reaction, so it gets a list of its own.
  for (const stored of nativeCommentsFor(slug)) {
    const kind = stored.kind ?? 'reply';
    const entry = {
      id: stored.id,
      source: stored.source ?? 'comment',
      kind,
      author: {
        name: stored.author?.name ?? '',
        handle: null,
        url: stored.author?.url ?? null,
        avatar: stored.author?.avatar ?? null,
        actorId: null,
      },
      url: stored.url ?? `#comment-${stored.id}`,
      content: stored.content?.html ?? '',
      published: stored.submitted ?? '',
      inReplyTo: stored.inReplyTo ?? root,
      status: stored.status,
      replies: [],
    };

    if (kind === 'reply') notes.push(entry);
    else if (kind === 'like') likes.push(entry);
    else if (kind === 'mention') mentions.push(entry);
    else boosts.push(entry);
  }

  if (notes.length === 0 && likes.length === 0 && boosts.length === 0 && mentions.length === 0) {
    return empty;
  }

  // Oldest first, whatever source an entry came from, which is the order a
  // conversation reads in.
  notes.sort((left, right) => String(left.published).localeCompare(String(right.published)));

  // A second pass, because a `Delete` may arrive before this walk has seen the
  // thing it deletes.
  for (const activity of activities) {
    if (activity.type !== 'Delete' && activity.type !== 'Undo') continue;
    const actorId = uriOf(activity.actor);
    const target = uriOf(activity.object);
    if (target === undefined || owners.get(target) !== actorId) continue;
    withdrawn.add(target);
  }

  const live = notes.filter((note) => !withdrawn.has(note.id));
  const byId = new Map(live.map((note) => [note.id, note]));
  const targets = new Map(notes.map((note) => [note.id, note.inReplyTo]));
  const top = [];

  for (const note of live) {
    let target = targets.get(note.id);
    for (let step = 0; step <= targets.size; step += 1) {
      if (target === undefined) break;
      if (target === root) {
        top.push(note);
        break;
      }
      const parent = byId.get(target);
      if (parent !== undefined) {
        if (parent !== note) parent.replies.push(note);
        break;
      }
      target = targets.get(target);
    }
  }

  const kept = countReplies(top);
  const heldLikes = likes.filter((like) => !withdrawn.has(like.id));
  const heldBoosts = boosts.filter((boost) => !withdrawn.has(boost.id));

  return {
    replies: top,
    likes: heldLikes,
    boosts: heldBoosts,
    mentions,
    counts: {
      replies: kept,
      likes: heldLikes.length,
      boosts: heldBoosts.length,
      mentions: mentions.length,
      total: kept + heldLikes.length + heldBoosts.length + mentions.length,
    },
  };
}

/** How many replies a thread holds, counting all the way down. */
function countReplies(replies) {
  let total = 0;
  for (const reply of replies) total += 1 + countReplies(reply.replies);
  return total;
}

/** Elements a comment may keep, and nothing else. */
const COMMENT_ELEMENTS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'u',
  'ul',
];

/** URL schemes a link in a comment may use. An allowlist, not a denylist. */
const COMMENT_SCHEMES = ['http://', 'https://', 'mailto:'];

/**
 * A stranger's HTML, reduced to markup this site is willing to republish.
 *
 * A shorter version of the CMS's own `sanitizeCommentHtml`: the input is
 * tokenised and the output rebuilt from the allowlist above, so a tag or an
 * attribute this does not name cannot reach a reader however it was spelled.
 * An element that is not on the list is unwrapped rather than deleted, except
 * `script` and `style`, whose contents are a program rather than words. Where
 * this and the CMS's version differ, it is that this one gives up on a
 * malformed tag sooner and escapes it as text: erring toward showing the
 * markup, never toward running it.
 *
 * Swap in `sanitize-html` if you would rather depend on one; this file keeps
 * its promise of no dependencies beyond Eleventy.
 */
function sanitizeComment(html) {
  const out = [];
  const open = [];
  let at = 0;

  const closeThrough = (name) => {
    const index = open.lastIndexOf(name);
    if (index < 0) return;
    while (open.length > index) out.push(`</${open.pop()}>`);
  };

  while (at < html.length) {
    const next = html.indexOf('<', at);
    if (next < 0) {
      out.push(escapeComment(html.slice(at)));
      break;
    }
    if (next > at) out.push(escapeComment(html.slice(at, next)));
    at = next;

    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', at) || html.startsWith('<?', at)) {
      const end = html.indexOf('>', at);
      at = end < 0 ? html.length : end + 1;
      continue;
    }

    const tag = /^<(\/?)([A-Za-z][A-Za-z0-9]*)([^>]*)>/.exec(html.slice(at));
    if (tag === null) {
      // A `<` that begins no tag is a character somebody typed.
      out.push('&lt;');
      at += 1;
      continue;
    }
    at += tag[0].length;
    const name = tag[2].toLowerCase();

    if (tag[1] === '/') {
      closeThrough(name);
      continue;
    }
    if (name === 'script' || name === 'style') {
      const end = new RegExp(`</${name}\\s*>`, 'i').exec(html.slice(at));
      at = end === null ? html.length : at + end.index + end[0].length;
      continue;
    }
    if (!COMMENT_ELEMENTS.includes(name)) continue; // Unwrapped: its words stay.
    if (name === 'br') {
      out.push('<br>');
      continue;
    }
    if (name === 'a') {
      const href = commentHref(tag[3]);
      if (href === undefined) continue;
      out.push(`<a href="${escapeComment(href)}" rel="nofollow noopener noreferrer">`);
    } else {
      // `<p>one<p>two` is two paragraphs, not a nested one.
      if (name === 'p' || name === 'li') closeThrough(name);
      out.push(`<${name}>`);
    }
    open.push(name);
  }

  while (open.length > 0) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** A link's target, or undefined when it is not one to publish. */
function commentHref(attributes) {
  const match = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes ?? '');
  if (match === null) return undefined;

  // Control characters go and the ends are trimmed before the scheme is read,
  // because that is what a browser's URL parser does: `java&#10;script:` is a
  // script URL to everything that will render this.
  const href = [...decodeComment(match[2] ?? match[3] ?? match[4] ?? '')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  const lowered = href.toLowerCase();
  return COMMENT_SCHEMES.some((scheme) => lowered.startsWith(scheme)) ? href : undefined;
}

const COMMENT_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Character references resolved, so escaping them again cannot double up. */
function decodeComment(value) {
  return value.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    try {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    } catch {
      return whole;
    }
    return COMMENT_ENTITIES[body] ?? whole;
  });
}

/** Text as markup: decoded, then escaped. */
function escapeComment(value) {
  return decodeComment(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export default function (eleventyConfig) {
  // The CMS's `date` filter, in Eleventy's terms: `readable` (the default),
  // `html` and `year` are the calendar the site's own zone is on, and `iso` is
  // the instant, because a <time datetime> and a feed want UTC and must not
  // move when a setting does. Pass a zone as the second argument to override.
  //
  // With Luxon — which Eleventy already ships — the same filter reads:
  //
  //     const at = DateTime.fromJSDate(new Date(value)).setZone(zone ?? siteTimezone());
  //     return { iso: at.toUTC().toISO(), html: at.toFormat('yyyy-MM-dd'),
  //              year: at.toFormat('yyyy') }[format] ?? at.toFormat('d LLLL yyyy');
  //
  // This version uses Intl so the file keeps its promise of no dependencies.
  const defaultZone = siteTimezone();
  eleventyConfig.addFilter('date', (value, format = 'readable', zone = defaultZone) => {
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    if (format === 'iso') return at.toISOString();

    const [year, month, day] = calendarDayIn(at, zone).split('-');
    if (format === 'html') return `${year}-${month}-${day}`;
    if (format === 'year') return year;
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  });

  // The CMS publishes its ActivityPub followers and the log of what its inbox
  // was told under `content/_data/federation/` (decision-9), so a build of the
  // same directory can show them. Eleventy reads `followers.json` by itself —
  // it is a data file in a namespaced `_data` subdirectory, so it arrives as
  // `federation.followers` — but the inbox log is JSON Lines, one activity per
  // line, which Eleventy has no reader for. This is that reader: each month
  // file becomes an entry of `federation.inbox`, keyed by its `{yyyy}-{mm}`
  // name and holding an array of compact JSON-LD activities, each with the
  // `receivedAt` the log stamped it with.
  //
  //     {% for follower in federation.followers %}{{ follower.handle }}{% endfor %}
  //     {% for month, activities in federation.inbox %}…{% endfor %}
  //
  // A blank line is skipped; a line that will not parse fails the build, which
  // is the same thing the CMS does with it.
  eleventyConfig.addDataExtension('jsonl', (contents) =>
    contents
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line)),
  );

  // `draft: true` is the CMS's only status flag. Set BUILD_DRAFTS=1 to preview
  // them locally.
  eleventyConfig.addPreprocessor('geekity-drafts', '*', (data) => {
    if (data.draft === true && !process.env.BUILD_DRAFTS) return false;
  });

  // A post dated in the future is scheduled: the CMS holds it until its date
  // and publishes it then. A build has no clock, only the moment it ran, so the
  // nearest equivalent is to leave a future-dated post out of this build and
  // let the next build after its date pick it up — which means a site with
  // scheduled posts needs a build on a schedule. Set BUILD_SCHEDULED=1 to
  // include them anyway.
  eleventyConfig.addPreprocessor('geekity-scheduled', '*', (data) => {
    if (process.env.BUILD_SCHEDULED) return;

    const date = data.date ?? data.page?.date;
    if (date === undefined || date === null) return;

    const at = date instanceof Date ? date : new Date(date);
    if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now()) return false;
  });

  // The CMS writes `permalink` into every file it saves, so this only matters
  // for hand-authored files. Front matter always wins.
  eleventyConfig.addPreprocessor('geekity-permalinks', 'md', (data) => {
    if (typeof data.permalink === 'string' && data.permalink !== '') return;

    const permalink = defaultPermalink(data);
    if (permalink !== undefined) data.permalink = permalink;
  });

  // The slug the CMS knows a document by: the permalink's last segment. It is
  // what names the document's comment file under `content/_data/comments/`,
  // and the `conversation` filter below takes it as its second argument.
  eleventyConfig.addPreprocessor('geekity-slug', 'md', (data) => {
    data.geekitySlug = slugOf(data);
  });

  // The post's name in the fediverse, which is what a reply, a like or a boost
  // in the inbox log points at. The CMS puts it on the template context as
  // `activityStreams`, and this does the same, so a layout can hand it to the
  // `conversation` filter below. It runs after the permalink preprocessor
  // because decision-13 makes a post's ActivityStreams id its permalink: one
  // URL, answering a browser with the page and a peer with the Article. The
  // exception is a post migrated from somewhere else, whose `activitypub.id`
  // is the name its followers already hold, so a stored id always wins.
  eleventyConfig.addPreprocessor('geekity-activitypub', 'md', (data) => {
    if (!isPost(data.page?.inputPath ?? '')) return;

    const stored = data.activitypub?.id;
    if (typeof stored === 'string' && stored !== '') {
      data.activityStreams = stored;
      return;
    }

    const permalink = typeof data.permalink === 'string' ? data.permalink : undefined;
    if (permalink === undefined) return;
    const id = absoluteUrl(permalink, data.site?.url);
    if (id !== undefined) data.activityStreams = id;
  });

  // The conversation under a post: the replies, likes and boosts the inbox log
  // holds about it, in the shape the CMS hands its own theme (TASK-49). The
  // whole log is in memory as `federation.inbox`, so this is a filter rather
  // than a collection:
  //
  //     {% set conversation = federation.inbox | conversation(activityStreams, geekitySlug) %}
  //     {% for reply in conversation.replies %}…{% endfor %}
  //
  // The second argument is the post's slug, which is what names its comment
  // file under `content/_data/comments/`: the approved comments there are
  // threaded in with the fediverse replies, exactly as the CMS threads them.
  // `geekitySlug` is put on the context by the preprocessor above.
  //
  // What comes back is `{ replies, likes, boosts, mentions, counts }`, with `replies`
  // nested by `inReplyTo` and every `content` already sanitised. The theme
  // README documents the whole shape under "The conversation".
  eleventyConfig.addFilter('conversation', (inbox, objectId, slug) =>
    conversationIn(inbox, objectId, slug),
  );

  // Eleventy builds a collection from every value of `tags` by itself. The
  // CMS's second taxonomy, `categories`, is an ordinary data key to Eleventy,
  // so this exposes it: `collections.categories` holds one entry per category
  // in use, `{ name, posts }`, sorted by name with each category's documents
  // newest first — the order the CMS's own archive serves them in.
  //
  // Paginate it to build those archives. The base comes from `site.json`, which
  // the settings screen mirrors, so a base changed in the CMS moves the built
  // archives too:
  //
  //     ---
  //     pagination:
  //       data: collections.categories
  //       size: 1
  //       alias: category
  //     permalink: "/{{ site.categoryBase or 'category' }}/{{ category.name | urlencode }}/"
  //     ---
  //     {% for post in category.posts %}…{% endfor %}
  eleventyConfig.addCollection('categories', (collectionApi) => {
    const byCategory = new Map();

    for (const item of collectionApi.getAll()) {
      for (const category of categoriesOf(item.data)) {
        const posts = byCategory.get(category) ?? [];
        posts.push(item);
        byCategory.set(category, posts);
      }
    }

    return [...byCategory.keys()].sort().map((name) => ({
      name,
      posts: (byCategory.get(name) ?? [])
        .slice()
        .sort((a, b) => Number(b.date ?? 0) - Number(a.date ?? 0)),
    }));
  });

  // The site menu. The CMS puts it on every template as `menu`; here it is
  // `collections.menu`, because a collection is the only place a build can see
  // both the global data and every page at once.
  //
  // It is the `navigation` array of `content/_data/site.json`, which the
  // settings screen mirrors, followed by every page whose front matter says
  // `navigation: true`, ordered by `navigationOrder` and then by title. Each
  // entry is `{ label, url }`; a layout marks the current one itself, because a
  // collection is built once for the whole site and `page.url` is per template:
  //
  //     {% for item in collections.menu %}
  //     <a href="{{ item.url }}"
  //        {% if item.url == page.url %}aria-current="page"{% endif %}>{{ item.label }}</a>
  //     {% endfor %}
  eleventyConfig.addCollection('menu', (collectionApi) => {
    const all = collectionApi.getAll();
    const site = all[0]?.data?.site ?? {};

    const items = (Array.isArray(site.navigation) ? site.navigation : [])
      .filter(
        (item) =>
          item &&
          typeof item.label === 'string' &&
          item.label !== '' &&
          typeof item.url === 'string' &&
          item.url !== '',
      )
      .map((item) => ({ label: item.label, url: item.url }));

    const pages = all
      .filter((item) => item.data.navigation === true && !isPost(item.data.page?.inputPath ?? ''))
      .map((item) => ({
        label: String(item.data.title ?? ''),
        url: item.url,
        order:
          typeof item.data.navigationOrder === 'number' &&
          Number.isFinite(item.data.navigationOrder)
            ? item.data.navigationOrder
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map(({ label, url }) => ({ label, url }));

    return [...items, ...pages];
  });

  // Documents are Markdown; Nunjucks and HTML are here for the layouts and for
  // any index pages you write by hand.
  eleventyConfig.setTemplateFormats(['md', 'njk', 'html']);

  // Uploads are files, not templates: copy them through unchanged. The ignore
  // matters as much as the copy — the CMS only ever indexes `posts/` and
  // `pages/`, so a Markdown file that happens to be an upload is something to
  // download, not a page Eleventy should render at a URL of its own.
  eleventyConfig.addPassthroughCopy({ 'content/uploads': 'uploads' });
  eleventyConfig.ignores.add('content/uploads/**');

  // The CMS's derived image variants are NOT copied and NOT ignored here,
  // because there is nothing to ignore: they live in `data/images/`, outside
  // this build's input directory, and they are disposable state the CMS
  // rebuilds on demand (decision-9, decision-10). A build makes its own.
  //
  // To get the markup the CMS serves — a <picture> with a WebP <source> and an
  // <img> carrying srcset, sizes, width, height and loading="lazy" — run
  // @11ty/eleventy-img over the same originals, at the same widths:
  //
  //     import { eleventyImageTransformPlugin } from '@11ty/eleventy-img';
  //
  //     eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
  //       widths: [320, 640, 960, 1280, 1920],
  //       formats: ['webp', 'auto'],
  //       defaultAttributes: { loading: 'lazy', sizes: '100vw' },
  //     });
  //
  // It is left out of this file rather than switched on, because this config
  // promises to have no dependencies beyond Eleventy itself.

  // Eleventy ignores `_includes` and `_data` because they are configured
  // directories; every other underscore directory is built unless it is
  // ignored, and the CMS keeps deleted documents in `content/_trash/`.
  eleventyConfig.ignores.add('content/_trash/**');

  return {
    dir: {
      input: 'content',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    // Markdown is rendered as Markdown, not as a template. The CMS renders it
    // with markdown-it and no template engine, so leaving Liquid or Nunjucks on
    // here would let `{{ … }}` in a post mean two different things.
    markdownTemplateEngine: false,
    htmlTemplateEngine: 'njk',
  };
}
