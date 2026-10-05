import type { FlashKind } from '../store.ts';

/**
 * The flash messages on a page, whichever admin drew them: the old admin's
 * `<p class="admin-flash admin-flash-KIND">`, or the DaisyUI admin's status
 * alert in its kind's colour (decision-30). Goes with the old admin at the
 * flip.
 */
const COLOURS: Readonly<Record<string, FlashKind>> = {
  success: 'notice',
  warning: 'warning',
  error: 'error',
};

export function flashes(html: string): { kind: FlashKind; message: string }[] {
  const old = [
    ...html.matchAll(/<p class="admin-flash admin-flash-(\w+)" role="status">([\s\S]*?)<\/p>/g),
  ];
  const daisyui = [
    ...html.matchAll(/<div role="status" class="alert alert-(\w+)">\s*<span>([\s\S]*?)<\/span>/g),
  ];
  return [
    ...old.map(([, kind, message]) => ({ kind: kind as FlashKind, message: message ?? '' })),
    ...daisyui.map(([, colour, message]) => ({
      kind: COLOURS[colour ?? ''] ?? 'notice',
      message: message ?? '',
    })),
  ];
}
