/**
 * `@geekity/plugin-post-summary` (decision-33): Suggest title and Suggest
 * description beside the editor's fields. A press sends the draft to the
 * language model `@geekity/plugin-llm` connects to and shows its answer, which
 * the author accepts into the field or dismisses. Nothing is sent on save or
 * publish.
 */

import { definePlugin } from '@geekity/cms/plugin';
import type {
  PluginEditorContext,
  PluginEditorDraft,
  PluginEditorSuggestion,
  PluginPostType,
} from '@geekity/cms/plugin';
import type { LlmService } from '@geekity/plugin-llm';

import { VERSION } from './version.ts';

const LLM = '@geekity/plugin-llm';

/**
 * The longest description, in characters: where the default theme's listings
 * cut a post's summary (`truncate(280)` in `partials/post-list.njk`).
 */
export const DESCRIPTION_CHARACTERS = 280;

/** The longest description, in words: where a feed cuts an excerpt (WordPress's 55). */
export const DESCRIPTION_WORDS = 55;

/** About the longest title asked for, in characters. */
const TITLE_CHARACTERS = 60;

/** How many of the site's latest titles the model sees as examples of its style. */
const TITLE_EXAMPLES = 5;

/** How much of the body goes to the model; a longer one is cut there. */
const BODY_CHARACTERS = 24_000;

/**
 * Posts that show no title: a title would turn a reply or a like into an
 * article, and a note saved untitled was written to be one.
 */
const UNTITLED: ReadonlySet<PluginPostType> = new Set(['like', 'reply', 'repost', 'rsvp', 'photo']);

/** Whether a title suggestion fits the draft. A new untitled post may still become an article. */
export function offersTitle(draft: PluginEditorDraft): boolean {
  if (draft.postType === undefined) return true;
  if (draft.postType === 'note') return !draft.saved;
  return !UNTITLED.has(draft.postType);
}

/** A read post is described by its read line, which the editor asks to leave alone. */
export function offersDescription(draft: PluginEditorDraft): boolean {
  return draft.postType !== 'read';
}

/**
 * A description within both limits. A model that runs long is cut after its
 * last whole sentence that fits, or at a word with an ellipsis when none does.
 */
export function fitDescription(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (fits(flat)) return flat;
  const sentences = flat.match(/[^.!?]+[.!?]+["”’)]*\s*/g) ?? [];
  let kept = '';
  for (const sentence of sentences) {
    if (!fits(`${kept}${sentence}`.trim())) break;
    kept += sentence;
  }
  if (kept.trim() !== '') return kept.trim();
  const words = flat.split(' ');
  while (words.length > 0 && !fits(`${words.join(' ')} …`)) words.pop();
  return `${words.join(' ')} …`;
}

function fits(text: string): boolean {
  return text.length <= DESCRIPTION_CHARACTERS && text.split(' ').length <= DESCRIPTION_WORDS;
}

/** One line, without the quotes or the full stop a model likes to add. */
export function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“'‘](.*)["”'’]$/, '$1')
    .replace(/(?<!\.)\.$/, '')
    .trim();
}

/** The draft as the model reads it. */
function draftText(draft: PluginEditorDraft): string {
  const body =
    draft.body.length > BODY_CHARACTERS
      ? `${draft.body.slice(0, BODY_CHARACTERS)}\n[…]`
      : draft.body;
  return [
    `Kind: ${draft.type === 'page' ? 'page' : (draft.postType ?? 'post')}`,
    draft.title === '' ? undefined : `Title: ${draft.title}`,
    draft.tags.length === 0 ? undefined : `Tags: ${draft.tags.join(', ')}`,
    '',
    body,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

/** A field the model fills, with what it is told about it and how its answer is tidied. */
interface Ask {
  readonly key: 'title' | 'description';
  readonly instruction: string;
  readonly style: (recentTitles: readonly string[]) => string[];
  readonly tidy: (text: string) => string;
}

const TITLE: Ask = {
  key: 'title',
  instruction:
    'Suggest a title for this blog post, written the way its author would write it: ' +
    `short, plain and specific, about ${String(TITLE_CHARACTERS)} characters at most. ` +
    'No quotation marks, no full stop at the end, no clickbait.',
  style: (recentTitles) => {
    const examples = recentTitles.slice(0, TITLE_EXAMPLES);
    return examples.length === 0
      ? []
      : [
          '',
          'Recent titles on this site, to match their style:',
          ...examples.map((title) => `- ${title}`),
        ];
  },
  tidy: cleanTitle,
};

const DESCRIPTION: Ask = {
  key: 'description',
  instruction:
    'Write the description shown under this post in listings and feeds: one or two plain sentences, ' +
    `at most ${String(DESCRIPTION_CHARACTERS)} characters and ${String(DESCRIPTION_WORDS)} words, ` +
    'that say what the post is about. No Markdown, and do not start with "This post".',
  style: () => [],
  tidy: fitDescription,
};

async function suggest(
  llm: LlmService,
  ask: Ask,
  { draft, recentTitles, signal }: PluginEditorContext,
): Promise<PluginEditorSuggestion> {
  if (draft.body.trim() === '' && draft.title.trim() === '') {
    return { ok: false, message: 'Write some of the post first. There is nothing to read yet.' };
  }
  const completion = await llm.complete<Record<typeof ask.key, string>>({
    messages: [
      {
        role: 'system',
        content: [
          `${ask.instruction} Write in the language with the tag "${draft.lang}". ` +
            'Use only what the post says; invent nothing.',
          ...ask.style(recentTitles),
        ].join('\n'),
      },
      { role: 'user', content: draftText(draft) },
    ],
    schema: {
      type: 'object',
      properties: { [ask.key]: { type: 'string' } },
      required: [ask.key],
      additionalProperties: false,
    },
    signal,
  });
  if (!completion.ok) return { ok: false, message: completion.message };
  const value = ask.tidy(completion.value[ask.key]);
  return value === ''
    ? { ok: false, message: 'The model answered with nothing. Try again.' }
    : { ok: true, value };
}

export default definePlugin({
  name: '@geekity/plugin-post-summary',
  version: VERSION,
  label: 'Post summary',
  description:
    'Suggests a title and a description for a post in the editor, from the language model ' +
    'the LLM plugin connects to, when the author asks.',
  hostApi: 1,
  requires: { [LLM]: '^0.2.0' },
  register(host) {
    host.editorAction({
      id: 'suggest-title',
      field: 'title',
      label: 'Suggest title',
      offers: offersTitle,
      suggest: (context) => suggest(host.use(LLM), TITLE, context),
    });
    host.editorAction({
      id: 'suggest-description',
      field: 'description',
      label: 'Suggest description',
      offers: offersDescription,
      suggest: (context) => suggest(host.use(LLM), DESCRIPTION, context),
    });
  },
});
