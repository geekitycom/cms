import type { FlashKind } from '../store.ts';

/** The kind of flash each alert colour draws. */
const COLOURS: Readonly<Record<string, FlashKind>> = {
  success: 'notice',
  warning: 'warning',
  error: 'error',
};

/** The flash messages on a page: status alerts in their kind's colour. */
export function flashes(html: string): { kind: FlashKind; message: string }[] {
  return [
    ...html.matchAll(/<div role="status" class="alert alert-(\w+)">\s*<span>([\s\S]*?)<\/span>/g),
  ].map(([, colour, message]) => ({
    kind: COLOURS[colour ?? ''] ?? 'notice',
    message: message ?? '',
  }));
}
