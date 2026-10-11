# The contact form

`contactForm` is on the context of a rendered document **only when its front
matter says `contact: true`**, so a layout asks:

```njk
{% if contactForm %}
{% include "partials/contact-form.njk" %}
{% endif %}
```

That is what `layouts/page.njk` does, after the page's content. The key is
honoured wherever it is written, so a theme that wants the form under a post as
well only has to add the same two lines to `layouts/post.njk`; the editor
offers the checkbox on pages.

`archive: true` is the other front matter key of this kind: it puts every
published post on the page instead of a form. See
[An archive page](page-shell.md#an-archive-page).

The packaged partial is a `section#contact.comment-respond.contact-form`: it is
the same kind of form as the comment one, so it wears the same class and the two
share one set of rules rather than keeping two that drift.

| Key                                            | What it holds                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `action`                                       | Where the form posts. One fixed path; the page travels as a field.                                                                               |
| `fields`                                       | The name each field is submitted under: `page`, `name`, `email`, `subject`, `message`, `trap`, `loaded`. Use these rather than typing the names. |
| `page`                                         | The page's slug, for the hidden field.                                                                                                           |
| `loaded`                                       | When this form was rendered, in epoch milliseconds, for the hidden field. A submission that comes back too fast is refused.                      |
| `values`                                       | What is in the fields: empty on a fresh form, what was typed on a refused one.                                                                   |
| `problems`                                     | One message per field a person has to put right — `name`, `email`, `subject`, `message`.                                                         |
| `error`                                        | A message about the submission as a whole, when there is one.                                                                                    |
| `nameLength`, `subjectLength`, `messageLength` | The `maxlength` for the three fields that have one.                                                                                              |

`fields.trap` is the same honeypot the comment form carries, and the same rules
apply: render it, hide it, and **do not** remove it from a replacement partial.

One more key travels beside it, from the URL rather than from the page:

| Key             | What it holds                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `contactNotice` | The thank-you after a message was sent, from the `?contact=` the redirect carried. The shipped partial shows it **instead of** the form. |

**Where the message goes is never on the context.** The contact address is read
when a submission arrives, so it cannot end up in the HTML however this partial
is rewritten. Do not try to print it, and do not put a `mailto:` beside the
form.
