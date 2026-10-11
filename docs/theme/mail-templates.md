# Mail templates

The messages the CMS sends are templates under `mail/`. They resolve in the
same order as page templates. For example, a `mail/test.txt.njk` in the site's
theme replaces the text of the test message. The subject and the HTML version
still come from the package. Each message has up to three files:

| File                      | What it is                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `mail/<name>.subject.njk` | The subject. Rendered to a single line. Optional.                  |
| `mail/<name>.txt.njk`     | The plain text body. **Required.**                                 |
| `mail/<name>.html.njk`    | The HTML version. Optional. Without it, the message is plain text. |

If no theme on the search path has the message's `.txt.njk`, sending fails
with an error. A typo in a template name is reported, and no empty email goes
out.

The package ships seven messages:

| Name               | When it goes                                     | What `data` carries                                                                                                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `test`             | Send test email, on Settings.                    | Nothing.                                                                                                                                   |
| `password-reset`   | A user asked to reset a password.                | `username`, `resetUrl`, `expiresAt`, `expiresInHours`.                                                                                     |
| `password-changed` | A reset link was used.                           | `username`, `signedOut` (how many sessions ended).                                                                                         |
| `comment-pending`  | A comment or webmention is waiting for approval. | `comment`, `post` (`title`, `url`), `actions` (one `{ action, label, url }` each for approve, spam and delete), `queueUrl`.                |
| `comment-digest`   | An hourly or daily digest of what is waiting.    | `items` (one `{ comment, post, actions }` each), `total` waiting, `more` beyond the ones listed, the `mode` that asked for it, `queueUrl`. |
| `comment-reply`    | A reply to a visitor's comment was approved.     | `reply`, `comment` (the one it answers), `post`, `unsubscribeUrl`.                                                                         |
| `contact-message`  | A visitor sent a page's contact form.            | `message` (`id`, `subject`, `text`, `received`), `from` (`name`, `email`), `page` (`slug`, `permalink`, `title`, `url`), `messagesUrl`.    |

### Digest items

The `comment` in each of a digest's `items` has the same shape as in
`comment-pending`. Its `actions` are the same three links. The CMS mints the
links for each recipient, because each link stops working after its first
use. The CMS builds a digest from the queue at send time. An item moderated
before then is not in the digest. A recipient with an empty queue gets no
digest.

### Comment fields

`comment` and `reply` have the same shape: `author`, `website`, `source`
(`comment` or `webmention`), `kind`, `text`, `html`, `submitted`, and `url`.
The commenter's email address is **not** in it. Why: the message goes to a
moderator, but it also passes through a mail provider's servers, and the
moderator does not need the address.

### Links and message text

The links in `actions` and `unsubscribeUrl` each carry a signed token and work
without a login. Print them. Do not build your own.

The CMS sends `contact-message` with reply-to set to the sender. A reply from a
mail reader goes to the visitor who wrote the message. `message.text` is plain
text, as the visitor typed it. Print it. Do not render it as Markdown or HTML.

### Escaping

The subject and the plain text body render with autoescaping **off**, because
neither is HTML. An `&` between two query parameters stays an `&`. An
apostrophe in a name stays an apostrophe. The HTML version escapes like every
other template.

### Context

The context has `site` (`content/_data/site.json`), `baseUrl`, and the `data`
that the sending feature passed. The `date`, `url` and `absoluteUrl` filters
are the same as on a page. For example, a message can write a link with
`{{ "/admin/" | absoluteUrl }}`.

To add a message that the package does not ship, write its template, for
example `mail/welcome.txt.njk`, into the theme. You do not need to register it.
