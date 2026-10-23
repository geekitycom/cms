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

export const RESUME_ID = 'autosave-resume';

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
  readonly keep: (fields: Snapshot) => Promise<SendOutcome>;
}

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
  const discardForm = shown.querySelector('form');
  if (discardForm === null) return;
  discardForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void discard(options, shown, discardForm);
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
  const discarded = await fetch(options.tools.dataset['autosaveDiscardUrl'] ?? '', {
    method: 'POST',
    body: new FormData(form),
    credentials: 'same-origin',
    redirect: 'manual',
  }).then(
    (response) => response.ok,
    () => false,
  );
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

function focusWriting(form: HTMLFormElement): void {
  const title = form.elements.namedItem('title');
  if (title instanceof HTMLInputElement) {
    title.focus();
    return;
  }
  form.querySelector<HTMLElement>('.cm-content')?.focus();
}
