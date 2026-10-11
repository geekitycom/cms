# The admin

Booting also mounts the admin at `/admin`. It is server-rendered from templates
that ship inside the package, deliberately outside the theme search path: a
site's theme may override any public template, and must not be able to
shadow the login form.

| Route                                            | What it does                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `/admin`                                         | The dashboard: counts, the five most recent posts, the follower count.                        |
| `/admin/posts`, `/admin/pages`                   | The listings and the editors.                                                                 |
| `/admin/tags`, `/admin/categories`               | Every term in use, with rename, merge and delete.                                             |
| `/admin/tags/rename`, `/admin/categories/rename` | `POST` only. Renames a term, or merges it into one that exists.                               |
| `/admin/tags/delete`, `/admin/categories/delete` | `POST` only. Takes a term out of every file.                                                  |
| `/admin/navigation`                              | Navigation > Menus: every menu the site holds. `POST` saves one menu's items.                 |
| `/admin/navigation/add`                          | `POST` only. Adds an empty menu under the name the form gives.                                |
| `/admin/navigation/delete`                       | `POST` only. Deletes one menu the active theme renders nowhere.                               |
| `/admin/media`                                   | Everything under `content/uploads`, with the URL, the Markdown and what uses it.              |
| `/admin/media/upload`                            | `POST` only. Stores one file by the rules the editor's upload enforces.                       |
| `/admin/media/delete`                            | `POST` only. Deletes one upload, asking first when a document points at it.                   |
| `/admin/media/alt`                               | `POST` only. Sets a picture's alt text, or marks it decorative, in `media.json`.              |
| `/admin/comments`                                | Pending, approved and spam, with approve, spam, delete and reply.                             |
| `/admin/comments/moderate`                       | `POST` only. Approves one comment, files it as spam, or deletes it.                           |
| `/admin/comments/reply`                          | `POST` only. Posts an approved reply under the comment it answers.                            |
| `/admin/messages`                                | The contact form's inbox, with a Spam list beside it.                                         |
| `/admin/messages/read`                           | `POST` only. Marks one message read, or unread again.                                         |
| `/admin/messages/delete`                         | `POST` only. Deletes one message, and its file with it.                                       |
| `/admin/appearance/themes`                       | Appearance > Themes: the themes on disk. `POST` activates the one named.                      |
| `/admin/plugins`                                 | Plugins: every installed plugin, and Enable and Disable.                                      |
| `/admin/plugins/<package name>`                  | A running plugin's own screen, such as `/admin/plugins/@geekity/plugin-wordpress`.            |
| `/admin/tools`                                   | Tools > Content index: what the index holds, and the button that rebuilds it.                 |
| `/admin/tools/rebuild-index`                     | `POST` only. Offers the rebuild, then reads every file again on the live site.                |
| `/admin/settings`                                | Settings > General: title, tagline, author, base URL, time zone, language, locale, site icon. |
| `/admin/settings/reading`                        | What the homepage displays, posts per page, the notify server.                                |
| `/admin/settings/permalinks`                     | The tag and category bases, and the archive redirects already recorded.                       |
| `/admin/settings/discussion`                     | Comments and the closing window, webmentions, and the Akismet key.                            |
| `/admin/settings/akismet`                        | `POST` only. Saves the Akismet key, or forgets it.                                            |
| `/admin/settings/email`                          | The mail provider, the From line, the reply-to and the contact address.                       |
| `/admin/settings/mail`                           | `POST` only. Saves a mail credential, or forgets every one of them.                           |
| `/admin/settings/mail/test`                      | `POST` only. Sends the theme's test message through the whole chain.                          |
| `/admin/users`                                   | Who may sign in: a row each, with Edit and Delete. Nothing on it edits anybody.               |
| `/admin/users/new`                               | Users > Add new: the add form. `POST` adds one.                                               |
| `/admin/users/<id>`                              | One user: the account, the profile, the notices, your password, and the delete.               |
| `/admin/users/password`                          | `POST` only. Changes the signed-in admin's own password.                                      |
| `/admin/users/email`                             | `POST` only. Sets or clears the email address on the user the form names.                     |
| `/admin/users/profile`                           | `POST` only. Saves the whole public profile of the user the form names.                       |
| `/admin/users/notifications`                     | `POST` only. Turns one notice on or off for the user the form names.                          |
| `/admin/users/notifications/mode`                | `POST` only. Sets how often that notice arrives: as they arrive, hourly or daily.             |
| `/admin/users/delete`                            | `POST` only. Deletes the user the form names.                                                 |
| `/admin/federation`                              | The actors, their followers, the inbox log, and per-post delivery.                            |
| `/admin/federation/settings`                     | Federation > Settings: the relays the site subscribes to.                                     |
| `/admin/federation/resend`                       | `POST` only. Sends one post to the followers again, as its file now reads.                    |
| `/admin/setup`                                   | First run: creates the first admin. Closed once a user exists.                                |
| `/admin/login`                                   | Username and password.                                                                        |
| `/admin/logout`                                  | `POST` only. Deletes the session row and sends `Clear-Site-Data`.                             |
| `/admin/_static/*`                               | The admin's own stylesheet and scripts, cached for an hour.                                   |

The screens behind the login share one layout: a bar across the top with the
site name and a link to the public site, the menu down the left, and a place for
flash messages. A message queued with `flash(c, 'notice', '…')` is kept on the
session row, shown on the next page the browser asks for, and cleared as it is
read, so it survives exactly one redirect.

## The admin's look

The admin is drawn in DaisyUI 5 on Tailwind v4 (decision-30). Its stylesheet,
`admin/static/admin.css`, is compiled at build time from `admin/src/admin.css`
and ships in the package like the default theme's. It carries every built-in
DaisyUI theme, with `light` as the default and `dark` when the system prefers
dark. A site cannot override it or add a theme of its own.

The admin bar is the same component on the admin and across the top of every
public page a signed-in user reads: a `<geekity-admin-bar>` element holding a
declarative shadow root, so neither the site theme nor the admin's theme
reaches inside it. It draws in a light or a dark palette of its own, following
the user's admin theme. On a public page it pushes the page down by
`--geekity-admin-bar-height` and adds the `geekity-admin-bar` class to
`<html>` for a theme that needs to make room of its own.

Each user picks the theme the admin is drawn in for themselves, on their own
screen under Users: any built-in DaisyUI theme, or Follow the system. The
choice is stored as `adminTheme` on the user in `data/users.json`, and every
admin page drawn for that user carries it as `data-theme` on `<html>`. Following
the system stores nothing and puts no `data-theme` on the page. The login,
setup, forgot-password and reset screens never carry one.

The stylesheet is a build product, like the default theme's. Its source is
Tailwind in full, Preflight included, and the DaisyUI 5 plugin. `pnpm build`,
and the package's `pretest`, compile it to `packages/cms/admin/static/admin.css`,
which is gitignored. `pnpm --filter @geekity/cms build:admin` compiles it
alone. Tailwind reads class names from the templates under `admin/` and from
`editor/look.ts`.

## The menu

The menu is WordPress classic: twelve sections — Dashboard, Posts, Pages,
Navigation, Media, Comments, Messages, Appearance, Users, Tools, Settings,
Federation — each a heading over one or more children. Clicking a heading opens the section and lands on its first
child; the open section shows its children and the one you are on carries
`aria-current="page"`, so Users tells you that you are on Users > All users.
Tags and categories are children of Posts, because a tag with no post on it is
nothing. Every section has at least one child even when it has one screen, so
the rule never needs an exception and a second child can appear later without
the menu changing shape. There is no JavaScript in it: the server knows which
section is open, so expanding one is a page rather than a script.

The whole menu is `ADMIN_SECTIONS` in `src/admin/menu.ts`. A site's own screen
joins it in two steps:

```ts
// 1. One entry in the section's children, naming the screen and its URL.
{ child: 'imports', label: 'Imports', url: '/admin/imports' }

// 2. The same pair on whatever that screen renders.
render(c, 'layouts/imports.njk', { section: 'posts', child: 'imports' });
```

Nothing else changes: the heading, the landing URL and the marking all follow.
A screen naming a section or a child the registry does not hold throws
`UnknownAdminScreenError` rather than rendering a menu expanded around nothing,
so the mistake is a failed test instead of a menu that quietly marks nothing.

## The admin editor

The editor at `/admin/posts/{slug}` is a plain form. The body is a
`<textarea>`, the Preview button submits that form to `/admin/preview` in a new
tab, and both work with JavaScript switched off — which is the shape everything
below has to preserve.

`packages/cms/admin/static/editor.js` upgrades it when it loads. CodeMirror 6
in Markdown mode takes over the textarea's _view_ while the textarea itself
stays in the form as the value that is submitted; the Preview button becomes a
Write/Preview tab that posts the current body and shows the answer in a
sandboxed frame; and an "Add file…" button, or a file dropped on the editor,
posts to `/admin/uploads` and pastes the Markdown it gets back at the cursor.

That file is a build product, not source. The source is
`packages/cms/editor/main.ts`, which has a `tsconfig.json` of its own — the DOM
lib, no node types — and is bundled by esbuild in `scripts/build-editor.js`.
`pnpm build` runs the bundler after `tsc`, so an install (through the root
`prepare` script), a CI job and a publish all produce it; `admin/` is already in
the package's `files`, so it ships. It is gitignored, and CodeMirror is a
devDependency: nothing is fetched from a CDN, and the admin works offline.

`POST /admin/preview` renders through the same `renderMarkdown` and the same
theme layout the public site uses, so what the preview shows is what publishing
would put on the site, theme overrides included. It writes nothing.

A post the site does not publish yet can also be read at its own permalink
while you are signed in: a draft, a scheduled post, or one whose visibility the
site does not recognize. That is the URL a Micropub app such as iA Writer opens
after it posts a draft. The page is drawn by the theme as it will be published,
under a banner that says why it is not published and that only signed-in users
can see it. It answers `Cache-Control: private, no-store`,
`X-Robots-Tag: noindex` and a robots `noindex` meta, with no `ETag` or
`Last-Modified`, so no shared cache keeps it and no later request revalidates
against it. Only the HTML page is served this way. Its `.md` and `.json`
representations and its ActivityStreams object still answer 404, and it stays
off every list, feed, the sitemap and search, for you as for everybody. To
anybody not signed in the permalink answers exactly as a URL nothing lives at
does, with the same 404, body and headers. A post in the trash answers 404 to
everybody.

`POST /admin/uploads` stores one file at
`content/uploads/{yyyy}/{mm}/{slug}{ext}` and answers with `{ url, markdown }`.
A name is never overwritten: a second `photo.png` becomes `photo-2.png`. Three
things have to agree before anything is written — the extension is on the
site's allowlist, the media type the browser declared is one that extension may
have, and the file's first bytes are that format's — and a file that is too
big gets a 413 and one of the wrong type a 415, both as JSON. See
[`uploadMaxBytes`, `uploadMediaMaxBytes` and `uploadTypes`](configuration.md#uploads-and-images). The
check on `Content-Length` that runs before the body is read lets through
anything the larger of the two limits would, and the file is then held to its
own kind's limit. The same rules run behind
[the media library](media.md#the-media-library), which is a form rather than a `fetch`,
so a body over the limit posted from a browser gets that 413 as plain text
instead.

Both endpoints are behind the admin's guard and need the session's CSRF token,
like every other POST in the admin.

The editor's Visibility field chooses Public or Unlisted. An unlisted post or
page is served at its URL with a `noindex`, federates to the followers with
Public in `cc`, and is left off the home page, every archive and feed, the
sitemap, search, `llms.txt` and IndexNow. A value the site does not recognize,
such as a hand-typed `visibility: private`, hides the post like a draft until
you choose one.
[Unlisted posts](content.md#unlisted-posts) has the whole table.

## Users

`/admin/users` is who may sign in. There is one role — doc-5 puts anything
beyond admin out of scope for phase one. The first admin comes from
`/admin/setup` or from
[`geekity user add`](cli.md#creating-an-admin-from-the-command-line). Every one
after that comes from `/admin/users`, which lists who may sign in and adds a
user with a password you supply or one it generates and shows once. The list
is a listing and nothing more: a username with the archive URL under it, the
email address, when the account was made, and Edit and Delete. Every field
lives on that person's own screen at `/admin/users/<id>`, where each box has a
label beside it — the account and its email address, the public profile, what
this person is emailed about, your own password on your own page, and the
delete or the sentence saying why this account cannot go. Each Save lands back
on that screen, so it shows its own result.

**`data/users.json` is the source.** One entry per user with an id, a
username, an argon2 hash and a created time — and, for a user who has them, an
email address, notification preferences, a public profile and the
[stored actor id](federation.md#a-users-stored-actor-id) they were published
under elsewhere. It is written the way every file this CMS owns is written: to
a temporary file beside it, renamed over the old one, with the read and the
write as one step nothing else writing that file can get between, so two
admins adding the same name at once cannot both succeed, and with `0600`
permissions, so nobody but the account the site runs as can read it. It is in
`data/` rather than `content/` because `content/` is published and in git, and
back it up: `data/geekity.db` may be deleted at any moment and rebuilt, but
this file cannot be rebuilt from anything.

Sessions stay in SQLite, where the rest of the cache lives, which is what makes
them cheap to throw away. They name a user by id and are joined against the
file on every admin request, so a session whose user is no longer there is not
a login: deleting `data/geekity.db` signs everybody out and loses nothing else,
and restoring an old one cannot bring back an account that was deleted or a
password that was changed.

Passwords are hashed with argon2id through `node:crypto`, so there is no native
module to build. The cost parameters travel with each hash, which means raising
them later leaves every password already stored verifiable.

A session id is 256 random bits in a `HttpOnly; SameSite=Lax; Path=/` cookie.
When `baseUrl` is an `https` URL the cookie is `Secure` and named
`__Host-geekity_session`; over plain http it is `geekity_session`, as
[Session hardening](security.md#session-hardening) explains. It lasts `sessionLifetime`;
an expired session is deleted rather than merely ignored. Every mutating admin
form carries a per-session CSRF token, and a `POST` without a valid one is
refused with 403 — including the login and setup forms,
which get the token from a short anonymous session created when the form is
first rendered. Logging in throws that session away and starts a new one, so a
planted session id cannot become a logged-in one.

Adding a user enforces exactly the rules `/admin/setup` and
`geekity user add` do: a username of 1 to 64 letters, digits, dots, dashes or
underscores, and a password of at least 8 characters. Tick **Generate one
instead** and the server makes the password itself, from `randomInt` over an
alphabet with no `0`/`O` or `1`/`l`, and shows it once in the flash on the next
page. The flash lives on the session row, so a generated password is never in a
URL, a cookie or a browser's history, and it is never stored in the clear —
leave that page without copying it and the only way back is to delete the user
and add them again.

Changing your own password asks for the current one first, then ends **every
other session that login has** and spares the one you are using. That is the
point of the screen: the reason to change a password is usually that somebody
else may have it, and a change that left the other browsers signed in would not
have fixed anything. The flash says how many were signed out. Changing somebody
else's password is deliberately not offered — a fresh account is the honest way
to hand a colleague a login, and it keeps the current-password check meaningful.

Deleting a user takes their sessions with them, and any that outlive the
deletion — in a database restored from a backup, say — are refused on sight,
because the file no longer holds the person they name. Two deletions are
refused, and the table only renders a button for rows that are neither:

- **The last remaining user.** A site with no users falls back into first-run
  setup, and the next person to reach `/admin` becomes its admin.
- **Your own account.** It would end the session doing the deleting, and there
  is no undo. Another admin can do it for you.

**A profile's links** are typed one per line, either `Label | URL` or a bare
URL that labels itself, and the URL is a path or an absolute `http(s)` one with
no spaces in it — the rule a menu item's URL is held to. It is the same line in
both boxes, down to the `rel` values it may end in, so
`Mastodon | https://example.social/@me | me` means here what it means on the
Navigation screen. Every one of these links is published `rel="me"` whether or
not it is typed, which is how Mastodon verifies a profile field pointing back
at this site and how IndieAuth knows the link is yours; nothing else in Geekity
asks for it. Typing `| me` is therefore a no-op rather than a second value, and
`| me nofollow author` puts all three on the rendered `rel`. A link stored
before the box was checked still renders and still comes back in the box; a
line that is still not a link is refused when the panel is saved, with the line
to fix named.

A form with a problem comes back with a 400, one message under each field, and
nothing written. The add form keeps the username that was typed; the password
forms keep nothing, because a password does not belong in rendered HTML.

**An email address is optional**, on the add form and inline on any row —
including somebody else's, since with one role every user already has every
power there is, and an admin who has just added a colleague should be able to
put their address in without waiting for them. Clearing the box removes it. It
never appears on the public site. `geekity user add ada --email ada@example.com`
sets one from a shell.

What the address buys is **getting back in without a shell**, through
[password recovery](security.md#forgotten-passwords), and the notices
[a comment sets off](comments.md#being-told-about-one). Beside it is which of
those notices go to it: one switch per event, on by default, stored in
`data/users.json` only when somebody turns one off.

A site whose database was written by a version that kept the accounts in a
`users` table has those rows written into `data/users.json` on the first boot
of this one — ids and hashes as they stand, so nobody has to log in again — and
the table is dropped. A `users.json` that is already there wins and is left
alone.

Creating one from your own code, which is what the CLI does:

```ts
import { createUser } from '@geekity/cms';

await createUser({
  dataDir: 'data',
  username: 'ada',
  password: process.env.PASSWORD ?? '',
});
```

## Navigation

A menu is a named thing the site stores and the theme asks for.

**The site stores menus by name.** `content/_data/site.json` holds a `menus`
object keyed by the name of each menu, each an ordered list of items:

```json
{
  "menus": {
    "primary": [{ "label": "About", "url": "/about/" }],
    "footer": [
      { "label": "Colophon", "url": "/colophon/" },
      { "label": "Mastodon", "url": "https://example.social/@me", "rel": "me" }
    ]
  }
}
```

An item is a label, a URL and the `rel` values it carries. The URL is a
site-root path or an absolute `http(s)` URL; anything else is refused. `rel` is
one string holding every value — `"me"`, `"nofollow noopener"` — present only
when there is one, lower case and each value said once, and a theme prints it
as the whole of the link's `rel` attribute. The values are whatever HTML link
types the site wants; `me` is the one most menus have, because it is how
Mastodon and the rest of the IndieWeb verify that the site and the profile it
links are the same person. An item written `"me": true`, the spelling before
`rel` held a list, is still read as `"rel": "me"`.

**The theme declares the areas it renders.** `theme.json` carries an `areas`
list, each entry a `name` — the key under `menus` — and a `label` a person
reads:

```json
{ "areas": [{ "name": "primary", "label": "Site menu" }] }
```

The packaged theme declares `primary` ("Site menu") and `footer` ("Footer
links"). A theme that wants a third declares it; an `areas` that is missing or
unreadable leaves that theme declaring none rather than failing to load it, and
the Navigation screen then offers the packaged theme's — a site theme is laid
over the packaged one a file at a time, so a theme that has declared nothing has
not overridden the declaration, and its inherited `layouts/base.njk` really is
still rendering `menus.primary` and `menus.footer`.

**A theme renders a menu by name.** Every template gets `menus`, keyed by the
same names, each item already marked `current` for the path being rendered.
`{% for item in menus.footer %}` is the whole interface, so a site theme can
render a menu the packaged theme has never heard of. Every stored menu is on
the context, not only the declared ones: the declaration is what the screen
that edits menus reads, and a menu nothing loops over is rendered nowhere and
kept — which is how somebody writes the menu a theme will use before switching
to that theme.

**The menus are managed on `/admin/navigation`.** It is a top-level section
after Pages rather than a settings page: a menu is content a site arranges, the
way its pages are, and the shape of the screen comes from the active theme.
The screen is two lists. First the areas that theme declares, in the theme's
order and under its labels — an area the site has never filled in is an empty
box, not a missing one. Then every other stored menu, under a heading saying
this theme renders them nowhere; those are still editable, which is how the
menu a theme will use is written before the site switches to it, and each has
the Delete that is the only way a menu is removed. An area the theme declares
is emptied rather than deleted: the theme goes on asking for the name, and the
box has to stay for the next thing typed into it.

Each menu is one box of `Label | URL` lines, rendered in the order they are
typed, with the item whose path is the one being read marked `aria-current`, and a
line may end in the `rel` values the link carries, a word each — `Mastodon |
https://example.social/@me | me`, `A source | https://example.com/thing |
nofollow noopener`. The values come off the end of the line only while the last
bar-separated part reads as a list of them, so a URL holding a bar survives:
`Odd | /odd/?a=1|2` keeps its query string, because `2` is not a word. A line
that is not an item is refused by name, with the box still holding every line of
what was typed, and nothing written. It is the same line the Links box on a
profile takes.

**A menu name** is lower-case ASCII letters, digits and underscores, starting
with a letter, at most 32 characters. It is the word a theme writes after the
dot — `{% for item in menus.footer %}` — so a dash is refused: after a dot it
is a minus sign, and `menus.top-bar` renders nothing and raises nothing. Lower
case is the rest of the rule and it is what refuses the confusable spellings:
`Footer` is refused rather than quietly lowered, because `footer` and `Footer`
would be two menus on one screen that nothing could tell apart. A name the site
already holds is refused too, and the message says its box is already on the
page. The rule governs a name somebody types; a name a `theme.json` declares is
a menu name by declaration and is shown as the theme spells it, because a
screen that hid a declared area over a spelling would leave somebody unable to
fill in a menu their site renders.

There is no second source. A page cannot put itself in a menu, so there is one
screen to edit it on, one order, and no way for the same link to appear twice.
A page that should be linked is linked by typing a line for it — including the
page a site serves as its front page, which is typed `Home | /`, the URL a
reader lands on, rather than at the permalink that redirects there.

Because the menus live in `site.json`, an Eleventy build renders the same ones;
the example config assembles them as `collections.menus`. See
[Navigation](theme/navigation.md) for how the default theme prints them. A `menus` in a
hand-edited `site.json` that is not an object of lists of items yields no menu
rather than an error, exactly as a bad archive base falls back rather than
taking the site down.

## Tags and categories

`/admin/tags` and `/admin/categories` list every term in use with two counts and
a link to its archive: **Posts**, what the public site lists under it, and
**Files**, every file carrying it — drafts, scheduled posts and the trash
included. The second is the one to look at before acting, because it is what an
action is about to rewrite.

Three things can be done to a term, and all three are the same operation. Typing
a new name into a row's field and pressing Rename rewrites the front matter of
every file carrying it. Renaming onto a term that already exists is a **merge**:
the screen comes back with a question naming both counts, and only a confirmed
form goes through, because a merge cannot be undone by renaming back. A file
that carried both terms keeps the target once, in the place it already had.
Delete takes the term out of every file and leaves everything else alone.

Each of them says how many files it wrote. The files are the truth (decision-1), so
each file is re-read and re-parsed from disk before it is rewritten rather than
being taken from the index: the index can be a moment behind a hand edit, and a
bulk rewrite that trusted it would put that edit back. A file that has gone or
will not parse is skipped, counted, and named in the message.

Every rewrite is announced the way an editor save is, so the index, the feeds,
the notify server and the fediverse all follow — one `Update` per
affected published post, because the hashtags on those posts have just changed.
A term on many published posts is therefore many deliveries; that is the point,
but it is worth knowing before renaming a tag that half the archive carries.

A rename moves an archive, and an archive is a URL somebody may have linked to,
so the site records the move in a `taxonomyRedirects` list — `{ taxonomy, from,
to }` — in `content/_data/site.json` with the rest of the settings. The
old archive URL and its feed then answer `301` to the new ones. Chains are
collapsed as they are recorded, so `a → b` followed by `b → c` is stored as
`a → c` and answered in one hop; a term that comes back into use is served
rather than redirected; and deleting a term drops every record pointing at it,
because a redirect to a 404 is worse than the 404.
