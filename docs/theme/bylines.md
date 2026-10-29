# Bylines and author archives

`author` on a document is the person that the front matter names, resolved
against the site's users. The fields come from the user's profile on **Users**
in the admin. That screen is the only place where identity is written:

| Key               | What it holds                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `author.name`     | What to print: their display name, else their username, else the raw name the file gives.                      |
| `author.url`      | Their archive, `/author/{username}/`. **Absent** when the name matches no user of the site.                    |
| `author.username` | Their login. Absent for the same reason `url` is.                                                              |
| `author.bio`      | What they wrote about themselves, as the Markdown they typed. Absent when they wrote none.                     |
| `author.bioHtml`  | The bio as HTML, a `<p>` per paragraph. Raw HTML typed in the bio is escaped. Absent with `bio`.               |
| `author.bioText`  | The bio's words with the Markdown removed, for structured data and other plain text. Absent with `bio`.        |
| `author.avatar`   | Their picture, as a path or URL. Absent when they have none.                                                   |
| `author.jobTitle` | What they do, when their profile says.                                                                         |
| `author.location` | Where they are, as they wrote it.                                                                              |
| `author.links`    | `{ label, href }` for each link on their profile, in the order they listed them. Absent when they listed none. |

`author` is absent when the document names no author. Wrap anything that
prints it in `{% if author %}`. Wrap the link in `{% if author.url %}`. A file
can name a person who has no account on the site, such as a guest author or a
colleague whose account was deleted. The theme prints that name without a
link. [The bio](page-shell.md#the-bio) does both.

The bio is a short piece of Markdown: links, emphasis and code, and paragraphs
if it needs them. Print `bioHtml` in HTML, through `safe`, since the CMS
has escaped any raw HTML in it already. Print `bioText` where only text fits,
such as a `meta` description or JSON-LD. `bio` is the Markdown as written, for
a Markdown template. A bio with no Markdown in it reads the same in all three. The theme prints the bio in
place of the `partials/byline.njk` it used to have.

## The author archive

`layouts/author.njk` is the person's archive:

| URL                          | What it is                     |
| ---------------------------- | ------------------------------ |
| `/author/{username}/`        | The first page of the archive. |
| `/author/{username}/page/2/` | Later pages.                   |
| `/author/{username}/feed/`   | The person's three feeds.      |

The heading is the person's name. The bio follows it: the avatar, the note and
the `rel="me"` links, the same card that ends each of their posts. The archive
lists their published posts, newest first. The source design has no author
archive, so the CMS supplies the heading. The h-card under it reuses the
theme's bio partial. A user with no profile still has an archive,
headed with their username.

## `siteAuthor`

`siteAuthor` has the same shape as `author`, but it answers a different
question. `author` is who wrote the document. `siteAuthor` is who the current
page is by. Read `siteAuthor` for both the bio and any structured data the
theme emits, so the two cannot disagree. The footer does not read it. The
site's footer links are `menus.footer`, typed in the admin, not taken from an
account.

`siteAuthor` resolves in this order:

1. The document's own `author`, on a post or a page that names one.
2. The person whose archive it is, on an author archive.
3. The site author, `soloAuthor`, everywhere else: the home page, a taxonomy
   archive, a page that names no author, the 404.

It is **absent** when none of those names a user of the site. On a site with
several authors, that is every page that is not about one person. Wrap the bio
in `{% if siteAuthor %}`.

## The author URL is reserved

Each user is also an ActivityPub actor at `/author/{username}/`. A follower who
clicks through from the fediverse lands on that page. So `author` is a reserved
first URL segment, like `tag` and `feed`. No document can have a permalink
under it, and no taxonomy base can use it.
