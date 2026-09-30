import assert from 'node:assert/strict';

/**
 * What a refused form tells assistive technology, read out of its HTML.
 *
 * Every form on the site, public or admin, keeps one contract when it comes
 * back refused (TASK-142): a summary with `role="alert"` that takes focus on
 * load, headed by what went wrong and linking to every field that needs
 * putting right; and on each of those fields `aria-invalid="true"` and an
 * `aria-describedby` naming the message about it. This asserts the contract
 * and hands back what the summary says, so a test only has to name the fields
 * it expected.
 */
export interface TiedErrors {
  /** The summary's heading, as text. */
  heading: string;
  /** The ids the summary links to, in page order. */
  links: string[];
  /** The ids of the controls marked `aria-invalid="true"`, in page order. */
  invalid: string[];
}

/** The attributes of one opening tag. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, value] of tag.matchAll(/\s([a-z-]+)(?:="([^"]*)")?/g)) {
    if (name !== undefined) attributes.set(name, value ?? '');
  }
  return attributes;
}

/** The text of the element with this id, markup stripped, or `undefined`. */
function textOfId(html: string, id: string): string | undefined {
  const match = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2]?.replaceAll(/<[^>]*>/g, '').trim();
}

export function tiedErrors(html: string): TiedErrors {
  const alerts = [...html.matchAll(/<([a-z]+)\b[^>]*\brole="alert"[^>]*>/g)];
  assert.equal(alerts.length, 1, `one error summary is on the page: ${html}`);
  const [open, element] = alerts[0] ?? [];
  assert.ok(open !== undefined && element !== undefined);

  const summaryAttributes = attributesOf(open);
  assert.equal(summaryAttributes.get('tabindex'), '-1', `the summary can take focus: ${open}`);
  assert.ok(summaryAttributes.has('autofocus'), `the summary takes focus on load: ${open}`);

  const start = html.indexOf(open);
  assert.equal(
    html.search(/<[a-z]+\b[^>]*\sautofocus[\s/>]/),
    start,
    'no control earlier in the page takes focus ahead of the summary',
  );

  const end = html.indexOf(`</${element}>`, start);
  const summary = html.slice(start, end);

  const headingId = summaryAttributes.get('aria-labelledby');
  assert.ok(headingId !== undefined, `the summary is labelled by its heading: ${open}`);
  const heading = textOfId(summary, headingId);
  assert.ok(heading, `the summary's heading ${headingId} says something: ${summary}`);

  const links = [...summary.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/g)].map(([, id]) => id ?? '');

  const invalid: string[] = [];
  for (const [tag] of html.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)) {
    const attributes = attributesOf(tag);
    if (!attributes.has('aria-invalid')) {
      assert.ok(!attributes.has('aria-describedby'), `a valid control points at no error: ${tag}`);
      continue;
    }

    assert.equal(attributes.get('aria-invalid'), 'true', tag);
    const id = attributes.get('id');
    assert.ok(id, `an invalid control has an id to link to: ${tag}`);
    const describedBy = attributes.get('aria-describedby');
    assert.ok(describedBy, `an invalid control names its message: ${tag}`);
    const message = textOfId(html, describedBy);
    assert.ok(message, `${id}'s message ${describedBy} is on the page and says something`);
    invalid.push(id);
  }

  assert.deepEqual(links, invalid, 'the summary links to exactly the invalid fields, in order');
  return { heading, links, invalid };
}
