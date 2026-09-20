import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { createAdminTemplateEnvironment, PACKAGED_ADMIN_DIR } from './templates.ts';

/**
 * `admin/components/fields.njk`: the one place a labelled box is written.
 *
 * The admin's screens used to spell out every `<label for>`, control, hint and
 * error by hand, which is how /admin/users ended up with hidden labels nobody
 * else used (TASK-97). These tests are about the macro rather than any screen:
 * that each one binds its label to its control, writes the error before the
 * hint, leaves out the parts it was given nothing for, and passes through the
 * attributes the real fields need. A screen that drifts from this is a screen
 * that stopped using it.
 */

const environment = createAdminTemplateEnvironment({ noCache: true });

/** Render one call of the partial's macros, with nothing else around it. */
function render(body: string, context: Record<string, unknown> = {}): string {
  return environment.renderString(`{% import "components/fields.njk" as field %}${body}`, context);
}

/** The opening tag of the first `<input>`, `<select>` or `<textarea>`. */
function control(html: string): string {
  const tag = /<(?:input|textarea|select)\b[^>]*>/.exec(html)?.[0];
  assert.ok(tag !== undefined, `there is a control in: ${html}`);
  return tag;
}

/** The `<label for="…">` bound to that id, if there is one. */
function labelFor(html: string, id: string): string | undefined {
  return new RegExp(`<label[^>]*\\bfor="${id}"[^>]*>([^<]*)`).exec(html)?.[0];
}

describe('every field macro', () => {
  const calls: readonly { what: string; body: string }[] = [
    { what: 'text', body: `{{ field.text('f', 'a_name', 'A label'{args}) }}` },
    { what: 'password', body: `{{ field.password('f', 'a_name', 'A label'{args}) }}` },
    { what: 'textarea', body: `{{ field.textarea('f', 'a_name', 'A label'{args}) }}` },
    {
      what: 'select',
      body: `{% call field.select('f', 'a_name', 'A label'{args}) %}<option value="one">One</option>{% endcall %}`,
    },
    { what: 'checkbox', body: `{{ field.checkbox('f', 'a_name', 'A label'{args}) }}` },
  ];

  /** One macro's call with the given keyword arguments spliced in. */
  function callWith(body: string, args = ''): string {
    return body.replace('{args}', args);
  }

  for (const { what, body } of calls) {
    it(`${what} binds a label the eye can read to its control by id`, () => {
      const html = render(callWith(body));

      const label = labelFor(html, 'f');
      assert.ok(label !== undefined, `${what} has a label bound to the control`);
      assert.match(label, /A label/, `${what}'s label carries the words it was given`);
      assert.doesNotMatch(label, /admin-visually-hidden/, `${what}'s label is not hidden`);
      assert.match(control(html), /\bid="f"/, `${what}'s control carries the id`);
      assert.match(control(html), /\bname="a_name"/, `${what}'s control carries the name`);
    });

    it(`${what} writes nothing below the control when there is nothing to say`, () => {
      const html = render(callWith(body));

      assert.doesNotMatch(html, /admin-hint/, `${what} has no empty hint`);
      assert.doesNotMatch(html, /admin-field-error/, `${what} has no empty error`);
    });

    it(`${what} writes the hint where it is given one`, () => {
      const html = render(callWith(body, `, hint='What this is for.'`));

      assert.match(html, /<p class="admin-hint">What this is for\.<\/p>/);
    });

    it(`${what} writes the field error where the form says something went wrong`, () => {
      const html = render(callWith(body, `, error='That is not a URL.'`));

      assert.match(html, /<p class="admin-field-error">That is not a URL\.<\/p>/);
    });

    it(`${what} puts the error above the hint, next to the box it is about`, () => {
      const html = render(callWith(body, `, error='Wrong.', hint='A standing note.'`));

      assert.ok(
        html.indexOf('admin-field-error') < html.indexOf('admin-hint'),
        `${what} writes the error first: ${html}`,
      );
      assert.ok(
        html.indexOf('</label>') < html.indexOf('admin-field-error'),
        `${what} writes both below the label: ${html}`,
      );
    });

    it(`${what} escapes the message the server handed it`, () => {
      const html = render(callWith(body, `, error=problem`), {
        problem: '<script>alert(1)</script>',
      });

      assert.doesNotMatch(html, /<script>/, `${what} does not write a message as markup`);
      assert.match(html, /&lt;script&gt;/);
    });

    it(`${what} takes a second error paragraph where a field has one`, () => {
      const html = render(callWith(body, `, error='Wrong.', errorHtml=extra, hint='A note.'`), {
        extra: '<p class="admin-field-error">And <code>that</code> is gone.</p>',
      });

      assert.match(html, /<p class="admin-field-error">And <code>that<\/code> is gone\.<\/p>/);
      assert.ok(
        html.indexOf('Wrong.') < html.indexOf('And <code>') &&
          html.indexOf('And <code>') < html.indexOf('admin-hint'),
        `${what} writes it between the error and the hint: ${html}`,
      );
    });
  }
});

describe('the text macro', () => {
  it('always writes a value, so the box states what is in it', () => {
    assert.match(render(`{{ field.text('f', 'a_name', 'Label') }}`), /\bvalue=""/);
    assert.match(render(`{{ field.text('f', 'a_name', 'Label', 'now') }}`), /\bvalue="now"/);
  });

  it('escapes the value rather than writing it as markup', () => {
    const html = render(`{{ field.text('f', 'a_name', 'Label', value) }}`, {
      value: '"><script>alert(1)</script>',
    });

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /value="&quot;&gt;&lt;script&gt;/);
  });

  it('is a text box unless it is told to be something else', () => {
    assert.match(render(`{{ field.text('f', 'n', 'L') }}`), /\btype="text"/);
    assert.match(render(`{{ field.text('f', 'n', 'L', type='email') }}`), /\btype="email"/);
    assert.match(render(`{{ field.text('f', 'n', 'L', type='number') }}`), /\btype="number"/);
  });

  it("passes through every attribute the admin's fields ask for", () => {
    const html = render(
      `{{ field.text('f', 'n', 'L', 'v', type='number', min='0', step='1', inputmode='numeric',
         autocomplete='email', placeholder='you@example.com', spellcheck='false',
         required=true, autofocus=true, readonly=true, disabled=true) }}`,
    );
    const tag = control(html);

    for (const attribute of [
      'type="number"',
      'min="0"',
      'step="1"',
      'inputmode="numeric"',
      'autocomplete="email"',
      'placeholder="you@example.com"',
      'spellcheck="false"',
      'required',
      'autofocus',
      'readonly',
      'disabled',
    ]) {
      assert.ok(tag.includes(attribute), `${attribute} is on the box: ${tag}`);
    }
  });

  it('writes none of them where it was asked for none', () => {
    const tag = control(render(`{{ field.text('f', 'n', 'L', 'v') }}`));

    assert.equal(tag, '<input id="f" name="n" type="text" value="v" />');
  });
});

describe('the password macro', () => {
  it('carries an empty value and offers no way to set one', () => {
    const tag = control(render(`{{ field.password('f', 'n', 'Password') }}`));

    assert.equal(tag, '<input id="f" name="n" type="password" value="" />');
  });

  it('passes through what a password box needs', () => {
    const tag = control(
      render(
        `{{ field.password('f', 'n', 'L', autocomplete='new-password', spellcheck='false',
           placeholder='Paste your key', required=true, autofocus=true) }}`,
      ),
    );

    for (const attribute of [
      'autocomplete="new-password"',
      'spellcheck="false"',
      'placeholder="Paste your key"',
      'required',
      'autofocus',
    ]) {
      assert.ok(tag.includes(attribute), `${attribute} is on the box: ${tag}`);
    }
  });
});

describe('the textarea macro', () => {
  it('holds its value between the tags, escaped', () => {
    const html = render(`{{ field.textarea('f', 'n', 'Menu', value, rows='4') }}`, {
      value: 'About | /about/\n<b>',
    });

    assert.match(
      html,
      /<textarea id="f" name="n" rows="4">About \| \/about\/\n&lt;b&gt;<\/textarea>/,
    );
  });

  it('passes through the rest of what a textarea takes', () => {
    const tag = control(
      render(
        `{{ field.textarea('f', 'n', 'L', '', rows='3', spellcheck='false',
           required=true, autofocus=true, readonly=true, disabled=true) }}`,
      ),
    );

    for (const attribute of [
      'rows="3"',
      'spellcheck="false"',
      'required',
      'autofocus',
      'readonly',
      'disabled',
    ]) {
      assert.ok(tag.includes(attribute), `${attribute} is on the box: ${tag}`);
    }
  });
});

describe('the select macro', () => {
  it('takes its options from the body of the call', () => {
    const html = render(
      `{% call field.select('f', 'n', 'Homepage') %}
         <option value="">Your latest posts</option>
         <option value="about" selected>About</option>
       {% endcall %}`,
    );

    assert.match(html, /<select id="f" name="n">/);
    assert.match(html, /<option value="">Your latest posts<\/option>/);
    assert.match(html, /<option value="about" selected>About<\/option>/);
    assert.match(html, /<\/select>/);
  });

  it('passes through what a select takes', () => {
    const tag = control(
      render(
        `{% call field.select('f', 'n', 'L', required=true, autofocus=true, disabled=true) %}{% endcall %}`,
      ),
    );

    assert.equal(tag, '<select id="f" name="n" required autofocus disabled>');
  });
});

describe('the checkbox macro', () => {
  it('is a tick with the sentence beside it, in the class the stylesheet lays out', () => {
    const html = render(`{{ field.checkbox('f', 'n', 'Take comments on this site') }}`);

    assert.match(
      html,
      /<p class="admin-check">\s*<input id="f" name="n" type="checkbox" value="1" \/>\s*<label for="f">Take comments on this site<\/label>\s*<\/p>/,
    );
  });

  it('is ticked only when it is on, and says so after the name', () => {
    assert.doesNotMatch(render(`{{ field.checkbox('f', 'n', 'L') }}`), /\bchecked\b/);
    assert.match(
      render(`{{ field.checkbox('f', 'n', 'L', checked=true) }}`),
      /name="n"[^>]*\schecked/,
    );
  });

  it('sends 1 unless it is told to send something else', () => {
    assert.match(render(`{{ field.checkbox('f', 'n', 'L') }}`), /value="1"/);
    assert.match(render(`{{ field.checkbox('f', 'n', 'L', value='yes') }}`), /value="yes"/);
  });
});

describe('a label or a hint written by the template', () => {
  it('keeps the markup the admin writes into both', () => {
    const html = render(
      `{{ field.text('f', 'n', 'Email <span class="admin-status">(optional)</span>', '',
         hint='A path such as <code>/uploads/me.jpg</code>.') }}`,
    );

    assert.match(
      html,
      /<label for="f">Email <span class="admin-status">\(optional\)<\/span><\/label>/,
    );
    assert.match(
      html,
      /<p class="admin-hint">A path such as <code>\/uploads\/me\.jpg<\/code>\.<\/p>/,
    );
  });

  it('escapes what a captured hint interpolates', () => {
    const html = render(
      `{% set hint %}The archives live at <code>/{{ base }}/</code>.{% endset %}
       {{ field.text('f', 'n', 'Tag base', '', hint=hint) }}`,
      { base: '<b>' },
    );

    assert.match(html, /<code>\/&lt;b&gt;\/<\/code>/);
    assert.doesNotMatch(html, /<b>/);
  });
});

describe('the classes the partial emits', () => {
  it('are every one of them styled, so no field renders bare', async () => {
    const partial = await readFile(`${PACKAGED_ADMIN_DIR}components/fields.njk`, 'utf8');
    const css = await readFile(`${PACKAGED_ADMIN_DIR}static/admin.css`, 'utf8');
    const rules = new Set(
      [...css.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(
        ([, name]) => name ?? '',
      ),
    );

    const emitted = [...partial.matchAll(/class="([^"{]*)"/g)].flatMap(([, value]) =>
      (value ?? '').split(/\s+/).filter((name) => name.startsWith('admin-')),
    );

    assert.ok(emitted.length > 0, 'the partial was read and writes classes');
    assert.deepEqual(
      emitted.filter((name) => !rules.has(name)),
      [],
      'these classes have no rule in admin.css',
    );
  });
});
