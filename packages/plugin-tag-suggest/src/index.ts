/**
 * `@geekity/plugin-tag-suggest` (decision-33): Suggest tags beside the
 * editor's Tags field. A press asks the language model `@geekity/plugin-llm`
 * connects to for hashtags in two groups: the ones this post is about, and
 * the ones from a seed list of hashtags people follow that fit it, for reach.
 * Follower counts on tags.pub help rank both. The author ticks the ones to
 * add. Nothing is sent on save or publish.
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
import { hashtagKey, readableTag } from './key.ts';
import { SEED } from './seed.ts';
import { VERSION } from './version.ts';

export { hashtagKey };

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

/** How many tags the model is asked for in each group. */
const FOR_POST = { least: 3, most: 5 } as const;
const FOR_REACH_MOST = 5;

/** How many of the site's tags the model is shown, most used first. */
const SITE_TAGS_SHOWN = 100;

/** How much of the body goes to the model; a longer one is cut there. */
const BODY_CHARACTERS = 24_000;

const FOR_THIS_POST = 'For this post';
const FOR_REACH = 'For reach';

/** The seed's tags by the key tags.pub knows them by. */
const SEED_FOLLOWERS: ReadonlyMap<string, number> = new Map(
  SEED.tags.map(([name, followers]) => [hashtagKey(name), followers]),
);

/** What the model answers. */
interface Suggested {
  readonly forThisPost: readonly string[];
  readonly forReach: readonly string[];
}

/** One candidate: what goes in the field, and the key tags.pub knows it by. */
interface Candidate {
  readonly value: string;
  readonly key: string;
  /** Whether the site already uses it, in which case `value` is the site's spelling. */
  readonly used: boolean;
  /** Where the model put it among its group, most fitting first. */
  readonly rank: number;
}

/**
 * Each group's tags, readable and deduplicated, in the model's order. A tag
 * the site already uses keeps the site's spelling, so accepting it files the
 * post with the posts already there. A reach tag must be on the seed list
 * and not already in the post's own group.
 */
function candidatesFrom(
  suggested: Suggested,
  siteTags: readonly string[],
): { forThisPost: Candidate[]; forReach: Candidate[] } {
  const ours = new Map<string, string>();
  for (const tag of siteTags) {
    const key = hashtagKey(tag);
    if (key !== '' && !ours.has(key)) ours.set(key, tag);
  }
  const seen = new Set<string>();
  const group = (tags: readonly string[], most: number, admits: (key: string) => boolean) => {
    const candidates: Candidate[] = [];
    for (const tag of tags) {
      const value = readableTag(tag);
      const key = hashtagKey(value);
      if (key === '' || seen.has(key) || !admits(key) || candidates.length === most) continue;
      seen.add(key);
      const own = ours.get(key);
      candidates.push({
        value: own ?? value,
        key,
        used: own !== undefined,
        rank: candidates.length,
      });
    }
    return candidates;
  };
  return {
    forThisPost: group(suggested.forThisPost, FOR_POST.most, () => true),
    forReach: group(suggested.forReach, FOR_REACH_MOST, (key) => SEED_FOLLOWERS.has(key)),
  };
}

type Counts = ReadonlyMap<string, FollowerCount>;

function followersOf(candidate: Candidate, counts: Counts): number | undefined {
  const count = counts.get(candidate.key);
  return count?.known === true ? count.followers : undefined;
}

/**
 * The post's own tags: the site's first, then the model's order, which is
 * most fitting first. Followers rank only the reach group.
 */
function rankForPost(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => Number(b.used) - Number(a.used) || a.rank - b.rank);
}

/**
 * Reach tags, most followed first. tags.pub's count takes in the seed's
 * server, so the larger of the two is the better one; a lookup that failed
 * leaves the seed's.
 */
function rankForReach(candidates: readonly Candidate[], counts: Counts): Candidate[] {
  const weight = (candidate: Candidate) =>
    Math.max(followersOf(candidate, counts) ?? 0, SEED_FOLLOWERS.get(candidate.key) ?? 0);
  return [...candidates].sort((a, b) => weight(b) - weight(a) || a.rank - b.rank);
}

function choice(candidate: Candidate, counts: Counts, group: string): PluginEditorChoice {
  return {
    value: candidate.value,
    note: noteFor(counts.get(candidate.key)),
    ...(candidate.used ? { badge: 'Used here' } : {}),
    group,
  };
}

function noteFor(count: FollowerCount | undefined): string {
  if (count === undefined) return 'Followers unknown';
  if (!count.known) return `Followers unknown: ${count.reason}`;
  if (count.followers === 0) return 'No followers on tags.pub';
  return `${count.followers.toLocaleString('en')} ${count.followers === 1 ? 'follower' : 'followers'} on tags.pub`;
}

/** What the model is told, the seed list included. */
const INSTRUCTIONS = [
  'Suggest hashtags for this blog post, in two lists.',
  '',
  `forThisPost: ${String(FOR_POST.least)} to ${String(FOR_POST.most)} tags for what this post is specifically about, most fitting first: ` +
    'the people, events, places, projects and technologies it names, and its subject. ' +
    'Avoid generic words, such as experience, thoughts, posts, update or networking, ' +
    'unless the post is about that very thing. ' +
    'Use one of the tags this site already uses only when this post is about that subject; ' +
    'that the site uses a tag is no reason by itself to suggest it.',
  '',
  `forReach: up to ${String(FOR_REACH_MOST)} tags from the hashtags people follow, listed below, ` +
    'that this post is genuinely about, most fitting first. ' +
    'Leave it empty when none fit. Never pick one only because many people follow it.',
  '',
  'Write each tag as one word with no # and no spaces. ' +
    'Join several words in CamelCase, each word capitalised, such as WordCampUS, IndieWeb or OpenSource. ' +
    'Use only what the post is about; invent nothing.',
  '',
  `Hashtags people follow, most followed first: ${SEED.tags.map(([name]) => name).join(', ')}`,
].join('\n');

/** The draft as the model reads it. */
function draftText(draft: PluginEditorDraft, siteTags: readonly string[]): string {
  const body =
    draft.body.length > BODY_CHARACTERS
      ? `${draft.body.slice(0, BODY_CHARACTERS)}\n[…]`
      : draft.body;
  return [
    siteTags.length === 0
      ? 'This site uses no tags yet.'
      : `Tags this site already uses, most used first (suggest one only when this post is about it): ${siteTags.slice(0, SITE_TAGS_SHOWN).join(', ')}`,
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
  const tags = { type: 'array', items: { type: 'string' } };
  const completion = await llm.complete<Suggested>({
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: draftText(draft, siteTags) },
    ],
    schema: {
      type: 'object',
      properties: { forThisPost: tags, forReach: tags },
      required: ['forThisPost', 'forReach'],
      additionalProperties: false,
    },
    signal,
  });
  if (!completion.ok) return { ok: false, message: completion.message };

  const { forThisPost, forReach } = candidatesFrom(completion.value, siteTags);
  if (forThisPost.length + forReach.length === 0) {
    return {
      ok: false,
      message: 'The model suggested no tags that tags.pub can look up. Try again.',
    };
  }
  const counts = await followerCounts(
    [...forThisPost, ...forReach].map((candidate) => candidate.key),
    { ...lookup, signal },
  );
  return {
    ok: true,
    choices: [
      ...rankForPost(forThisPost).map((c) => choice(c, counts, FOR_THIS_POST)),
      ...rankForReach(forReach, counts).map((c) => choice(c, counts, FOR_REACH)),
    ],
  };
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
