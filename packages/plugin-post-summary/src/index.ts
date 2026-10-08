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
import type { LlmFailure, LlmService } from '@geekity/plugin-llm';

import { VERSION } from './version.ts';

const LLM = '@geekity/plugin-llm';

/**
 * The longest description, in characters: where the default theme's listings
 * cut a post's summary (`truncate(280)` in `partials/post-list.njk`).
 */
export const DESCRIPTION_CHARACTERS = 280;

/** The longest description, in words: where a feed cuts an excerpt (WordPress's 55). */
export const DESCRIPTION_WORDS = 55;

/** The longest title asked for, in characters. */
const TITLE_CHARACTERS = 90;

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

/** What goes wrong in plain words, with where to put it right. */
export function failureWords(error: LlmFailure): string {
  switch (error.kind) {
    case 'unconfigured':
      return 'No language model is set up yet. Add an API key on Plugins > LLM, then try again.';
    case 'unauthorized':
      return 'The language model provider refused the API key. Check the key on Plugins > LLM.';
    case 'no-credit':
      return 'The account behind the API key has no credit left. Add credit with the provider, then try again.';
    case 'rate-limited':
      return error.retryAfter === undefined
        ? 'The provider is limiting requests. Try again shortly.'
        : `The provider is limiting requests. Try again in ${String(error.retryAfter)} seconds.`;
    case 'unavailable':
      return 'The provider could not answer just now. Try again in a while.';
    case 'rejected':
      return 'The provider refused the request. The model chosen on Plugins > LLM may not give structured answers; choose another model there.';
    case 'invalid-output':
      return 'The model’s answer was not usable. Try again, or choose another model on Plugins > LLM.';
    case 'timeout':
      return `The model did not answer within ${String(error.seconds)} seconds. Try again.`;
    case 'aborted':
      return 'The request was stopped before the answer came.';
    case 'network':
      return 'The language model provider could not be reached. Check the base URL on Plugins > LLM.';
  }
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
  readonly tidy: (text: string) => string;
}

const TITLE: Ask = {
  key: 'title',
  instruction:
    `Suggest a title for this blog post: specific, plain and under ${String(TITLE_CHARACTERS)} characters, ` +
    'in the words a reader would search for. No quotation marks, no full stop at the end, no clickbait.',
  tidy: cleanTitle,
};

const DESCRIPTION: Ask = {
  key: 'description',
  instruction:
    'Write the description shown under this post in listings and feeds: one or two plain sentences, ' +
    `at most ${String(DESCRIPTION_CHARACTERS)} characters and ${String(DESCRIPTION_WORDS)} words, ` +
    'that say what the post is about. No Markdown, and do not start with "This post".',
  tidy: fitDescription,
};

async function suggest(
  llm: LlmService,
  ask: Ask,
  { draft, signal }: PluginEditorContext,
): Promise<PluginEditorSuggestion> {
  if (draft.body.trim() === '' && draft.title.trim() === '') {
    return { ok: false, message: 'Write some of the post first. There is nothing to read yet.' };
  }
  const completion = await llm.complete<Record<typeof ask.key, string>>({
    messages: [
      {
        role: 'system',
        content:
          `${ask.instruction} Write in the language with the tag "${draft.lang}". ` +
          'Use only what the post says; invent nothing.',
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
  if (!completion.ok) return { ok: false, message: failureWords(completion.error) };
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
  requires: { [LLM]: '^0.1.0' },
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
