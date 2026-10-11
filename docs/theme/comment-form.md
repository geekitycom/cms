# The comment form

`commentForm` is on the context of a rendered post **only when that post is
still taking comments**. A site switch, a closing window counted from the
post's date, and `comments: true` or `comments: false` in the post's own front
matter all agree before it gets here, so a layout asks:

```njk
{% if commentForm %}
{% include "partials/comment-form.njk" %}
{% endif %}
```

That is what `layouts/post.njk` does, after the conversation. A closed post
still shows the thread — including every fediverse reply, which arrives whether
a post is open or not — and simply has no form, which is what the conversation
reads to print "Comments are closed." A site replaces
`partials/comment-form.njk` the way it replaces any other template.

The packaged partial is a `section#respond.comment-respond` with an
`h2.comment-reply-title`, one paragraph per field and the button in a
`p.form-submit` — the source design's names, so the stylesheet styles every
label, field and button of both forms through `.comment-respond` and a site
that has CSS for the WordPress theme can bring it. The name and email fields sit
in a `div.field-row`, side by side on a wide screen, in both forms. On a site
that takes webmentions a `p.comment-help` under the heading says a reader can
reply from their own site instead.

| Key                        | What it holds                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action`                   | Where the form posts. One fixed path; the post travels as a field.                                                                                                                 |
| `fields`                   | The name each field is submitted under: `post`, `name`, `email`, `url`, `body`, `inReplyTo`, `trap`, `loaded`, `notify`, `csrf`, `listed`. Use these rather than typing the names. |
| `post`                     | The post's slug, for the hidden field.                                                                                                                                             |
| `loaded`                   | When this form was rendered, in epoch milliseconds, for the hidden field. A submission that comes back too fast is refused.                                                        |
| `values`                   | What is in the fields: empty on a fresh form, what was typed on a refused one.                                                                                                     |
| `problems`                 | One message per field a person has to put right — `name`, `email`, `url`, `body`.                                                                                                  |
| `error`                    | A message about the submission as a whole, when there is one.                                                                                                                      |
| `notifiable`               | Whether to offer `fields.notify`, the "email me when somebody replies" box. False on a site that sends no mail, where the box would promise a message nothing could send.          |
| `nameLength`, `bodyLength` | The `maxlength` for the two fields that have one.                                                                                                                                  |

`fields.trap` is a honeypot: render it, hide it from sight and from assistive
technology, and give it `tabindex="-1"` and `autocomplete="off"`. A submission
that filled it is dropped. **Do not** remove it from a replacement partial —
it is one of three things standing between the site and a spam queue.

## When a submission is refused

The CMS answers a refused comment with the post again, `problems` and `error`
filled in. The packaged partial tells assistive technology about it in two
places, and a replacement partial should do the same:

- **A summary before the form.** One element with `role="alert"`,
  `tabindex="-1"` and `autofocus`, labelled by a heading that is `error`, or a
  sentence of your own when there is none, and holding a link to each field in
  `problems` (`<a href="#comment-name">…</a>`). `autofocus` moves focus to it on
  load with no script, so it has to be the first `autofocus` on the page.
- **On each field in `problems`.** `aria-invalid="true"` and
  `aria-describedby` naming the element that holds its message, so a screen
  reader reads the message with the field.

The contact form below keeps the same contract.

## When somebody is signed in

Two more keys are on `commentForm` when — and only when — the request carries a
valid session for this site's admin:

| Key          | What it holds                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `signedInAs` | Who the reply will be posted as: `name`, which is their display name or their username, and `url`, which is their author archive. |
| `csrfToken`  | The value for a hidden `fields.csrf`, without which the submission is refused.                                                    |

**A replacement partial has to draw both forms**, because the site draws this
one for its own author and the stranger's one for everybody else:

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
`fields.trap` and **no** `fields.loaded`: the site already knows all three
answers, and a session is better evidence that this is a person than a honeypot
or a stopwatch. It renders `fields.csrf` instead, because this is the one form
on the public site that acts on somebody's behalf — without the token, a page
on another site could make them post under their own name. The comment box, the
reply-to field and the notify box are the same in both branches.

What the signed-in branch posts is a reply post rather than a comment (see
[Replying while signed in](../comments.md#replying-while-signed-in)). It adds `fields.listed`, a checkbox
labelled "Include in posts and feeds" and unchecked by default: unchecked
publishes the reply post unlisted, checked publishes it public. The stranger's
branch never draws it, and the CMS ignores it from a stranger.

A Reply link, `?reply_to={key}#respond`, goes on every entry of the thread for
somebody signed in, and on `source == "comment"` entries only for a stranger.
`partials/comment.njk` asks `reply.source == "comment" or
commentForm.signedInAs`.

The account's email address is **never** on the context. The comment is stored
with it, exactly as a stranger's is, and it is no more printable than theirs.

A page carrying this form is one reader's page rather than the post, so the CMS
answers it `Cache-Control: private, no-store` and with no ETag. A theme does
not have to do anything about that, but it is why printing somebody's name into
a page is safe here.

Two more keys travel beside it, both from the URL rather than from the post:

| Key                                   | What it holds                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `commentNotice`                       | The thank-you after a submission, from the `?comment=` the redirect carried.                                                    |
| `commentReplyTo`, `commentReplyingTo` | The comment a `?reply_to=` link named and the name on it, once the CMS has checked it is an approved comment on this very post. |
