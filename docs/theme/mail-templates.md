# Mail templates

The messages the CMS sends live under `mail/` and resolve the same way, so a
`mail/test.txt.njk` in the theme the site wears replaces the text of the test
message and leaves its subject and HTML twin coming from the package. Each message is up to three
files:

| File                      | What it is                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `mail/<name>.subject.njk` | The subject. Rendered to a single line. Optional.              |
| `mail/<name>.txt.njk`     | The plain text body. **Required.**                             |
| `mail/<name>.html.njk`    | The HTML twin. Optional; without it the message is plain text. |

A message that has no `.txt.njk` anywhere on the search path is an error rather
than an empty email, so a typo in a template name is reported instead of sent.

The package ships seven messages:

| Name               | When it goes                                     | What `data` carries                                                                                                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `test`             | Send test email, on Settings.                    | Nothing.                                                                                                                                   |
| `password-reset`   | Somebody asked to reset a password.              | `username`, `resetUrl`, `expiresAt`, `expiresInHours`.                                                                                     |
| `password-changed` | A reset link was used.                           | `username`, `signedOut` (how many sessions ended).                                                                                         |
| `comment-pending`  | A comment or webmention is waiting for approval. | `comment`, `post` (`title`, `url`), `actions` (one `{ action, label, url }` each for approve, spam and delete), `queueUrl`.                |
| `comment-digest`   | An hourly or daily digest of what is waiting.    | `items` (one `{ comment, post, actions }` each), `total` waiting, `more` beyond the ones listed, the `mode` that asked for it, `queueUrl`. |
| `comment-reply`    | A reply to somebody's comment was approved.      | `reply`, `comment` (the one it answers), `post`, `unsubscribeUrl`.                                                                         |
| `contact-message`  | Somebody filled in a page's contact form.        | `message` (`id`, `subject`, `text`, `received`), `from` (`name`, `email`), `page` (`slug`, `permalink`, `title`, `url`), `messagesUrl`.    |

The `comment` inside each of a digest's `items` is the same shape as
`comment-pending`'s, and its `actions` are the same three links, minted per
recipient because each is spent the first time it is used. A digest is built
from the queue as it stands when it is sent, so an item moderated in the
meantime is simply not in it, and no digest is sent to somebody with an empty
queue.

`comment` and `reply` above are the same shape: `author`, `website`, `source`
(`comment` or `webmention`), `kind`, `text`, `html`, `submitted`, and `url`.
The commenter's email address is deliberately **not** among them — the message
goes to a moderator, but it also goes through a mail provider's servers, and
nothing on that screen needs it.

The links in `actions` and `unsubscribeUrl` each carry a signed token and work
without a login. Print them; do not try to build one.

`contact-message` is sent with reply-to set to the sender, so answering it in a
mail reader answers the person who wrote it. `message.text` is plain text as it
was typed — print it, do not render it as Markdown or as HTML.

The subject and the plain text body render with autoescaping **off**, because
neither is HTML: `&` between two query parameters stays an `&`, and an
apostrophe in somebody's name stays an apostrophe. The HTML twin escapes as
every other template does.

The context is `site` (that is `content/_data/site.json`), `baseUrl`, and
whatever the feature that sent it passed as `data`. The `date`, `url` and
`absoluteUrl` filters are the same ones a page has, so a message can write a
link with `{{ "/admin/" | absoluteUrl }}`.

Writing `mail/welcome.txt.njk` into the theme is enough to add a message this
package never shipped; nothing has to be registered.
