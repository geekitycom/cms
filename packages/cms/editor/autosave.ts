import { autosave, localCopyKey, statusMessage } from '../src/admin/autosave-client.ts';
import type { Autosave, SendOutcome, Snapshot } from '../src/admin/autosave-client.ts';
import { LOOK } from './look.ts';
import { findOffer, offerBack } from './resume.ts';

export const AUTOSAVE_STATUS_ID = 'editor-autosave-status';

const MINTED = /^new-[0-9a-f]{32}$/;

export function startAutosave(form: HTMLFormElement, tools: HTMLElement): Autosave | undefined {
  const url = tools.dataset['autosaveUrl'] ?? '';
  const userId = tools.dataset['autosaveUser'] ?? '';
  const keyField = form.elements.namedItem('autosave');
  const key = keyField instanceof HTMLInputElement ? keyField.value : '';
  if (url === '' || userId === '' || key === '') return undefined;

  const storage = browserStorage();
  const site = location.origin;
  if (storage !== undefined) {
    for (const cleared of clearedKeys(tools))
      storage.removeItem(localCopyKey(site, userId, cleared));
  }
  if (MINTED.test(key)) keepIdInUrl(form, key);

  const storageKey = localCopyKey(site, userId, key);
  const offer = findOffer(tools, storage, storageKey, snapshotOf(form));

  const controller = autosave({
    key,
    storageKey,
    storage,
    held: offer.from !== 'none',
    read: () => snapshotOf(form),
    send: (snapshot) => send(url, payload(form, snapshot)),
    beacon: (snapshot) => navigator.sendBeacon(url, payload(form, snapshot)),
    now: () => new Date(),
  });

  const status = document.createElement('p');
  status.id = AUTOSAVE_STATUS_ID;
  status.className = LOOK.status;
  status.setAttribute('role', 'status');
  status.dataset['state'] = 'idle';
  tools.append(status);
  controller.subscribe((next) => {
    status.dataset['state'] = next.state;
    status.className = next.state === 'server' ? LOOK.status : LOOK.statusError;
    status.textContent = statusMessage(next, clockTime);
  });

  form.addEventListener('input', () => {
    controller.changed();
  });
  form.addEventListener('change', () => {
    controller.changed();
  });
  form.addEventListener('focusout', () => {
    controller.flush();
  });
  form.addEventListener('submit', () => {
    controller.submitting();
  });
  window.addEventListener('pagehide', () => {
    controller.leave();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!controller.unsaved()) return;
    event.preventDefault();
    // Chrome before 119 and Safari only prompt when this is set.
    event.returnValue = '';
  });

  if (offer.from !== 'none') {
    offerBack({
      form,
      tools,
      offer,
      controller,
      storage,
      storageKey,
      keep: (fields) => send(url, payload(form, fields)),
    });
  }

  return controller;
}

function snapshotOf(form: HTMLFormElement): Snapshot {
  const fields: [string, string][] = [];
  for (const [name, value] of new FormData(form)) {
    if (name !== 'csrf_token' && typeof value === 'string') fields.push([name, value]);
  }
  return fields;
}

function payload(form: HTMLFormElement, snapshot: Snapshot): FormData {
  const data = new FormData();
  const token = form.elements.namedItem('csrf_token');
  data.set('csrf_token', token instanceof HTMLInputElement ? token.value : '');
  for (const [name, value] of snapshot) data.append(name, value);
  return data;
}

async function send(url: string, body: FormData): Promise<SendOutcome> {
  let response: Response;
  try {
    // An expired session is answered with a redirect to the login form, which
    // a followed fetch would report as a 200.
    response = await fetch(url, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      redirect: 'manual',
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
    return { kind: 'signed-out' };
  }
  if (response.status >= 500) return { kind: 'unreachable' };

  const result = (await response.json().catch(() => ({}))) as {
    savedAt?: unknown;
    error?: unknown;
  };
  if (response.ok) {
    return typeof result.savedAt === 'string'
      ? { kind: 'saved', savedAt: result.savedAt }
      : { kind: 'unreachable' };
  }
  return {
    kind: 'refused',
    message:
      typeof result.error === 'string'
        ? result.error
        : `The autosave was refused (${String(response.status)}).`,
  };
}

function keepIdInUrl(form: HTMLFormElement, key: string): void {
  const address = new URL(location.href);
  address.searchParams.set('autosave', key);
  const kind = form.elements.namedItem('kind');
  if (kind instanceof HTMLInputElement && !address.searchParams.has('kind')) {
    address.searchParams.set('kind', kind.value);
  }
  history.replaceState(history.state, '', address);
}

function clearedKeys(tools: HTMLElement): string[] {
  try {
    const parsed: unknown = JSON.parse(tools.dataset['autosaveCleared'] ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function clockTime(at: Date): string {
  return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
