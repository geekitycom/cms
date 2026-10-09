/**
 * `@geekity/plugin-tag-suggest` (decision-33): Suggest tags beside the
 * editor's Tags field. A press asks the language model `@geekity/plugin-llm`
 * connects to for hashtags that fit the draft, preferring the tags the site
 * already uses, then ranks them by how many people follow each on tags.pub.
 * The author ticks the ones to add. Nothing is sent on save or publish.
 */

import { definePlugin } from '@geekity/cms/plugin';
import type {
  PluginEditorChoice,
  PluginEditorContext,
  PluginEditorDraft,
  PluginEditorSuggestion,
} from '@geekity/cms/plugin';
import type { LlmService } from '@geekity/plugin-llm';

import { followerCounts, LOOKUP_TIMEOUT_MS } from './followers.ts';
import type { FollowerCount, FollowerLookup } from './followers.ts';
import { VERSION } from './version.ts';

const LLM = '@geekity/plugin-llm';
const NAME = '@geekity/plugin-tag-suggest';

const DEFAULT_TAGS_SERVER = 'https://tags.pub';

const SETTINGS = [
  {
    type: 'url',
    key: 'tags_server',
    label: 'Tag server',
    default: DEFAULT_TAGS_SERVER,
    hint: 'Where follower counts come from: tags.pub, or another server that runs its software.',
  },
] as const;

/** How many tags the model is asked for. */
const ASKED = 8;

/** The most candidates looked up, whatever the model sends. */
const MOST_CANDIDATES = 12;

/** How many of the site's tags the model is shown, most used first. */
const SITE_TAGS_SHOWN = 100;

/** How much of the body goes to the model; a longer one is cut there. */
const BODY_CHARACTERS = 24_000;

/** Letters NFKD leaves whole, spelled out as tags.pub spells them. */
const TRANSLITERATIONS: readonly (readonly [RegExp, string])[] = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ|ð/g, 'd'],
  [/ł/g, 'l'],
  [/þ/g, 'th'],
];

/**
 * A tag as tags.pub names its account: lower case ASCII letters and digits,
 * accents dropped, everything else removed. tags.pub folds every tag this way
 * and refuses a spelling that is not already folded, and a tag in a script it
 * folds by transliteration, such as `日本`, comes out empty here and is left
 * out rather than guessed at.
 */
export function hashtagKey(tag: string): string {
  let value = tag.normalize('NFKD').toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS)
    value = value.replace(pattern, replacement);
  return value.replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** One candidate: what goes in the field, and the key tags.pub knows it by. */
interface Candidate {
  readonly value: string;
  readonly key: string;
  readonly used: boolean;
}

/**
 * The model's tags folded and deduplicated, in the model's order. A tag the
 * site already uses keeps the site's spelling, so accepting it files the post
 * with the posts already there.
 */
function candidatesFrom(suggested: readonly string[], siteTags: readonly string[]): Candidate[] {
  const ours = new Map<string, string>();
  for (const tag of siteTags) {
    const key = hashtagKey(tag);
    if (key !== '' && !ours.has(key)) ours.set(key, tag);
  }
  const candidates = new Map<string, Candidate>();
  for (const tag of suggested) {
    const key = hashtagKey(tag);
    if (key === '' || candidates.has(key)) continue;
    const own = ours.get(key);
    candidates.set(key, { value: own ?? key, key, used: own !== undefined });
  }
  return [...candidates.values()].slice(0, MOST_CANDIDATES);
}

/** Most followed first; a candidate with no count after every one with a count; the model's order otherwise. */
function ranked(
  candidates: readonly Candidate[],
  counts: ReadonlyMap<string, FollowerCount>,
): PluginEditorChoice[] {
  const followers = (candidate: Candidate) => {
    const count = counts.get(candidate.key);
    return count?.known === true ? count.followers : -1;
  };
  return [...candidates]
    .sort((a, b) => followers(b) - followers(a))
    .map((candidate) => ({
      value: candidate.value,
      note: noteFor(counts.get(candidate.key)),
      ...(candidate.used ? { badge: 'Used here' } : {}),
    }));
}

function noteFor(count: FollowerCount | undefined): string {
  if (count === undefined) return 'Followers unknown';
  if (!count.known) return `Followers unknown: ${count.reason}`;
  if (count.followers === 0) return 'No followers on tags.pub';
  return `${count.followers.toLocaleString('en')} ${count.followers === 1 ? 'follower' : 'followers'} on tags.pub`;
}

/** The draft as the model reads it. */
function draftText(draft: PluginEditorDraft, siteTags: readonly string[]): string {
  const body =
    draft.body.length > BODY_CHARACTERS
      ? `${draft.body.slice(0, BODY_CHARACTERS)}\n[…]`
      : draft.body;
  return [
    siteTags.length === 0
      ? 'This site uses no tags yet.'
      : `Tags this site already uses, most used first: ${siteTags.slice(0, SITE_TAGS_SHOWN).join(', ')}`,
    '',
    `Kind: ${draft.type === 'page' ? 'page' : (draft.postType ?? 'post')}`,
    draft.title === '' ? undefined : `Title: ${draft.title}`,
    draft.tags.length === 0 ? undefined : `Tags it has: ${draft.tags.join(', ')}`,
    '',
    body,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

async function suggestTags(
  llm: LlmService,
  lookup: Omit<FollowerLookup, 'signal'>,
  { draft, siteTags, signal }: PluginEditorContext,
): Promise<PluginEditorSuggestion> {
  if (draft.body.trim() === '' && draft.title.trim() === '') {
    return { ok: false, message: 'Write some of the post first. There is nothing to read yet.' };
  }
  const completion = await llm.complete<{ tags: string[] }>({
    messages: [
      {
        role: 'system',
        content:
          `Suggest up to ${String(ASKED)} hashtags for this blog post, most fitting first. ` +
          'Each is one word, or words run together with no spaces, and no #. ' +
          'Prefer a tag the site already uses when it fits; suggest a new one only for what those miss. ' +
          'Use only what the post is about; invent nothing.',
      },
      { role: 'user', content: draftText(draft, siteTags) },
    ],
    schema: {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
      required: ['tags'],
      additionalProperties: false,
    },
    signal,
  });
  if (!completion.ok) return { ok: false, message: completion.message };

  const candidates = candidatesFrom(completion.value.tags, siteTags);
  if (candidates.length === 0) {
    return {
      ok: false,
      message: 'The model suggested no tags that tags.pub can look up. Try again.',
    };
  }
  const counts = await followerCounts(
    candidates.map((candidate) => candidate.key),
    { ...lookup, signal },
  );
  return { ok: true, choices: ranked(candidates, counts) };
}

export default definePlugin({
  name: NAME,
  version: VERSION,
  label: 'Tag suggestions',
  description:
    'Suggests tags for a post in the editor, from the language model the LLM plugin connects to, ' +
    'ranked by how many people follow each tag on tags.pub, when the author asks.',
  hostApi: 1,
  requires: { [LLM]: '^0.2.0' },
  register(host) {
    const settings = host.settings(SETTINGS);
    host.editorAction({
      id: 'suggest-tags',
      field: 'tags',
      label: 'Suggest tags',
      suggest: (context) =>
        suggestTags(
          host.use(LLM),
          {
            fetch: (url, init) => host.fetch(url, init),
            server: settings.current().tags_server,
            userAgent: `Geekity-Tag-Suggest/${VERSION} (+${host.siteInfo().baseUrl})`,
            data: host.data,
            timeoutMs: LOOKUP_TIMEOUT_MS,
          },
          context,
        ),
    });
  },
});
