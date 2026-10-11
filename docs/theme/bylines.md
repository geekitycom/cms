# Bylines and author archives

`author` on a document is the person the front matter names, resolved against
the site's users. The fields come from their profile on **Users** in the admin,
which is the one place identity is written:

| Key               | What it holds                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `author.name`     | What to print: their display name, else their username, else the raw name the file gives.                      |
| `author.url`      | Their archive, `/author/{username}/`. **Absent** when the name is nobody this site has.                        |
| `author.username` | Their login. Absent for the same reason `url` is.                                                              |
| `author.bio`      | What they wrote about themselves, when they wrote any.                                                         |
| `author.avatar`   | Their picture, as a path or URL. Absent when they have none.                                                   |
| `author.jobTitle` | What they do, when their profile says.                                                                         |
| `author.location` | Where they are, as they wrote it.                                                                              |
| `author.links`    | `{ label, href }` for each link on their profile, in the order they listed them. Absent when they listed none. |

`author` is absent altogether when the document names no author, so anything
printing it is `{% if author %}`. Guard the link with `{% if author.url %}`: a
file may name somebody who has no account here — a guest post, or a colleague
whose account has gone — and that name is still printed, it simply links
nowhere. [The bio](page-shell.md#the-bio) does both, and is what the theme prints instead of
the `partials/byline.njk` it used to have.

`layouts/author.njk` is that person's archive, at `/author/{username}/`, with
their pages at `/author/{username}/page/2/` and their three feeds under
`/author/{username}/feed/`. It is headed with their name and then the bio —
the avatar, the note and the `rel="me"` links, the same card that ends each of
their posts — and lists their published posts newest first. The source design has no author archive, so
the heading is the CMS's own; the h-card under it is the one partial the theme
has. A user with no profile still has one; they are called by their username.

`siteAuthor` is the same object on a different question: not who wrote this
document, but who the page in front of the reader is by. It is what the bio and
any structured data a theme emits should both read, so that what a reader sees
and what a machine reads cannot drift apart. The footer does not read it at
all: the site's links are `menus.footer`, typed rather than borrowed from an
account. It resolves in this order:

- the document's own `author`, on a post or a page that names one;
- the person whose archive it is, on an author archive;
- the site author, `soloAuthor`, everywhere else — the home page, a taxonomy
  archive, a page that names nobody, the 404.

It is **absent** when none of those name anybody this site has, which on a
site with several authors is every page about nobody in particular. Write
`{% if siteAuthor %}` around the bio.

The URL is not only a page. Each user is an ActivityPub actor at that address,
so it is the page a follower lands on when they click through from the
fediverse. `author` is therefore a reserved first URL segment, like `tag` and
`feed`: no document can be permalinked under it and no taxonomy base can take
it.
