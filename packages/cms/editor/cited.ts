import { LOOK } from './look.ts';

const LINK_FIELD = 'link-url';

/**
 * Read the page an address field names once the address is entered or
 * pasted, and draw the server's card for it under the field, so the post is
 * saved with the page's name already known.
 */
export function citedPreviews(form: HTMLFormElement, endpoint: string): void {
  if (endpoint === '') return;
  for (const slot of form.querySelectorAll<HTMLElement>('[data-cited-for]')) {
    const input = document.getElementById(slot.dataset['citedFor'] ?? '');
    if (input instanceof HTMLInputElement) watch(form, endpoint, slot, input);
  }
}

function watch(
  form: HTMLFormElement,
  endpoint: string,
  slot: HTMLElement,
  input: HTMLInputElement,
): void {
  let asked = input.value.trim();

  async function read(): Promise<void> {
    const address = input.value.trim();
    if (address === asked) return;
    asked = address;
    if (address === '' || !input.checkValidity()) {
      slot.replaceChildren();
      return;
    }
    slot.replaceChildren(line('Reading the page…', LOOK.status));
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        body: new URLSearchParams({
          csrf_token: csrfToken(form),
          url: address,
          property: propertyOf(form, slot, input),
        }),
      });
      if (asked !== address) return;
      if (!response.ok) throw new Error(String(response.status));
      slot.innerHTML = await response.text();
    } catch {
      if (asked === address) {
        slot.replaceChildren(line('The page could not be read just now.', LOOK.statusError));
      }
    }
  }

  input.addEventListener('change', () => void read());
  input.addEventListener('paste', () => {
    setTimeout(() => void read(), 0);
  });
  if (input.name === LINK_FIELD) {
    for (const verb of form.querySelectorAll<HTMLInputElement>('input[name="link-verb"]')) {
      verb.addEventListener('change', () => {
        asked = '';
        void read();
      });
    }
  }
}

/** The property the field cites under: the Link form's chosen verb, or the field's own name. */
function propertyOf(form: HTMLFormElement, slot: HTMLElement, input: HTMLInputElement): string {
  if (input.name !== LINK_FIELD) return slot.dataset['citedProperty'] ?? input.name;
  const verb = form.querySelector<HTMLInputElement>('input[name="link-verb"]:checked');
  return verb?.value ?? slot.dataset['citedProperty'] ?? '';
}

function csrfToken(form: HTMLFormElement): string {
  const field = form.elements.namedItem('csrf_token');
  return field instanceof HTMLInputElement ? field.value : '';
}

function line(text: string, className: string): HTMLElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}
