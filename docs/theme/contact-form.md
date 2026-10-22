# The contact form

`contactForm` is on the context of a rendered document **only when its front
matter says `contact: true`**. A layout tests for it:

```njk
{% if contactForm %}
{% include "partials/contact-form.njk" %}
{% endif %}
```

`layouts/page.njk` does this after the page's content. The key works on any
document. To show the form under a post as well, add the same lines to
`layouts/post.njk`. The editor offers the checkbox on pages.

`archive: true` is the other front matter key of this kind. It puts every
published post on the page, in place of a form. See
[An archive page](page-shell.md#an-archive-page).

The packaged partial is a `section#contact.comment-respond.contact-form`. It
has the comment form's `comment-respond` class, so the two forms share one set
of style rules.

| Key                                            | What it holds                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `action`                                       | Where the form posts. One fixed path. The page is sent as a field.                                                                     |
| `fields`                                       | The name each field is submitted under: `page`, `name`, `email`, `subject`, `message`, `trap`, `loaded`. Use these, not literal names. |
| `page`                                         | The page's slug, for the hidden field.                                                                                                 |
| `loaded`                                       | When this form was rendered, in epoch milliseconds, for the hidden field. A submission that comes back too fast is refused.            |
| `values`                                       | The field values: empty on a new form, the submitted values on a refused one.                                                          |
| `problems`                                     | One message per field the visitor must correct: `name`, `email`, `subject`, `message`.                                                 |
| `error`                                        | A message about the submission as a whole, when there is one.                                                                          |
| `nameLength`, `subjectLength`, `messageLength` | The `maxlength` for the three fields that have one.                                                                                    |

`fields.trap` is the same honeypot as in the comment form, with the same
rules. Render it, hide it, and **do not** remove it from a replacement partial.

One more key comes from the URL, not from the page:

| Key             | What it holds                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `contactNotice` | The thank-you after a message was sent, from the `?contact=` the redirect carried. The shipped partial shows it **instead of** the form. |

**The contact address is never on the context.** The CMS reads it when a
submission arrives, so no version of this partial can put it in the HTML. Do
not try to print it, and do not put a `mailto:` link next to the form.

## In the Markdown

A form needs HTML, so a document's Markdown has no fields. Its footer links
the contact form on the HTML page, at `#contact`, from `contactForm.url`. See
[The Markdown representation](markdown.md#context).
