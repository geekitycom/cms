import assert from 'node:assert/strict';

/** Every control the form would post, as a browser builds the form data. */
export function fieldsOf(html: string): [string, string][] {
  const form =
    /<form\b[^>]*>\s*<input type="hidden" name="csrf_token"[^>]*>\s*<input type="hidden" name="hash"[\s\S]*?<\/form>/.exec(
      html,
    )?.[0];
  assert.ok(form !== undefined, 'the page carries the editor form');
  const fields: [string, string][] = [];
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    const name = /\sname="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) continue;
    const type = /\stype="([^"]*)"/.exec(tag)?.[1] ?? 'text';
    if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/.test(tag)) continue;
    if (type === 'file' || type === 'submit') continue;
    fields.push([name, decode(/\svalue="([^"]*)"/.exec(tag)?.[1] ?? '')]);
  }
  for (const [, name, value] of form.matchAll(
    /<textarea\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g,
  )) {
    fields.push([name ?? '', decode(value ?? '')]);
  }
  for (const [, name, options] of form.matchAll(
    /<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g,
  )) {
    const selected = /<option value="([^"]*)"[^>]*\sselected/.exec(options ?? '')?.[1] ?? '';
    fields.push([name ?? '', decode(selected)]);
  }
  return fields.sort(([a], [b]) => a.localeCompare(b));
}

/** Where the editor form posts. */
export function saveUrlOf(html: string): string | undefined {
  return /<form\b[^>]*\baction="([^"]+)"[^>]*>\s*<input type="hidden" name="csrf_token"[^>]*>\s*<input type="hidden" name="hash"/.exec(
    html,
  )?.[1];
}

/** The element whose opening tag starts at `start`, up to its matching close. */
export function elementAt(html: string, start: number): string {
  const name = /^<([a-z]+)/.exec(html.slice(start))?.[1] ?? 'div';
  let depth = 0;
  for (const match of html.slice(start).matchAll(new RegExp(`<${name}\\b[^>]*>|</${name}>`, 'g'))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, start + match.index + match[0].length);
  }
  return html.slice(start);
}

/** The first card of a cited page in `html`: the card around the first Remove
 *  toggle. */
export function citedCard(html: string): string | undefined {
  const toggle = html.search(/<input\b[^>]*\btype="checkbox"[^>]*\bname="preview"/);
  if (toggle === -1) return undefined;
  const opens = [...html.slice(0, toggle).matchAll(/<div class="card\b[^"]*">/g)];
  const at = opens.at(-1)?.index;
  return at === undefined ? undefined : elementAt(html, at);
}

function decode(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
