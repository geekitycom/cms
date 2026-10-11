# Email

The CMS sends its mail through one service and one seam. Everything that will
ever email — the Send test email button, and the password resets, moderation
notices and contact messages built on it — calls `cms.mail.send()`, and what
carries the message is decided in one place.

**A site with no mail configuration still works.** `send` writes a line in the
log saying the message was not sent and resolves successfully, so nothing that
emails is a feature that breaks without a mail account.

## Configuring it

Two halves, kept apart for the reason the Akismet key is kept out of
`site.json`:

| Where                     | What                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `content/_data/site.json` | `mailProvider`, `mailFromName`, `mailFromAddress`, `mailReplyTo`, `contactEmail`. |
| `data/mail.json`          | The Brevo API key, and the SMTP host, port, TLS flag, user and password.          |

`site.json` is public, in git and published with the site; `data/mail.json` is
private, mode `0600`, and sits beside the password hashes and the users'
private keys. No key or password is ever written to `site.json` and none is
ever printed back into the settings screen — the panel shows the last four
characters of an API key and the host and user of an SMTP connection, which is
enough to tell what is stored and not enough to use it. Leaving a secret field
blank keeps the one already stored, so the SMTP port can be corrected without
retyping the password. **Remove credentials** forgets both.

The panel draws the boxes of the provider that is saved and no others: an API
key on a Brevo site, a host, port, TLS flag, user and password on an SMTP one,
and nothing at all on a site sending through neither. It follows what is in
`site.json` rather than what the Provider select above it is showing, so
choosing a different provider there takes a **Save settings** before its boxes
appear — the panel says as much. A credential stored for the provider that is
not the chosen one still gets a line of its own, because it is still on disk
and **Remove credentials** is still what forgets it.

Both files are read on every send, so a credential pasted into the settings
screen sends the next message and one removed stops the message after it.
Neither needs a restart.

`mailFromAddress` should be an address the provider has verified; empty falls
back to `no-reply@` at the site's host, which most providers will refuse.

## The two providers

| `mailProvider` | What it is                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| `none`         | Nothing is sent. The default.                                                         |
| `brevo`        | `POST https://api.brevo.com/v3/smtp/email` with an `api-key` header. No open sockets. |
| `smtp`         | Any SMTP server, through nodemailer — including Brevo's own relay.                    |

## Send test email

The Email settings page has an address field and a button that sends the `test`
message through the whole chain — the template, the From line, the provider and
the retry — and reports what came back, the provider's own words and its
message id included. It is the one thing that proves mail works before somebody
needs it to.

It is on the page only where the site can actually send — a provider chosen and
its credential stored. Without one the only thing the button could report is
that it did nothing.

## Queue, retries and the log

Messages go on one queue and are sent one at a time, so a provider that hangs
delays the next message and nothing else. A refused message is tried three
times, waiting two seconds, then eight; every attempt is logged with its
outcome and, when it went, the provider's message id, so a message somebody
never received can be traced to the attempt that carried it. `send` never
throws — a failure is a result with `ok: false` and the provider's own words in
`error`.

## Messages

Messages are Nunjucks templates under `mail/` in the theme, resolved the way
every other template is: the theme the site has chosen first, the packaged theme
second, file by file. Each is up to three files — `mail/<name>.subject.njk`,
`mail/<name>.txt.njk` (required) and `mail/<name>.html.njk` — so a site can
replace the text of a message and keep the subject the package ships, or add a
message the package never had. The full table is in
[Mail templates](theme/mail-templates.md).

## From an entry file, and from a test

```ts
const result = await cms.mail.send({
  to: 'ada@example.com',
  template: 'test',
  data: { name: 'Ada' },
});
result.ok; // true, whether it went or the site sends no mail
result.skipped; // true when the site sends no mail
```

`sendRaw({ to, subject, text, html })` is the same thing for a message the
caller built itself. Both resolve when the message has been sent, given up on
or skipped; a caller that does not care drops the promise with `void`.

A test names a provider in the config and reads back what would have gone out.
It wins outright over the settings and `data/mail.json`, the way a
`commentChecker` wins over the Akismet key:

```ts
import { createCms, createMemoryMailProvider } from '@geekity/cms';

const provider = createMemoryMailProvider();
const cms = createCms({
  mail: { provider, backoffMs: () => 0 },
});

// …
provider.sent[0].subject;
provider.failNext(2); // watch the retry without waiting for it
```

`mail` also takes `attempts`, `backoffMs` and `logger`, which is how a test
proves the retry without spending ten seconds on it.
