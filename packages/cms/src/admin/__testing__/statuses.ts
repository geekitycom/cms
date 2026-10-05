/** The words the rows of a listing are marked with: their status badges. */
export function statuses(html: string): string[] {
  return [...html.matchAll(/<span class="badge\b[^"]*">([^<]*)<\/span>/g)].map(
    ([, word]) => word ?? '',
  );
}
