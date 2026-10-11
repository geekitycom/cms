# Email

The CMS sends all mail through one service. Every feature that sends email
calls `cms.mail.send()`, and one place decides what carries the message. This
covers the Send test email button and the features built on it: password
resets, moderation notices and contact messages.

**A site with no mail configuration still works.** `send` logs a line saying
the message was not sent and resolves successfully. No feature that sends email
breaks without a mail account.

## Configuring it

The configuration is in two files. They are separate for the same reason the
Akismet key is kept out of `site.json`:

| Where                     | What                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `content/_data/site.json` | `mailProvider`, `mailFromName`, `mailFromAddress`, `mailReplyTo`, `contactEmail`. |
| `data/mail.json`          | The Brevo API key, and the SMTP host, port, TLS flag, user and password.          |

`site.json` is public, in git and published with the site. `data/mail.json` is
private, has mode `0600`, and is next to the password hashes and the users'
private keys. The site never writes a key or password to `site.json`, and never
prints one back into the settings screen.

The panel shows the last four characters of an API key, and the host and user
of an SMTP connection. That is enough to identify what is stored and not enough
to use it. A secret field left blank keeps the stored value, so you can correct
the SMTP port without typing the password again. **Remove credentials** deletes
both.

The panel shows the fields for the saved provider only:

- On a Brevo site, an API key.
- On an SMTP site, a host, port, TLS flag, user and password.
- On a site that uses neither, no fields.

The panel follows `site.json`, not the current value of the Provider select
above it. After you choose a different provider, press **Save settings** to see
its fields. The panel tells you this. A credential stored for a provider that
is not the chosen one still gets its own line, because it is still on disk and
**Remove credentials** still deletes it.

The site reads both files on every send. A credential pasted into the settings
screen sends the next message, and a removed credential stops the message after
it. Neither change needs a restart.

Set `mailFromAddress` to an address the provider has verified. When it is
empty, the site uses `no-reply@` at the site's host, which most providers
refuse.

## The two providers

| `mailProvider` | What it is                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| `none`         | Nothing is sent. The default.                                                         |
| `brevo`        | `POST https://api.brevo.com/v3/smtp/email` with an `api-key` header. No open sockets. |
| `smtp`         | Any SMTP server through nodemailer, including Brevo's own relay.                      |

## Send test email

The Email settings page has an address field and a button. The button sends the
`test` message through the whole chain: template, From line, provider and
retry. It reports the result, including the provider's own words and its
message id. Use it to prove mail works before a real message depends on it.

The page shows the button only when a provider is chosen and its credential is
stored. Without both, the site cannot send, and the button could only report
that it did nothing.

## Queue, retries and the log

Messages go on one queue and are sent one at a time. A provider that hangs
delays only the next message. The site tries a refused message three times. It
waits two seconds before the second attempt and eight before the third. The log
records every attempt with its outcome and, for a sent message, the provider's
message id. You can trace a message that never arrived to the attempt that
carried it.

`send` never throws. A failure is a result with `ok: false` and the provider's
own words in `error`.

## Messages

Messages are Nunjucks templates under `mail/` in the theme. They resolve the
same way as every other template, file by file: the site's chosen theme first,
then the packaged theme. Each message has up to three files:

- `mail/<name>.subject.njk`
- `mail/<name>.txt.njk` (required)
- `mail/<name>.html.njk`

A site can replace the text of a message and keep the packaged subject, or add
a message the package does not have. The full table is in
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

`sendRaw({ to, subject, text, html })` does the same for a message the caller
built. Both resolve when the message is sent, abandoned or skipped. To ignore
the result, drop the promise with `void`.

A test sets a provider in the config and reads back what the site would have
sent. That provider takes precedence over the settings and `data/mail.json`, as
a `commentChecker` does over the Akismet key:

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

`mail` also takes `attempts`, `backoffMs` and `logger`. A test uses them to
check the retry without waiting ten seconds.
