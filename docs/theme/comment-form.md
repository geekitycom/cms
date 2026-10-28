# The comment form

`commentForm` is on the context of a rendered post or page **only when it is
still taking comments**. The CMS combines four inputs before it sets the key:

- the site switch
- whether the document's type takes comments by default (posts do and pages
  do not, unless Settings > Discussion says otherwise)
- a closing window counted from the document's date
- `comments: true` or `comments: false` in the document's own front matter

A layout tests for the key:

```njk
{% if commentForm %}
{% include "partials/comment-form.njk" %}
{% endif %}
```

`layouts/post.njk` does this after the conversation. A closed post still shows
the thread, including every fediverse reply. Fediverse replies arrive whether
a post is open or closed. A closed post has no form, and the conversation
prints "Comments are closed." when the form is missing. A site replaces
`partials/comment-form.njk` in the same way as any other template.

The packaged partial is a `section#respond.comment-respond` with an
`h2.comment-reply-title`, one paragraph per field and the button in a
`p.form-submit`. These are the source design's names. The stylesheet styles
every label, field and button of both forms through `.comment-respond`, and a
site can reuse CSS written for the WordPress theme. In both forms, the name and
email fields are in a `div.field-row`, side by side on a wide screen. On a site
that takes webmentions, a `p.comment-help` under the heading says that a
visitor can reply from their own site instead.

| Key                        | What it holds                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `action`                   | Where the form posts. One fixed path. The post is sent as a field.                                                                                                       |
| `fields`                   | The name each field is submitted under: `post`, `name`, `email`, `url`, `body`, `inReplyTo`, `trap`, `loaded`, `notify`, `csrf`, `listed`. Use these, not literal names. |
| `post`                     | The post's slug, for the hidden field.                                                                                                                                   |
| `loaded`                   | When this form was rendered, in epoch milliseconds, for the hidden field. A submission that comes back too fast is refused.                                              |
| `values`                   | The field values: empty on a new form, the submitted values on a refused one.                                                                                            |
| `problems`                 | One message per field the visitor must correct: `name`, `email`, `url`, `body`.                                                                                          |
| `error`                    | A message about the submission as a whole, when there is one.                                                                                                            |
| `notifiable`               | Whether to offer `fields.notify`, the "email me when somebody replies" box. False on a site that sends no mail, because the site could not send the promised message.    |
| `nameLength`, `bodyLength` | The `maxlength` for the two fields that have one.                                                                                                                        |

`fields.trap` is a honeypot. Render it, hide it visually and from assistive
technology, and give it `tabindex="-1"` and `autocomplete="off"`. The CMS drops
a submission that fills it in. **Do not** remove it from a replacement partial.
It is one of the three spam checks on the form.

## The form challenge

When the site has a form challenge on, `commentForm` carries one more key on
a stranger's form. With the built-in hCaptcha challenge, that is while a site
key and a secret are stored on Settings > Discussion and hCaptcha has not
refused them. With no challenge on, the key is not there at all. A signed-in
form never has it, because a session is better evidence than a widget.

| Key                   | What it holds                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `challenge.provider`  | Which service draws the widget: `hcaptcha` for the built-in challenge. A challenge a site sets in its config names its own.        |
| `challenge.siteKey`   | The public key the widget is drawn with. It is printed in the page. The secret is never on the context.                            |
| `challenge.scriptUrl` | The service's script, `https://js.hcaptcha.com/1/api.js` for hCaptcha.                                                             |
| `challenge.field`     | The field the widget posts its answer in, `h-captcha-response` for hCaptcha. The widget creates the field itself; do not draw one. |

The packaged partial draws the widget ahead of the submit button with
`partials/form-challenge.njk`:

```njk
{% import "partials/form-challenge.njk" as challenge %}
{{ challenge.widget(commentForm.challenge, "comment", "comment") }}
```

The macro draws nothing without a challenge. With hCaptcha it draws a
`div.form-challenge` with `role="group"`, a visible "Spam check" label, an
empty `div.h-captcha` with `data-sitekey`, and a hint. The hint says that
without the check, for example with JavaScript off, the comment is still
posted but may need a manual check. The widget is an iframe that hCaptcha
draws, and it is reached with Tab like any other field.

The page shell loads the script. `layouts/base.njk` adds
`<script src="/theme/hcaptcha.js" data-script="…" defer>` at the end of the
body when `pageChallenge`, the challenge the page's forms draw, is an
hCaptcha one. The server sets `pageChallenge` from a stranger's comment form,
else from a contact form that is still shown, so a site's own shell can test
that one key rather than both forms. The tag is outside the `scripts` block,
so a site that overrides that block keeps it. `hcaptcha.js` looks for
`div.h-captcha` elements with a `data-sitekey`. When it finds one, it loads hCaptcha's script from
`data-script` with `render=explicit`, `hl` set to the page's `<html lang>`,
and an `onload` callback that draws each widget. The widget is drawn dark
when `<html data-mode>` is `dark`, light when it is `light`, and in the
visitor's `prefers-color-scheme` otherwise. A page that draws no widget
loads nothing from hCaptcha. A site without a challenge gets no script on
its forms.

**A replacement partial that draws no widget still works, but every
stranger's comment from it is filed as spam.** The CMS counts a submission
with no answer as a failed challenge and stores it as spam without telling
anyone, the same as a submission from a visitor with JavaScript off. To keep
the widget, call the macro above in the replacement partial, or draw
`<div class="h-captcha" data-sitekey="{{ commentForm.challenge.siteKey }}"></div>`
inside the form yourself. The shell's script draws either one. Do not load
hCaptcha's script a second time.

## When a submission is refused

The CMS answers a refused comment with the post again, `problems` and `error`
filled in. The packaged partial reports the refusal to assistive technology in
two places. Do the same in a replacement partial:

- **A summary before the form.** One element with `role="alert"`,
  `tabindex="-1"` and `autofocus`. A heading labels it. The heading is `error`,
  or a sentence of your own when `error` is empty. The element holds a link to
  each field in `problems` (`<a href="#comment-name">…</a>`). `autofocus` moves
  focus to the summary on load with no script, so it must be the first
  `autofocus` on the page.
- **On each field in `problems`.** Set `aria-invalid="true"` and an
  `aria-describedby` that names the element holding the field's message. A
  screen reader then reads the message with the field.

[The contact form](contact-form.md) follows the same rules.

## When somebody is signed in

Two more keys are on `commentForm` only when the request has a valid session
for this site's admin:

| Key          | What it holds                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `signedInAs` | Who the reply will be posted as: `name`, which is their display name or their username, and `url`, which is their author archive. |
| `csrfToken`  | The value for a hidden `fields.csrf`, without which the submission is refused.                                                    |

**A replacement partial must draw both forms.** The site draws the signed-in
form for its own users and the anonymous form for every other visitor:

```njk
{% if commentForm.signedInAs %}
<input type="hidden" name="{{ commentForm.fields.csrf }}" value="{{ commentForm.csrfToken }}" />
<p class="comment-signed-in">
  Commenting as <a href="{{ commentForm.signedInAs.url }}">{{ commentForm.signedInAs.name }}</a>.
</p>
<p class="comment-check">
  <input id="comment-listed" name="{{ commentForm.fields.listed }}" type="checkbox" value="1"{% if commentForm.values.listed %} checked{% endif %} />
  <label for="comment-listed">Include in posts and feeds</label>
</p>
{% else %}
{# fields.loaded, fields.trap, and the name, email and website boxes #}
{% endif %}
```

The signed-in branch renders **no** name, email or website box, **no**
`fields.trap` and **no** `fields.loaded`. The site already knows the name,
email and website. A session is better evidence of a person than a honeypot or
a timer. The branch renders `fields.csrf` instead, because this is the only
form on the public site that acts for a signed-in user. Without the token, a
page on another site could make the user post under their own name. The
comment box, the reply-to field and the notify box are the same in both
branches.

The signed-in branch posts a reply post, not a comment (see
[Replying while signed in](../comments.md#replying-while-signed-in)). It adds
`fields.listed`, a checkbox labelled "Include in posts and feeds", unchecked by
default. Unchecked publishes the reply post unlisted. Checked publishes it
public. The anonymous branch never draws the checkbox, and the CMS ignores the
field from an anonymous visitor.

A Reply link, `?reply_to={key}#respond`, goes on every entry of the thread for
a signed-in user. For an anonymous visitor, it goes only on entries with
`source == "comment"`.
`partials/comment.njk` asks `reply.source == "comment" or
commentForm.signedInAs`.

The account's email address is **never** on the context. The CMS stores the
comment with the address, the same as an anonymous visitor's, and a template
cannot print either one.

A page with the signed-in form is specific to one user. The CMS sends it with
`Cache-Control: private, no-store` and no ETag. A theme does not need to do
anything for this. It is why printing the user's name on the page is safe.

Two more keys come from the URL, not from the post:

| Key                                   | What it holds                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `commentNotice`                       | The thank-you after a submission, from the `?comment=` the redirect carried.                                                |
| `commentReplyTo`, `commentReplyingTo` | The comment a `?reply_to=` link named and the name on it, after the CMS checks that it is an approved comment on this post. |

## In the Markdown

A form needs HTML, so a document's Markdown has no fields. Its footer links
the comment form on the HTML page, at `#respond`, from `commentForm.url`. See
[The Markdown representation](markdown.md#context).
