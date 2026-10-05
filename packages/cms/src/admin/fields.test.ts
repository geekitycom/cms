import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { Environment } from 'nunjucks';

import { tiedErrors } from '../__testing__/form-errors.ts';
import {
  adminDirectories,
  createAdminTemplateEnvironment,
  PACKAGED_ADMIN_DIR,
} from './templates.ts';

/**
 * `components/fields.njk`: the one place a labelled box is written.
 *
 * The admin's screens used to spell out every `<label for>`, control, hint and
 * error by hand, which is how /admin/users ended up with hidden labels nobody
 * else used (TASK-97). These tests are about the macro rather than any screen:
 * that each one binds its label to its control, writes the error before the
 * hint, leaves out the parts it was given nothing for, and passes through the
 * attributes the real fields need. A screen that drifts from this is a screen
 * that stopped using it.
 *
 * Both admins carry the file until the flip (decision-30): the old one in
 * `admin/`, the DaisyUI one in `daisyui/`, which every page that imports it by
 * name gets with `GEEKITY_ADMIN=daisyui`. The contract holds for both; what
 * differs is the class a hint and an error are drawn in.
 */

interface Admin {
  name: string;
  environment: Environment;
  /** The class attribute a hint paragraph is written with. */
  hint: string;
  /** The class attribute a field error paragraph is written with. */
  error: string;
}

const OLD: Admin = {
  name: 'the old admin',
  environment: createAdminTemplateEnvironment({ noCache: true, roots: [PACKAGED_ADMIN_DIR] }),
  hint: 'admin-hint',
  error: 'admin-field-error',
};

const DAISYUI: Admin = {
  name: 'the DaisyUI admin',
  environment: createAdminTemplateEnvironment({
    noCache: true,
    roots: adminDirectories({ GEEKITY_ADMIN: 'daisyui' }),
  }),
  hint: 'label block whitespace-normal',
  error: 'validator-hint',
};

/** Render one call of the partial's macros, with nothing else around it. */
function render(admin: Admin, body: string, context: Record<string, unknown> = {}): string {
  return admin.environment.renderString(
    `{% import "components/fields.njk" as field %}${body}`,
    context,
  );
}

/** The opening tag of the first `<input>`, `<select>` or `<textarea>`. */
function control(html: string): string {
  const tag = /<(?:input|textarea|select)\b[^>]*>/.exec(html)?.[0];
  assert.ok(tag !== undefined, `there is a control in: ${html}`);
  return tag;
}

/** An opening tag with its class attribute taken out. */
function withoutClass(tag: string): string {
  return tag.replace(/\sclass="[^"]*"/, '');
}

/** The value of the class attribute on an opening tag, split into names. */
function classesOf(tag: string): string[] {
  return (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

/** The `<label for="…">` bound to that id: its opening tag and its text. */
function labelFor(html: string, id: string): { tag: string; text: string } | undefined {
  const match = new RegExp(`(<label\\b[^>]*\\bfor="${id}"[^>]*>)([\\s\\S]*?)</label>`).exec(html);
  if (match === null) return undefined;
  return { tag: match[1] ?? '', text: (match[2] ?? '').replaceAll(/<[^>]*>/g, '').trim() };
}

const CALLS: readonly { what: string; body: string }[] = [
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

for (const admin of [OLD, DAISYUI]) {
  describe(`every field macro in ${admin.name}`, () => {
    for (const { what, body } of CALLS) {
      it(`${what} binds a label the eye can read to its control by id`, () => {
        const html = render(admin, callWith(body));

        const label = labelFor(html, 'f');
        assert.ok(label !== undefined, `${what} has a label bound to the control`);
        assert.equal(label.text, 'A label', `${what}'s label carries the words it was given`);
        assert.doesNotMatch(label.tag, /admin-visually-hidden/, `${what}'s label is not hidden`);
        assert.match(control(html), /\bid="f"/, `${what}'s control carries the id`);
        assert.match(control(html), /\bname="a_name"/, `${what}'s control carries the name`);
      });

      it(`${what} writes nothing below the control when there is nothing to say`, () => {
        const html = render(admin, callWith(body));

        assert.ok(!html.includes(`class="${admin.hint}"`), `${what} has no empty hint`);
        assert.ok(!html.includes(`class="${admin.error}"`), `${what} has no empty error`);
      });

      it(`${what} writes the hint where it is given one`, () => {
        const html = render(admin, callWith(body, `, hint='What this is for.'`));

        assert.ok(html.includes(`<p class="${admin.hint}">What this is for.</p>`), html);
      });

      it(`${what} writes the field error where the form says something went wrong`, () => {
        const html = render(admin, callWith(body, `, error='That is not a URL.'`));

        assert.ok(
          html.includes(`<p class="${admin.error}" id="f-error">That is not a URL.</p>`),
          html,
        );
      });

      it(`${what} marks its control invalid and points it at the error`, () => {
        const tag = control(render(admin, callWith(body, `, error='That is not a URL.'`)));

        assert.match(tag, /\saria-invalid="true"/, `${what} is marked invalid: ${tag}`);
        assert.match(tag, /\saria-describedby="f-error"/, `${what} names its error: ${tag}`);
      });

      it(`${what} says nothing about validity where there is no error`, () => {
        const tag = control(render(admin, callWith(body, `, hint='A note.'`)));

        assert.doesNotMatch(tag, /aria-invalid|aria-describedby/, `${what} is left alone: ${tag}`);
      });

      it(`${what} puts the error above the hint, next to the box it is about`, () => {
        const html = render(admin, callWith(body, `, error='Wrong.', hint='A standing note.'`));

        assert.ok(
          html.indexOf(`class="${admin.error}"`) < html.indexOf(`class="${admin.hint}"`),
          `${what} writes the error first: ${html}`,
        );
        assert.ok(
          html.indexOf('</label>') < html.indexOf(`class="${admin.error}"`),
          `${what} writes both below the label: ${html}`,
        );
      });

      it(`${what} escapes the message the server handed it`, () => {
        const html = render(admin, callWith(body, `, error=problem`), {
          problem: '<script>alert(1)</script>',
        });

        assert.doesNotMatch(html, /<script>/, `${what} does not write a message as markup`);
        assert.match(html, /&lt;script&gt;/);
      });

      it(`${what} takes a second error paragraph where a field has one`, () => {
        const html = render(
          admin,
          callWith(body, `, error='Wrong.', errorHtml=extra, hint='A note.'`),
          { extra: '<p class="admin-field-error">And <code>that</code> is gone.</p>' },
        );

        assert.match(html, /<p class="admin-field-error">And <code>that<\/code> is gone\.<\/p>/);
        assert.match(
          control(html),
          /aria-describedby="f-error"/,
          'the field error is still the one named',
        );
        assert.ok(
          html.indexOf('Wrong.') < html.indexOf('And <code>') &&
            html.indexOf('And <code>') < html.indexOf(`class="${admin.hint}"`),
          `${what} writes it between the error and the hint: ${html}`,
        );
      });
    }
  });

  describe(`the text macro in ${admin.name}`, () => {
    it('always writes a value, so the box states what is in it', () => {
      assert.match(render(admin, `{{ field.text('f', 'a_name', 'Label') }}`), /\bvalue=""/);
      assert.match(
        render(admin, `{{ field.text('f', 'a_name', 'Label', 'now') }}`),
        /\bvalue="now"/,
      );
    });

    it('escapes the value rather than writing it as markup', () => {
      const html = render(admin, `{{ field.text('f', 'a_name', 'Label', value) }}`, {
        value: '"><script>alert(1)</script>',
      });

      assert.doesNotMatch(html, /<script>/);
      assert.match(html, /value="&quot;&gt;&lt;script&gt;/);
    });

    it('is a text box unless it is told to be something else', () => {
      assert.match(render(admin, `{{ field.text('f', 'n', 'L') }}`), /\btype="text"/);
      assert.match(
        render(admin, `{{ field.text('f', 'n', 'L', type='email') }}`),
        /\btype="email"/,
      );
      assert.match(
        render(admin, `{{ field.text('f', 'n', 'L', type='number') }}`),
        /\btype="number"/,
      );
    });

    it("passes through every attribute the admin's fields ask for", () => {
      const html = render(
        admin,
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
      const tag = control(render(admin, `{{ field.text('f', 'n', 'L', 'v') }}`));

      assert.equal(withoutClass(tag), '<input id="f" name="n" type="text" value="v" />');
    });
  });

  describe(`the password macro in ${admin.name}`, () => {
    it('carries an empty value and offers no way to set one', () => {
      const tag = control(render(admin, `{{ field.password('f', 'n', 'Password') }}`));

      assert.equal(withoutClass(tag), '<input id="f" name="n" type="password" value="" />');
    });

    it('passes through what a password box needs', () => {
      const tag = control(
        render(
          admin,
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

  describe(`the textarea macro in ${admin.name}`, () => {
    it('holds its value between the tags, escaped', () => {
      const html = render(admin, `{{ field.textarea('f', 'n', 'Menu', value, rows='4') }}`, {
        value: 'About | /about/\n<b>',
      });

      assert.equal(withoutClass(control(html)), '<textarea id="f" name="n" rows="4">');
      assert.match(html, />About \| \/about\/\n&lt;b&gt;<\/textarea>/);
    });

    it('passes through the rest of what a textarea takes', () => {
      const tag = control(
        render(
          admin,
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

  describe(`the select macro in ${admin.name}`, () => {
    it('takes its options from the body of the call', () => {
      const html = render(
        admin,
        `{% call field.select('f', 'n', 'Homepage') %}
           <option value="">Your latest posts</option>
           <option value="about" selected>About</option>
         {% endcall %}`,
      );

      assert.equal(withoutClass(control(html)), '<select id="f" name="n">');
      assert.match(html, /<option value="">Your latest posts<\/option>/);
      assert.match(html, /<option value="about" selected>About<\/option>/);
      assert.match(html, /<\/select>/);
    });

    it('passes through what a select takes', () => {
      const tag = control(
        render(
          admin,
          `{% call field.select('f', 'n', 'L', required=true, autofocus=true, disabled=true) %}{% endcall %}`,
        ),
      );

      assert.equal(withoutClass(tag), '<select id="f" name="n" required autofocus disabled>');
    });
  });

  describe(`the checkbox macro in ${admin.name}`, () => {
    it('is ticked only when it is on, and says so after the name', () => {
      assert.doesNotMatch(render(admin, `{{ field.checkbox('f', 'n', 'L') }}`), /\bchecked\b/);
      assert.match(
        render(admin, `{{ field.checkbox('f', 'n', 'L', checked=true) }}`),
        /name="n"[^>]*\schecked/,
      );
    });

    it('sends 1 unless it is told to send something else', () => {
      assert.match(render(admin, `{{ field.checkbox('f', 'n', 'L') }}`), /value="1"/);
      assert.match(
        render(admin, `{{ field.checkbox('f', 'n', 'L', value='yes') }}`),
        /value="yes"/,
      );
    });

    it('keeps its attribute when it cannot be changed', () => {
      assert.match(
        control(render(admin, `{{ field.checkbox('f', 'n', 'L', disabled=true) }}`)),
        /\sdisabled\b/,
      );
    });
  });

  describe(`the error summary in ${admin.name}`, () => {
    it('is an alert that takes focus, headed by what went wrong, linking to each field', () => {
      const html = render(
        admin,
        `{% call field.summary('Nothing was saved.') %}
           {{ field.problem('f', 'That is not a URL.') }}
           {{ field.problem('g', '') }}
         {% endcall %}
         {{ field.text('f', 'n', 'L', error='That is not a URL.', autofocus=true) }}
         {{ field.text('g', 'm', 'M') }}`,
      );

      const { heading, links } = tiedErrors(html);
      assert.equal(heading, 'Nothing was saved.');
      assert.deepEqual(links, ['f'], 'a field with nothing to say is not listed');
      assert.match(html, /<a\b[^>]*\bhref="#f"[^>]*>That is not a URL\.<\/a>/);
    });

    it('stands on its own for a form that has one thing to say', () => {
      const html = render(admin, `{{ field.summary(error) }}`, { error: 'Those do not match.' });

      assert.equal(tiedErrors(html).heading, 'Those do not match.');
      assert.doesNotMatch(html, /<ul/, 'there is no empty list');
    });

    it('escapes the messages the server handed it', () => {
      const html = render(
        admin,
        `{% call field.summary(error) %}{{ field.problem('f', error) }}{% endcall %}`,
        { error: '<script>alert(1)</script>' },
      );

      assert.doesNotMatch(html, /<script>/);
    });
  });

  describe(`a label or a hint written by the template, in ${admin.name}`, () => {
    it('keeps the markup the admin writes into both', () => {
      const html = render(
        admin,
        `{{ field.text('f', 'n', 'Email <span class="admin-status">(optional)</span>', '',
           hint='A path such as <code>/uploads/me.jpg</code>.') }}`,
      );

      assert.match(
        html,
        /<label\b[^>]*\bfor="f"[^>]*>Email <span class="admin-status">\(optional\)<\/span><\/label>/,
      );
      assert.ok(
        html.includes(`<p class="${admin.hint}">A path such as <code>/uploads/me.jpg</code>.</p>`),
        html,
      );
    });

    it('escapes what a captured hint interpolates', () => {
      const html = render(
        admin,
        `{% set hint %}The archives live at <code>/{{ base }}/</code>.{% endset %}
         {{ field.text('f', 'n', 'Tag base', '', hint=hint) }}`,
        { base: '<b>' },
      );

      assert.match(html, /<code>\/&lt;b&gt;\/<\/code>/);
      assert.doesNotMatch(html, /<b>/);
    });
  });
}

describe('the old admin’s checkbox', () => {
  it('is a tick with the sentence beside it, in the class the stylesheet lays out', () => {
    const html = render(OLD, `{{ field.checkbox('f', 'n', 'Take comments on this site') }}`);

    assert.match(
      html,
      /<p class="admin-check">\s*<input id="f" name="n" type="checkbox" value="1" \/>\s*<label for="f">Take comments on this site<\/label>\s*<\/p>/,
    );
  });
});

describe('the classes the old partial emits', () => {
  it('are every one of them styled, so no field renders bare', async () => {
    const partial = await readFile(
      path.join(PACKAGED_ADMIN_DIR, 'components', 'fields.njk'),
      'utf8',
    );
    const css = await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', 'admin.css'), 'utf8');
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

describe('the DaisyUI fields', () => {
  const EVERYTHING = `, hint='A note.', error='Wrong.', errorHtml='<p>Gone.</p>'`;

  for (const { what, body } of CALLS) {
    it(`${what} is one fieldset holding its label, control, error and hint`, () => {
      const html = render(DAISYUI, callWith(body, EVERYTHING)).trim();

      assert.match(html, /^<div class="fieldset">[\s\S]*<\/div>$/);
      assert.equal(html.match(/class="fieldset"/g)?.length, 1, `one fieldset: ${html}`);
    });

    it(`${what} writes no style of its own, which the admin's CSP would refuse`, () => {
      const html = render(DAISYUI, callWith(body, EVERYTHING));

      assert.doesNotMatch(html, /\sstyle=|<style/);
    });

    it(`${what} draws a refused control through the validator, and only a refused one`, () => {
      const refused = render(DAISYUI, callWith(body, `, error='Wrong.'`));
      const fine = render(DAISYUI, callWith(body, `, hint='A note.'`));

      assert.match(refused, /class="[^"]*\bvalidator\b[^"]*"/, `refused: ${refused}`);
      assert.doesNotMatch(fine, /\bvalidator\b/, `fine: ${fine}`);
    });

    it(`${what} draws a second error paragraph in the error colour`, () => {
      const html = render(DAISYUI, callWith(body, EVERYTHING));

      assert.match(html, /<div class="text-error">\s*<p>Gone\.<\/p>\s*<\/div>/);
    });
  }

  for (const what of ['text', 'password', 'textarea', 'select']) {
    it(`${what} heads the field with its label`, () => {
      const call = CALLS.find((entry) => entry.what === what)?.body ?? '';
      const label = labelFor(render(DAISYUI, callWith(call)), 'f');

      assert.deepEqual(classesOf(label?.tag ?? ''), ['fieldset-legend']);
    });
  }

  it('draws each control as its DaisyUI component', () => {
    const drawn = Object.fromEntries(
      CALLS.map(({ what, body }) => [what, classesOf(control(render(DAISYUI, callWith(body))))]),
    );

    assert.deepEqual(drawn, {
      text: ['input', 'input-sm', 'w-full', 'read-only:bg-base-200', 'read-only:border-dashed'],
      password: ['input', 'input-sm', 'w-full'],
      textarea: [
        'textarea',
        'textarea-sm',
        'w-full',
        'read-only:bg-base-200',
        'read-only:border-dashed',
      ],
      select: ['select', 'select-sm', 'w-full'],
      checkbox: ['checkbox', 'checkbox-sm'],
    });
  });

  it('puts the tick inside its label, with the sentence beside it', () => {
    const html = render(DAISYUI, `{{ field.checkbox('f', 'n', 'Take comments on this site') }}`);

    assert.match(
      html,
      /<label class="label whitespace-normal text-base-content" for="f">\s*<input id="f" name="n" type="checkbox" value="1" class="checkbox checkbox-sm" \/>\s*Take comments on this site\s*<\/label>/,
    );
  });

  it('heads a refused form with an error alert whose links read as links', () => {
    const html = render(
      DAISYUI,
      `{% call field.summary('Nothing was saved.') %}{{ field.problem('f', 'Wrong.') }}{% endcall %}`,
    );

    const open = /<div\b[^>]*\brole="alert"[^>]*>/.exec(html)?.[0] ?? '';
    assert.deepEqual(classesOf(open), ['alert', 'alert-error']);
    assert.match(html, /<a class="link" href="#f">Wrong\.<\/a>/);
  });
});
