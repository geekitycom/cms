/**
 * The banner that offers an autosaved copy back when the editor opens
 * (decision-62). The server renders it for its own copy; this file adds the
 * browser's copy when that one is newer, holds the autosave until the writer
 * chooses, and does Discard without leaving the page.
 *
 * Restore always goes through the server: a browser copy is first posted as
 * the server's copy, then the editor is reopened with `restore=1`, which fills
 * every field, CodeMirror included, the way the no-JS Resume does.
 */
import { readLocalCopy, resumeOffer } from '../src/admin/autosave-client.ts';
import { formatInTimezone } from '../src/admin/formatting.ts';
import type {
  Autosave,
  KeyValueStorage,
  LocalCopy,
  ResumeOffer,
  SendOutcome,
  Snapshot,
} from '../src/admin/autosave-client.ts';
import { LOOK } from './look.ts';

/** The banner's id, on the server's and on this file's. */
export const RESUME_ID = 'autosave-resume';

/** Which copy, if any, the page should offer back. */
export function findOffer(
  tools: HTMLElement,
  storage: KeyValueStorage | undefined,
  storageKey: string,
  current: Snapshot,
): ResumeOffer {
  return resumeOffer({
    server: tools.dataset['autosaveCopySavedAt'],
    offered: document.getElementById(RESUME_ID) !== null,
    local: storage === undefined ? undefined : readLocalCopy(storage, storageKey),
    fileTime: tools.dataset['autosaveFileTime'] ?? '',
    current,
  });
}

export interface OfferBack {
  readonly form: HTMLFormElement;
  readonly tools: HTMLElement;
  readonly offer: Exclude<ResumeOffer, { from: 'none' }>;
  readonly controller: Autosave;
  readonly storage: KeyValueStorage | undefined;
  readonly storageKey: string;
  /** Post fields as the server's copy of this key. */
  readonly keep: (fields: Snapshot) => Promise<SendOutcome>;
}

/** Show the offer and wire its Restore and Discard. The controller stays held until one is chosen. */
export function offerBack(options: OfferBack): void {
  const { form, offer } = options;
  let banner = document.getElementById(RESUME_ID);
  if (offer.from === 'browser') {
    const built = browserBanner(form, options.tools, offer.copy, offer.changedSince);
    if (banner === null) form.before(built);
    else banner.replaceWith(built);
    banner = built;
    built.querySelector('button[data-restore]')?.addEventListener('click', () => {
      void restoreFromBrowser(options, built, offer.copy);
    });
  }
  if (banner === null) return;
  const shown = banner;
  shown.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void discard(options, shown, event.currentTarget as HTMLFormElement);
  });
}

async function restoreFromBrowser(
  options: OfferBack,
  banner: HTMLElement,
  copy: LocalCopy,
): Promise<void> {
  const outcome = await options.keep(copy.fields);
  if (outcome.kind !== 'saved') {
    say(banner, 'The server could not take the copy, so it cannot be restored yet. Try again.');
    return;
  }
  options.storage?.removeItem(options.storageKey);
  const address = new URL(location.href);
  address.searchParams.set('restore', '1');
  location.assign(address);
}

async function discard(
  options: OfferBack,
  banner: HTMLElement,
  form: HTMLFormElement,
): Promise<void> {
  const data = new FormData(form);
  // Without a return path the endpoint answers JSON rather than a redirect.
  data.delete('return');
  let discarded = false;
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
      redirect: 'manual',
    });
    discarded = response.ok;
  } catch {
    // Unreachable: the banner stays and says so.
  }
  if (!discarded) {
    say(banner, 'The unsaved changes could not be discarded. Try again.');
    return;
  }
  options.storage?.removeItem(options.storageKey);
  banner.remove();
  options.controller.release();
  focusWriting(options.form);
}

function browserBanner(
  form: HTMLFormElement,
  tools: HTMLElement,
  copy: LocalCopy,
  changedSince: boolean,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.id = RESUME_ID;
  wrapper.className = LOOK.resume;
  wrapper.dataset['savedAt'] = copy.savedAt;

  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.setAttribute('aria-labelledby', `${RESUME_ID}-message`);
  alert.className = LOOK.resumeAlert;

  const message = document.createElement('p');
  message.id = `${RESUME_ID}-message`;
  const time = document.createElement('time');
  time.dateTime = copy.savedAt;
  time.textContent = formatInTimezone(copy.savedAt, tools.dataset['autosaveTimezone'] ?? 'UTC');
  const noun = tools.dataset['kind'] === 'page' ? 'page' : 'post';
  message.append(
    'Unsaved changes from ',
    time,
    ', kept in this browser.',
    changedSince
      ? ` This ${noun} has changed since. Restore shows both versions side by side.`
      : '',
  );

  const actions = document.createElement('div');
  actions.className = LOOK.resumeActions;

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = LOOK.resumeRestore;
  restore.dataset['restore'] = '';
  restore.textContent = 'Restore';

  const discardForm = document.createElement('form');
  discardForm.method = 'post';
  discardForm.action = tools.dataset['autosaveDiscardUrl'] ?? '';
  for (const name of ['csrf_token', 'autosave']) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    const source = form.elements.namedItem(name);
    field.value = source instanceof HTMLInputElement ? source.value : '';
    discardForm.append(field);
  }
  const discardButton = document.createElement('button');
  discardButton.type = 'submit';
  discardButton.className = LOOK.resumeDiscard;
  discardButton.textContent = 'Discard';
  discardForm.append(discardButton);

  actions.append(restore, discardForm);
  alert.append(message, actions);
  wrapper.append(alert);
  return wrapper;
}

/** Say why a choice did not go through, inside the banner so it is read out. */
function say(banner: HTMLElement, text: string): void {
  let line = banner.querySelector<HTMLElement>('[data-resume-problem]');
  if (line === null) {
    line = document.createElement('p');
    line.dataset['resumeProblem'] = '';
    line.className = LOOK.statusError;
    banner.querySelector('[role="alert"]')?.append(line);
  }
  line.textContent = text;
}

/** With the banner gone, put the writer back in the title, or in the body. */
function focusWriting(form: HTMLFormElement): void {
  const title = form.elements.namedItem('title');
  if (title instanceof HTMLInputElement) {
    title.focus();
    return;
  }
  form.querySelector<HTMLElement>('.cm-content')?.focus();
}
