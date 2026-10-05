import assert from 'node:assert/strict';

/** The screen itself: what is inside `<main>`. */
export function screenOf(html: string): string {
  return /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
}

/** Markup as the words it reads as. */
export function text(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/&amp;/g, '&')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** The names in an opening tag's class attribute. */
export function classesOf(tag: string): string[] {
  return (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

/** Every class token the markup carries. */
export function classTokens(html: string): string[] {
  return [...html.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
    (value ?? '').split(/\s+/).filter(Boolean),
  );
}

/** Every class token outside the admin bar, whose shadow root keeps classes of its own. */
export function classesOutsideTheBar(html: string): string[] {
  return classTokens(html.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, ''));
}

/** The tabs a screen draws: each link's words, and whether it is the current one. */
export function tabs(html: string): { label: string; current: boolean }[] {
  const nav = /<nav class="tabs tabs-box" aria-label="[^"]+">([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(nav, 'the filters are a labelled tabs nav');
  return [
    ...(nav[1] ?? '').matchAll(
      /<a class="tab( tab-active)?" href="[^"]*"( aria-current="page")?>([^<]*)<\/a>/g,
    ),
  ].map(([, active, current, label]) => {
    assert.equal(
      active !== undefined,
      current !== undefined,
      `${label} is marked for both eye and ear`,
    );
    return { label: (label ?? '').trim(), current: current !== undefined };
  });
}

/** The pagination macro's group, or `''` when the screen has none. */
export function pagination(html: string): string {
  return (
    /<nav aria-label="Pages">\s*<div class="join">([\s\S]*?)<\/div>\s*<\/nav>/.exec(html)?.[1] ?? ''
  );
}

export function titleCell(html: string, title: string): string {
  return (
    [...html.matchAll(/<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, cell]) => cell ?? '')
      .find((cell) => cell.includes(`>${title}</a>`)) ?? ''
  );
}

export function assertInOrder(html: string, marks: (string | RegExp)[]): void {
  let from = 0;
  for (const mark of marks) {
    const rest = html.slice(from);
    const at = typeof mark === 'string' ? rest.indexOf(mark) : rest.search(mark);
    assert.ok(at > -1, `${String(mark)} follows what came before it in: ${html}`);
    from += at + 1;
  }
}
