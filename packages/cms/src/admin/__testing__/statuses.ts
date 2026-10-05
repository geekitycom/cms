/**
 * The words the rows of a listing are marked with, whichever admin drew them:
 * the old admin's `admin-status` spans, or the DaisyUI admin's status badges
 * (decision-30). Goes with the old admin at the flip.
 */
export function statuses(html: string): string[] {
  return [...html.matchAll(/<span class="(?:admin-status|badge)\b[^"]*">([^<]*)<\/span>/g)].map(
    ([, word]) => word ?? '',
  );
}
