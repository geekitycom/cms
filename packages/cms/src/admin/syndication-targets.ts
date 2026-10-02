/**
 * Posts > Syndication (TASK-218): the services a post can be sent to, as
 * `content/_data/syndicationTargets.json` declares them.
 *
 * The file stays the source of truth (decision-9, decision-26). The screen
 * reads it on every request and writes it back, so the editor's checkboxes,
 * Micropub's `q=syndicate-to` and the webmention sender, which all read the
 * file through `syndicationTargetsReader`, offer a change on the next request.
 *
 * Every entry the file holds is a panel, the broken ones too: an entry that
 * declares nothing is drawn with what is wrong with it and can be fixed or
 * removed here, which is the only place a site owner without a shell would
 * ever see it. A panel names its entry by position and by the JSON it held
 * when the page was drawn, and a save or a delete is refused when the file no
 * longer holds that JSON there, so a change made elsewhere in the meantime is
 * never overwritten or removed by mistake.
 */

import path from 'node:path';

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import {
  checkSyndicationTarget,
  repeatedIdProblem,
  SYNDICATION_TARGETS_FILE,
  syndicationEntries,
} from '../webmention/syndication.ts';
import type {
  SyndicationEntry,
  SyndicationTargetField,
  SyndicationTargetProblems,
} from '../webmention/syndication.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * The child of Posts the screen is. Under Posts, beside Categories and Tags,
 * because only a post is syndicated; not under Settings, whose children are
 * the settings pages and nothing else.
 */
export const SYNDICATION_TARGETS_CHILD = 'syndication';

/** Where the screen lives, and where one entry's panel saves to. */
export const SYNDICATION_TARGETS_PATH = `${ADMIN_PREFIX}/syndication`;

/** Where the Add form posts. */
export const ADD_SYNDICATION_TARGET_PATH = `${SYNDICATION_TARGETS_PATH}/add`;

/** Where a Remove button posts. */
export const DELETE_SYNDICATION_TARGET_PATH = `${SYNDICATION_TARGETS_PATH}/delete`;

/** The fields the forms on the screen submit. */
export const SYNDICATION_TARGET_FIELDS = {
  /** Which entry a save or a remove is about: its position in the file. */
  entry: 'entry',
  /** The entry's JSON when the page was drawn, so a changed file is not overwritten. */
  was: 'was',
  id: 'id',
  name: 'name',
  url: 'url',
  tag: 'tag',
  /** The language tags, separated by commas or spaces. */
  languages: 'languages',
} as const satisfies Record<string, string> & Record<SyndicationTargetField, string>;

/** One target as its form shows it: every field as text. */
type TargetForm = Record<SyndicationTargetField, string>;

/** One panel on the screen. */
interface Panel {
  /** What the panel's box ids start with: `target-0`, or `target-new` for Add. */
  key: string;
  index: number;
  /** The entry's JSON as read, carried back by its forms. */
  was: string;
  form: TargetForm;
  /** What was wrong with what was just typed into it. */
  problems: SyndicationTargetProblems;
  /** Why the file's entry declares nothing, when it does not. */
  fileProblems: readonly string[];
}

/** A save the form refused, to draw back into its panel. */
interface Refused {
  key: string;
  form: TargetForm;
  problems: SyndicationTargetProblems;
}

/** One entry as the file held it when the page was drawn. */
interface Held {
  index: number;
  was: string;
}

/** A save somebody asked for: a new entry, or one the file holds. */
type Save = { kind: 'add'; form: TargetForm } | ({ kind: 'save'; form: TargetForm } & Held);

/** What came of a change that was written, or why the file was left alone. */
interface Notice {
  kind: 'written' | 'unchanged';
  message: string;
}

/** What came of a save: a remove has no fields, so only a save is refused. */
type Outcome = Notice | { kind: 'refused'; problems: SyndicationTargetProblems };

/** What {@link mountSyndicationTargetsScreen} needs from the admin around it. */
export interface MountSyndicationTargetsOptions {
  render: AdminRender;
}

/**
 * Register the screen, the save of one entry, the add and the remove. Behind
 * the admin's guard like the settings pages: there is one role, so whoever is
 * signed in may change site settings, and anyone else is sent to the login
 * form.
 */
export function mountSyndicationTargetsScreen(
  app: Hono<GeekityEnv>,
  options: MountSyndicationTargetsOptions,
): void {
  const { render } = options;

  app.get(SYNDICATION_TARGETS_PATH, (c) => render(c, ADMIN_TEMPLATES.syndication, screen(c)));

  app.post(SYNDICATION_TARGETS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const form = formOf(body);
    const index = indexOf(body);
    return answer(c, `target-${String(index)}`, form, {
      kind: 'save',
      form,
      index,
      was: text(body[SYNDICATION_TARGET_FIELDS.was]),
    });
  });

  app.post(ADD_SYNDICATION_TARGET_PATH, async (c) => {
    const form = formOf(await c.req.parseBody());
    return answer(c, 'target-new', form, { kind: 'add', form });
  });

  app.post(DELETE_SYNDICATION_TARGET_PATH, async (c) => {
    const body = await c.req.parseBody();
    const notice = await removeTarget(c.var.config.contentDir, {
      index: indexOf(body),
      was: text(body[SYNDICATION_TARGET_FIELDS.was]),
    });
    flash(c, notice.kind === 'written' ? 'notice' : 'error', notice.message);
    return c.redirect(SYNDICATION_TARGETS_PATH, 303);
  });

  async function answer(
    c: Context<GeekityEnv>,
    key: string,
    form: TargetForm,
    requested: Save,
  ): Promise<Response> {
    const outcome = await saveTarget(c.var.config.contentDir, requested);
    if (outcome.kind === 'refused') {
      c.status(400);
      return render(
        c,
        ADMIN_TEMPLATES.syndication,
        screen(c, { key, form, problems: outcome.problems }),
      );
    }
    flash(c, outcome.kind === 'written' ? 'notice' : 'error', outcome.message);
    return c.redirect(SYNDICATION_TARGETS_PATH, 303);
  }

  function screen(c: Context<GeekityEnv>, refused?: Refused): Record<string, unknown> {
    const fileText = readFileIfPresentSync(targetsFile(c.var.config.contentDir));
    const read = fileText === undefined ? { entries: [] } : syndicationEntries(fileText);
    const typed = (key: string): Refused | undefined =>
      refused?.key === key ? refused : undefined;

    const panels =
      'problem' in read
        ? []
        : read.entries.map((entry, index): Panel => {
            const key = `target-${String(index)}`;
            const shown = typed(key);
            return {
              key,
              index,
              was: JSON.stringify(entry.raw),
              form: shown?.form ?? formFromRaw(entry.raw),
              problems: shown?.problems ?? {},
              fileProblems: 'problems' in entry ? entry.problems : [],
            };
          });
    const adding = typed('target-new');

    return {
      section: 'posts',
      child: SYNDICATION_TARGETS_CHILD,
      heading: 'Syndication',
      file: SYNDICATION_TARGETS_FILE,
      fileProblem: 'problem' in read ? read.problem : '',
      saveUrl: SYNDICATION_TARGETS_PATH,
      addUrl: ADD_SYNDICATION_TARGET_PATH,
      deleteUrl: DELETE_SYNDICATION_TARGET_PATH,
      fields: SYNDICATION_TARGET_FIELDS,
      panels,
      adding: {
        key: 'target-new',
        form: adding?.form ?? emptyForm(),
        problems: adding?.problems ?? {},
      },
      refusedKey: refused?.key ?? '',
      hasProblems: refused !== undefined,
    };
  }
}

/**
 * Run `apply` on the file's entries under its lock, as re-read inside it, or
 * leave the file alone when it is not a list or no longer holds `held` where
 * the page drew it.
 */
async function underLock<T>(
  file: string,
  held: Held | undefined,
  apply: (entries: SyndicationEntry[]) => T,
): Promise<T | Notice> {
  return await withFileLock(file, (): T | Notice => {
    const current = readFileIfPresentSync(file);
    const read = current === undefined ? { entries: [] } : syndicationEntries(current);
    if ('problem' in read) {
      return {
        kind: 'unchanged',
        message: `Nothing was changed. ${read.problem} Fix or remove the file by hand first, since saving here would lose what it holds.`,
      };
    }
    if (held !== undefined && JSON.stringify(read.entries[held.index]?.raw) !== held.was) {
      return {
        kind: 'unchanged',
        message: `Nothing was changed. ${SYNDICATION_TARGETS_FILE} changed since this page was drawn, so here is what it holds now.`,
      };
    }
    return apply([...read.entries]);
  });
}

async function removeTarget(contentDir: string, held: Held): Promise<Notice> {
  const file = targetsFile(contentDir);
  return await underLock(file, held, (entries): Notice => {
    const [removed] = entries.splice(held.index, 1);
    write(file, entries);
    return { kind: 'written', message: `${label(removed)} was removed.` };
  });
}

/**
 * Check a save by the rule the file is read by, plus an id no other entry
 * declares, and write it only when it passes.
 */
async function saveTarget(contentDir: string, requested: Save): Promise<Outcome> {
  const file = targetsFile(contentDir);
  const held = requested.kind === 'save' ? requested : undefined;
  return await underLock(file, held, (entries): Outcome => {
    const others = entries.filter((_, index) => index !== held?.index);
    const checked = checkSyndicationTarget(recordFromForm(requested.form));
    const id = requested.form.id.trim();
    const problems: SyndicationTargetProblems =
      'problems' in checked ? { ...checked.problems } : {};
    if (others.some((entry) => 'target' in entry && entry.target.id === id)) {
      problems.id ??= repeatedIdProblem(id);
    }
    if ('problems' in checked || Object.keys(problems).length > 0) {
      return { kind: 'refused', problems };
    }

    const { target } = checked;
    if (held === undefined) {
      write(file, [...entries, { raw: target, target }]);
      return {
        kind: 'written',
        message: `${target.name} was added. The editor and Micropub clients offer it now.`,
      };
    }
    const previous = entries[held.index]?.raw;
    const kept = isRecord(previous) ? withoutTargetKeys(previous) : {};
    entries[held.index] = { raw: { ...target, ...kept }, target };
    write(file, entries);
    return { kind: 'written', message: `${target.name} was saved.` };
  });
}

function write(file: string, entries: readonly SyndicationEntry[]): void {
  writeFileAtomicallySync(
    file,
    `${JSON.stringify(
      entries.map((entry) => entry.raw),
      null,
      2,
    )}\n`,
  );
}

function targetsFile(contentDir: string): string {
  return path.join(contentDir, ...SYNDICATION_TARGETS_FILE.split('/'));
}

const TARGET_KEYS: readonly SyndicationTargetField[] = ['id', 'name', 'url', 'tag', 'languages'];

/** What an entry holds beyond a target's own keys, kept across a save. */
function withoutTargetKeys(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !(TARGET_KEYS as readonly string[]).includes(key)),
  );
}

/**
 * A form as an entry the file could hold. An empty tag or languages box is a
 * key left out, which is how the file says "none".
 */
function recordFromForm(form: TargetForm): Record<string, unknown> {
  const tag = form.tag.trim();
  const languages = form.languages.split(/[\s,]+/).filter((item) => item !== '');
  return {
    id: form.id.trim(),
    name: form.name,
    url: form.url.trim(),
    ...(tag === '' ? {} : { tag }),
    ...(languages.length === 0 ? {} : { languages }),
  };
}

/** What a file's entry shows in its boxes, valid or not. */
function formFromRaw(raw: unknown): TargetForm {
  const record = isRecord(raw) ? raw : {};
  const shown = (value: unknown): string =>
    value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const languages = record['languages'];
  return {
    id: shown(record['id']),
    name: shown(record['name']),
    url: shown(record['url']),
    tag: shown(record['tag']),
    languages:
      Array.isArray(languages) && languages.every((item) => typeof item === 'string')
        ? languages.join(', ')
        : shown(languages),
  };
}

function emptyForm(): TargetForm {
  return { id: '', name: '', url: '', tag: '', languages: '' };
}

function formOf(body: Record<string, unknown>): TargetForm {
  return {
    id: text(body[SYNDICATION_TARGET_FIELDS.id]),
    name: text(body[SYNDICATION_TARGET_FIELDS.name]),
    url: text(body[SYNDICATION_TARGET_FIELDS.url]),
    tag: text(body[SYNDICATION_TARGET_FIELDS.tag]),
    languages: text(body[SYNDICATION_TARGET_FIELDS.languages]),
  };
}

/** The entry a form names, or -1, which names none and so is refused as changed. */
function indexOf(body: Record<string, unknown>): number {
  const value = text(body[SYNDICATION_TARGET_FIELDS.entry]);
  return /^\d+$/.test(value) ? Number(value) : -1;
}

/** What a flash calls an entry: its name, valid or not. */
function label(entry: SyndicationEntry | undefined): string {
  const raw = entry?.raw;
  const name = isRecord(raw) ? raw['name'] : undefined;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : 'The entry';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
