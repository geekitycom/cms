# Filters

| Filter                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date(format, zone, locale)` | Formats a `Date` or a date string. See [The `date` filter](#the-date-filter).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `plural(forms, locale)`      | Picks the form for a count by its plural category in the site's locale, through `Intl.PluralRules`: `{{ n \| plural({ one: "# reply", other: "# replies" }) }}`. The keys are the CLDR categories (`zero`, `one`, `two`, `few`, `many`, `other`). A category that the forms leave out falls back to `other`. `#` is the count in the locale's digits. Pass `locale` when the strings are in a language of their own. The default theme's words are English, so it passes `"en"`.    |
| `url`                        | Prefixes a root-relative path with the base URL's path. A site served from a subdirectory then links correctly. Eleventy has a filter of the same name.                                                                                                                                                                                                                                                                                                                             |
| `absoluteUrl`                | The same path as a fully qualified URL against the site's `baseUrl`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `asset`                      | The URL of a file in the theme's `static/` directory, with the base path in front and a hash of the file's bytes on the end: `{{ "style.css" \| asset }}` gives `/theme/style.css?v=3f2a9c01b7d4`. The server looks the file up the same way `/theme/` does, the chosen theme first. It serves a hashed URL with `Cache-Control: public, max-age=31536000, immutable`. Editing the file changes the hash on the next render. A file that no theme has gets its plain `/theme/` URL. |
| `fediverseHandle`            | The fediverse handle of a username on this site, `@user@host`, the same account WebFinger answers for (TASK-202): `{{ siteAuthor.username \| fediverseHandle }}` gives `@ada@example.com`. The host is the `baseUrl` host, port included. An empty or non-string value gives the empty string.                                                                                                                                                                                      |
| `host`                       | The hostname of a URL: `{{ "https://example.com/post" \| host }}` gives `example.com`. A value that does not parse as a URL is returned as it is. A non-string value gives the empty string.                                                                                                                                                                                                                                                                                        |

## The `date` filter

`format` defaults to `readable`.

| Format                    | Output                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| `long`                    | `2 September 2026` on an `en` site, `2 septembre 2026` on an `fr` one. |
| `readable` (the default)  | The same as `long`.                                                    |
| `full`, `medium`, `short` | Intl's other date styles.                                              |
| `datetime`                | `10 October 2026 at 09:00 GMT-5`: the day, the time and the zone name. |
| `month`                   | `September 2026`.                                                      |
| `year`                    | `2026`.                                                                |
| `html`                    | `2026-09-02`, for a `<time datetime>`.                                 |
| `iso`                     | The full ISO 8601 instant.                                             |

- Every format except `html` and `iso` is in the site's locale. The locale is
  the `locale` setting, or the `language` setting when `locale` is empty.
- Bare `en` puts the day first, as `en-GB` does. `en-US` gives
  `September 2, 2026`.
- A date in a file is a UTC instant. Every format except `iso` is in the
  site's `timezone` setting. `iso` stays the instant.
- Pass `zone`, an IANA name, to override the timezone for one call.
- Pass `locale`, a BCP 47 tag, to write the words in another language for one
  call. `locale` comes after `zone`, so pass `none` as the zone to keep the
  site's timezone: `{{ date | date("readable", none, lang) }}`.
- An empty locale, or a value that is not a tag, gives the site's locale.
- A value that is not a date renders as the empty string.

`date` also accepts the word `now`: `{{ "now" | date("year") }}` is the year
when the page renders, in the site's timezone. The footer's copyright line uses
it. No file carries this date.

### Dates in another language

The default theme passes the document's `lang` as the locale for every date
inside its `<article>`:

- the Published and Updated lines
- the hidden heading of a note
- the kicker in a listing or a search result (`kicker.line(…,
lang=post.lang)`)
- the date of the post that a reply answers

A post with `lang: fr` on an `en` site reads `Published 2 septembre 2026`. The
navigation, the conversation under the post, the archive's month headings and
the footer stay in the site's locale. To do the same in your theme, pass
`lang` on an entry and `post.lang` in a listing. A theme that passes no locale
writes every date in the site's locale.

## Nunjucks filters

All of Nunjucks' own filters are available, for example `default`, `join`,
`urlencode` and `safe`. Autoescaping is on. Rendered Markdown is the only value
you pass through `safe`.
