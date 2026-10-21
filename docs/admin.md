# The admin

Booting also mounts the admin at `/admin`. The server renders it from templates
that ship inside the package, outside the theme search path. A site's theme may
override any public template. It must not be able to shadow the login form.

| Route                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                                         | The dashboard. Stat tiles count posts, drafts, pages, followers, comments waiting and unread messages. A Needs attention card appears only when something fails. It counts failed and interrupted jobs, failed federation deliveries and failed webmentions from the last 7 days, federation deliveries Fedify is retrying, and jobs running for over an hour, and links each count to where it is handled. The core's widgets follow. Fediverse shows likes, boosts and replies per day. Followers shows the follower count at the end of each day, with follows and unfollows. Top posts lists the five posts with the most likes, boosts, replies, webmentions and approved comments over the period, each linked to its editor. The next three widgets ignore the period. Recent interactions lists the ten newest comments, webmentions, fediverse likes, boosts and replies, and new followers. Posting activity shows published posts per day over the last 52 weeks and per month over the last 12 months, split by kind, in the site's time zone. Scheduled posts lists the next five posts waiting for their date, with the time each publishes in the site's time zone and a link to its editor, and appears only when a post is waiting. Each enabled plugin's widgets come last. `?period=30` covers 30 days instead of 7. |
| `/admin/posts`, `/admin/pages`                   | The listings and the editors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/admin/posts/new`                               | Choose a kind of post. `?kind=photo` (or another kind) opens that kind's editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/admin/tags`, `/admin/categories`               | Every term in use, with rename, merge and delete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/admin/tags/rename`, `/admin/categories/rename` | `POST` only. Renames a term, or merges it into one that exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/admin/tags/delete`, `/admin/categories/delete` | `POST` only. Takes a term out of every file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/admin/navigation`                              | Navigation > Menus: every menu the site holds. `POST` saves one menu's items.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/admin/navigation/add`                          | `POST` only. Adds an empty menu under the name the form gives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/admin/navigation/delete`                       | `POST` only. Deletes one menu the active theme renders nowhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/admin/media`                                   | Everything under `content/uploads`, with the URL, the Markdown and what uses it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/admin/media/upload`                            | `POST` only. Stores one file by the rules the editor's upload enforces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/admin/media/delete`                            | `POST` only. Deletes one upload, asking first when a document points at it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/admin/media/alt`                               | `POST` only. Sets a picture's alt text, or marks it decorative, in `media.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/admin/comments`                                | Pending, approved and spam, with approve, spam, delete and reply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/admin/comments/moderate`                       | `POST` only. Approves one comment, files it as spam, or deletes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/admin/comments/reply`                          | `POST` only. Posts an approved reply under the comment it answers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/admin/messages`                                | The contact form's inbox, with a Spam list beside it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin/messages/read`                           | `POST` only. Marks one message read, or unread again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin/messages/delete`                         | `POST` only. Deletes one message, and its file with it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/admin/appearance/themes`                       | Appearance > Themes: the themes on disk. `POST` activates the one named.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/admin/plugins`                                 | Plugins: every installed plugin, Enable and Disable, and an Add plugin button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/admin/plugins/add`                             | Add plugin: a package name, an optional version and your password. It installs into the plugins folder and returns to Plugins. A refused or failed install comes back to this page with what was typed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/admin/plugins/<package name>`                  | A running plugin's own screen, such as `/admin/plugins/@geekity/plugin-wordpress`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/admin/tools`                                   | Tools > Content index: what the index holds, and the button that rebuilds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/admin/tools/rebuild-index`                     | `POST` only. Offers the rebuild, then reads every file again on the live site.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/admin/settings`                                | Settings > General: title, tagline, author, base URL, time zone, language, locale, site icon.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/admin/settings/reading`                        | What the homepage displays, posts per page, the notify server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/admin/settings/permalinks`                     | The tag and category bases, and the archive redirects already recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/admin/settings/discussion`                     | Comments, the types that take them and the closing window, webmentions, and the Akismet key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/admin/settings/akismet`                        | `POST` only. Saves the Akismet key, or forgets it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/admin/settings/email`                          | The mail provider, the From line, the reply-to and the contact address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/admin/settings/mail`                           | `POST` only. Saves a mail credential, or forgets every one of them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/admin/settings/mail/test`                      | `POST` only. Sends the theme's test message through the whole chain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/admin/users`                                   | Who may sign in: a row each, with Edit and Delete. Nothing on it edits anybody.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/admin/users/new`                               | Users > Add new: the add form. `POST` adds one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/admin/users/<id>`                              | One user: the account, the profile, the notices, your password, and the delete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/admin/users/password`                          | `POST` only. Changes the signed-in admin's own password.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/admin/users/email`                             | `POST` only. Sets or clears the email address on the user the form names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/admin/users/profile`                           | `POST` only. Saves the whole public profile of the user the form names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/admin/users/notifications`                     | `POST` only. Turns one notice on or off for the user the form names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/admin/users/notifications/mode`                | `POST` only. Sets how often that notice arrives: as they arrive, hourly or daily.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/admin/users/delete`                            | `POST` only. Deletes the user the form names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/admin/federation`                              | The actors, their followers, the inbox log, and per-post delivery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/admin/federation/settings`                     | Federation > Settings: the relays the site subscribes to.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/admin/federation/resend`                       | `POST` only. Queues a resend of one post and its webmentions, as its file reads then.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin/federation/resend-all`                   | `POST` only. Queues a resend of every announced post, as `geekity resend --all` does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin/setup`                                   | First run: creates the first admin. Closed once a user exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/admin/login`                                   | Username and password.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/admin/logout`                                  | `POST` only. Deletes the session row and sends `Clear-Site-Data`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/admin/_static/*`                               | The admin's own stylesheet and scripts, cached for an hour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The screens behind the login share one layout:

- a bar across the top with the site name and a link to the public site
- the menu down the left
- a place for flash messages

`flash(c, 'notice', '…')` queues a message on the session row. The next page
the browser requests shows it and clears it. A flash message survives exactly
one redirect.

## The admin's look

The admin uses DaisyUI 5 on Tailwind v4 (decision-30). Its stylesheet,
`admin/static/admin.css`, is compiled at build time from `admin/src/admin.css`
and ships in the package, like the default theme's stylesheet. It includes
every built-in DaisyUI theme. The default is `light`, and `dark` applies when
the system prefers dark. A site cannot override the stylesheet or add a theme
of its own.

The admin bar is the same component on the admin and across the top of every
public page a signed-in user views. It is a `<geekity-admin-bar>` element that
holds a declarative shadow root, so neither the site theme nor the admin's
theme reaches inside it. It uses its own light or dark palette, following the
user's admin theme. On a public page it pushes the page down by
`--geekity-admin-bar-height`. It also adds the `geekity-admin-bar` class to
`<html>`, for a theme that needs to make room of its own.

Each user picks their own admin theme on their own screen under Users: any
built-in DaisyUI theme, or Follow the system. The choice is stored as
`adminTheme` on the user in `data/users.json`. Every admin page rendered for
that user carries it as `data-theme` on `<html>`. Follow the system stores
nothing and puts no `data-theme` on the page. The login, setup,
forgot-password and reset screens never carry one.

The stylesheet is a build product, like the default theme's. Its source is all
of Tailwind, Preflight included, plus the DaisyUI 5 plugin. `pnpm build` and
the package's `pretest` compile it to `packages/cms/admin/static/admin.css`,
which is gitignored. `pnpm --filter @geekity/cms build:admin` compiles only the
stylesheet. Tailwind reads class names from the templates under `admin/` and
from `editor/look.ts`.

## The menu

The menu follows WordPress's classic admin menu. It has twelve sections:
Dashboard, Posts, Pages, Navigation, Media, Comments, Messages, Appearance,
Users, Tools, Settings and Federation. Each section is a heading over one or
more children.

- Clicking a heading opens the section and goes to its first child.
- The open section shows its children.
- The current child carries `aria-current="page"`. On Users, the menu shows
  that you are on Users > All users.

Tags and categories are children of Posts, because a tag exists only on posts.
Every section has at least one child, even when it has one screen. The rule
then has no exception, and a second child can appear later without changing
the menu's shape.

The menu has no JavaScript. The server knows which section is open, so opening
a section loads a page.

The whole menu is `ADMIN_SECTIONS` in `src/admin/menu.ts`. To add a site's own
screen to it, make two changes:

```ts
// 1. One entry in the section's children, naming the screen and its URL.
{ child: 'imports', label: 'Imports', url: '/admin/imports' }

// 2. The same pair on whatever that screen renders.
render(c, 'layouts/imports.njk', { section: 'posts', child: 'imports' });
```

Nothing else changes. The heading, the landing URL and the `aria-current`
marking follow from the entry. If a screen names a section or a child that the
registry does not hold, rendering throws `UnknownAdminScreenError`. The mistake
fails a test instead of rendering a menu that marks nothing.

## The admin editor

The editor at `/admin/posts/{slug}` is a plain form. The body is a
`<textarea>`. The Preview button submits the form to `/admin/preview` in a new
tab. Both work with JavaScript switched off, and every change below keeps
that working.

### Kinds of post

"+ New" opens `/admin/posts/new`, which lists the kinds of post: Note, Photo,
Link, RSVP, Event, Check-in, Episode and Review, and a card for a Page. Each
card is a link to `/admin/posts/new?kind=<kind>`. That kind's form shows only
its own fields:

- Note: an optional title (a title makes the note an article) and the body.
- Photo: the photos, each with its alt text, a grid of the newest images in
  the media library to tick, and a box for a photo at a web address. A ticked
  image is added when you save. Add the ticked photos adds them at once, so
  you can write their alt text first.
- Link: Replies to, Likes, Reposts or Bookmarks, and the address of the page.
- RSVP: the event's address and the answer.
- Event: when it starts and ends, and where.
- Check-in: the place and its coordinates.
- Episode: the audio or video file, its transcript and its other versions.
- Review: what is reviewed (a book, movie, TV show, album, place or other),
  that item's own fields, a rating from 1 to 5 stars, and the review. The
  fields and labels change with the item kind without JavaScript. The item's
  picture (a book cover, a poster, album art) belongs to the item. A place
  review can also carry your own photos. Find searches for the item by its
  title, and Look up fills in the item from its ID. See [Find](#find) and
  [Look up](#look-up).

The sidebar holds what every kind shares: Publish (the buttons, Draft, the
date, Visibility and Author), Tags and categories, Location, Address, Summary
and language, Syndicate to, and Display and discussion.

Change type, beside the heading, sends the form back to be laid out as
another kind. Nothing is saved, and every value you typed is kept. It works
with JavaScript switched off.

An existing post opens on the kind its properties give it, by Post Type
Discovery. A Micropub app can send a post that has properties of several
kinds, such as a reply with photos. The editor shows the other kinds' fields
under Also on this post, and a save keeps them all.

Pages > Add new opens the page editor directly.

### Look up

On the review form, Look up sits beside the item's ID. It reads what the ID
box holds, asks a source about the item, and fills in the boxes that are
still empty: the title, the by field (author, director, network or artist),
the year, the address, and for a TV episode link the season and episode. For
a place it fills the name, street address, locality, region, country and
website. A box you have typed in is never changed.

| ID                                           | Source                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| An ISBN, as `isbn:…` or bare                 | The Open Library Books API, and its cover by ISBN when the book names none                                                   |
| An Open Library edition link                 | The Open Library Books API by the edition's ID, and its cover by that ID when the book names none                            |
| A DOI, as `doi:…`, bare, or a `doi.org` link | The Crossref REST API. The request carries your user's email, when you have one, so it goes to Crossref's polite pool        |
| A MusicBrainz release group or release link  | The MusicBrainz web service, and the front image from the Cover Art Archive                                                  |
| A TMDb movie or TV link                      | The TMDb API. Needs a TMDb key                                                                                               |
| An IMDb title link                           | The TMDb API, which finds the title by its IMDb ID, when the site has a TMDb key. Without one, the IMDb page itself          |
| An OpenStreetMap node, way or relation link  | Nominatim's lookup, with the place's address and its website when OpenStreetMap has one                                      |
| Any other link                               | The page's JSON-LD (a Book, Movie, TV series, album, game, product or other creative work), then its OpenGraph and `<title>` |

When the picture box is empty, the item's cover, poster or album art is
downloaded into the media library, not linked from the other site. Its alt
text is filled in as the picture's name for the title, such as
`Poster for Dune: Part Two`, and written to the library too. A picture
already in the box is kept.

Every request goes through the same guards as a cited page's preview: public
hosts only, a 10-second deadline, a size limit, and the site's
`Geekity/1.0` User-Agent with its contact address. MusicBrainz and Nominatim
are each asked no more than once a second from one site.

When nothing is found, the sentence beside the button says why: no such book,
a source that could not be reached, a TMDb link with no key, or a page that
names nothing. The form is otherwise unchanged.

Look up is a submit button. Without JavaScript it posts the form, and the
editor comes back with the boxes filled and nothing saved, as Change type
does. With JavaScript, `admin/static/item-lookup.js` posts the form to
`POST /admin/item-lookup` and fills the boxes in place. Saving never looks
anything up: the ID is saved as typed.

IMDb answers a server's request for one of its pages with a challenge for a
browser, so an IMDb link finds nothing without a TMDb key.

### Find

Above the ID box, for every item kind but Other, a "Find the book" box (movie,
TV show, album or place) searches the item's source by title. It searches
when you press Enter or Search, not as you type: Nominatim's usage policy
forbids autocomplete, and one search per press keeps every source to its
limits. Each match shows a small picture, the title, the by field and year
(or the address, for a place) and the source. The list ends with where to
paste a link when the item is not there.

| Kind      | Source                                                                       | A pick looks up                                            |
| --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Book      | Open Library's `search.json`, with each work's best edition                  | The edition's ISBN, or the edition's link when it has none |
| Movie, TV | TMDb's movie or TV search, and each match's director or network. Needs a key | The TMDb link                                              |
| Album     | MusicBrainz release group search, with art from the Cover Art Archive        | The release group link                                     |
| Place     | Nominatim's search, credited to OpenStreetMap's contributors                 | The OpenStreetMap link                                     |

Picking a match runs Look up on its ID, so it fills the same empty boxes and
copies the picture the same way. The ID box is filled with the match's ID
when it is empty.

The pictures in the list are fetched by the site and sent as `data:` URIs, so
the admin's `img-src` stays `'self' data:` and the sources never see the
admin's address. A search answered in the last hour is answered again from
memory rather than sent twice, as Nominatim asks.

The box needs JavaScript. It is drawn hidden, and
`admin/static/item-lookup.js` shows it and calls
`GET /admin/item-search?kind=…&q=…`. Without JavaScript the box is not shown,
and the ID box and Look up work as before.

#### The TMDb key

Settings > General has a Movies and TV shows panel for the TMDb key. Get one
from your account's API settings on themoviedb.org; the API key and the API
read access token both work. The key is the secret `tmdb.key` setting, kept in
`data/tmdb.json` at mode `0600`, and the page shows only its last four
characters. A deployment can set it with `GEEKITY_TMDB__KEY` instead. TMDb's
terms allow non-commercial use with attribution, which the panel gives.

### What JavaScript adds

`packages/cms/admin/static/editor.js` upgrades the form when it loads:

- CodeMirror 6 in Markdown mode replaces the textarea's _view_. The textarea
  stays in the form and holds the submitted value.
- The Preview button becomes a Write/Preview tab. The tab posts the current
  body and shows the response in a sandboxed frame.
- An "Add file…" button, or a file dropped on the editor, posts to
  `/admin/uploads` and pastes the returned Markdown at the cursor.

`editor.js` is a build product. Its source is `packages/cms/editor/main.ts`,
which has its own `tsconfig.json` with the DOM lib and no node types. esbuild
bundles it in `scripts/build-editor.js`. `pnpm build` runs the bundler after
`tsc`, so an install (through the root `prepare` script), a CI job and a
publish all produce it. `admin/` is already in the package's `files`, so the
bundle ships. The bundle is gitignored, and CodeMirror is a devDependency. The
admin fetches nothing from a CDN and works offline.

`POST /admin/preview` renders through the same `renderMarkdown` and the same
theme layout as the public site. The preview matches what publishing would put
on the site, theme overrides included. Preview writes nothing.

While you are signed in, you can also read an unpublished post at its own
permalink. This covers a draft, a scheduled post, or a post whose visibility
the site does not recognize. A Micropub app such as iA Writer opens this URL
after it posts a draft.

- The theme renders the page as it will be published, under a banner. The
  banner says why the post is not published and that only signed-in users can
  see it.
- The response carries `Cache-Control: private, no-store`,
  `X-Robots-Tag: noindex` and a robots `noindex` meta, with no `ETag` or
  `Last-Modified`. No shared cache keeps it, and no later request revalidates
  against it.
- Only the HTML page is served. Its `.md` and `.json` representations and its
  ActivityStreams object still return 404.
- The post stays off every list, feed, the sitemap and search, for signed-in
  users too.

For a visitor who is not signed in, the permalink returns the same 404, body
and headers as a URL with nothing at it. A post in the trash returns 404 to
everyone.

`POST /admin/uploads` stores one file at
`content/uploads/{yyyy}/{mm}/{slug}{ext}` and returns `{ url, markdown }`. It
never overwrites a name. A second `photo.png` becomes `photo-2.png`.

Three checks must pass before anything is written:

- The extension is on the site's allowlist.
- The media type the browser declared is one that extension may have.
- The file's first bytes match that format.

A file that is too big gets a 413, and a file of the wrong type gets a 415,
both as JSON. See
[`uploadMaxBytes`, `uploadMediaMaxBytes` and `uploadTypes`](configuration.md#uploads-and-images).
A check on `Content-Length` runs before the server reads the body. It accepts
anything under the larger of the two limits. The server then holds the file to
its own kind's limit.

The same rules run behind [the media library](media.md#the-media-library). The
library uses a form, not `fetch`, so a body over the limit posted from a
browser gets the 413 as plain text instead of JSON.

Both endpoints are behind the admin's guard and need the session's CSRF token,
like every other POST in the admin.

The editor's Visibility field chooses Public or Unlisted. An unlisted post or
page:

- is served at its URL with a `noindex`
- federates to the followers with Public in `cc`
- is left off the home page, every archive and feed, the sitemap, search,
  `llms.txt` and IndexNow

A value the site does not recognize, such as a hand-typed
`visibility: private`, hides the post like a draft until you choose one.
[Unlisted posts](content.md#unlisted-posts) has the whole table.

## Users

`/admin/users` lists who may sign in. There is one role. Doc-5 puts any role
beyond admin out of scope for phase one.

The first admin comes from `/admin/setup` or from
[`geekity user add`](cli.md#creating-an-admin-from-the-command-line). Every
later admin comes from `/admin/users`. You can add a user with a password you
supply, or with one the server generates and shows once.

The list only lists. Each row has:

- the username, with the archive URL under it
- the email address
- when the account was created
- Edit and Delete

Every field is on the user's own screen at `/admin/users/<id>`, with a label
beside each box. The screen covers:

- the account and its email address
- the public profile
- which notices the user gets by email
- your own password, on your own page only
- Delete, or a sentence that says why this account cannot be deleted

Each Save returns to the same screen, which shows the result.

**`data/users.json` is the source.** It has one entry per user with an id, a
username, an argon2 hash and a created time. A user may also have an email
address, notification preferences, a public profile and the
[stored actor id](federation.md#a-users-stored-actor-id) they were published
under elsewhere.

The server writes the file the same way as every file this CMS owns:

- It writes a temporary file beside it and renames it over the old one.
- The read and the write are one step that no other writer of that file can
  interrupt. If two admins add the same name at once, only one succeeds.
- The file has `0600` permissions, so only the account the site runs as can
  read it.

The file is in `data/`, not `content/`, because `content/` is published and in
git. Back it up. `data/geekity.db` can be deleted at any time and rebuilt, but
nothing can rebuild `data/users.json`.

Sessions stay in SQLite with the rest of the cache, so they are cheap to throw
away. A session names a user by id. The server checks it against
`data/users.json` on every admin request, so a session whose user no longer
exists is not a login. Deleting `data/geekity.db` signs everyone out and loses
nothing else. Restoring an old database cannot bring back a deleted account or
a changed password.

Passwords are hashed with argon2id through `node:crypto`, so there is no native
module to build. Each hash stores its cost parameters. If the parameters are
raised later, every stored password still verifies.

A session id is 256 random bits in a `HttpOnly; SameSite=Lax; Path=/` cookie.
When `baseUrl` is an `https` URL, the cookie is `Secure` and named
`__Host-geekity_session`. Over plain http it is `geekity_session`, as
[Session hardening](security.md#session-hardening) explains. A session lasts
`sessionLifetime`. The server deletes an expired session, not only ignores it.

Every mutating admin form carries a per-session CSRF token. The server refuses
a `POST` without a valid token with 403. This includes the login and setup
forms. They get the token from a short anonymous session that the server
creates when it first renders the form. Logging in discards that session and
starts a new one, so a planted session id cannot become a logged-in one.

Adding a user enforces the same rules as `/admin/setup` and
`geekity user add`:

- a username of 1 to 64 letters, digits, dots, dashes or underscores
- a password of at least 8 characters

If you tick **Generate one instead**, the server makes the password with
`randomInt` over an alphabet with no `0`/`O` or `1`/`l`. It shows the password
once, in the flash on the next page. The flash lives on the session row, so a
generated password never appears in a URL, a cookie or a browser's history. It
is never stored in the clear. If you leave that page without copying the
password, the only fix is to delete the user and add them again.

Changing your own password asks for the current one first. It then ends **every
other session that login has** and keeps the one you are using. People usually
change a password because someone else may have it. If the other browsers
stayed signed in, the change would fix nothing. The flash says how many
sessions were signed out.

The admin does not let you change another user's password. To give a colleague
a login, create a fresh account for them. This keeps the current-password check
meaningful.

Deleting a user deletes their sessions. The server refuses any session that
survives the deletion, for example in a database restored from a backup,
because `data/users.json` no longer holds the user it names.

The server refuses two deletions, and the table shows a Delete button only on
rows where neither applies:

- **The last remaining user.** A site with no users falls back into first-run
  setup, and the next person to reach `/admin` becomes its admin.
- **Your own account.** Deleting it would end the session doing the deleting,
  and there is no undo. Another admin can delete it for you.

**A profile's links** go one per line, either `Label | URL` or a bare URL that
is its own label. The URL is a path or an absolute `http(s)` URL with no
spaces, the same rule as a menu item's URL. The line format is the same in both
boxes, including the optional `rel` values at the end.
`Mastodon | https://example.social/@me | me` means the same here as on the
Navigation screen.

Every profile link is published with `rel="me"`, whether or not the line says
`me`. Mastodon uses `rel="me"` to verify a profile field that points back at
this site, and IndieAuth uses it to confirm the link is yours. Nothing else in
Geekity reads it. Typing `| me` therefore adds nothing, and
`| me nofollow author` puts all three values on the rendered `rel`.

A link stored before the box was validated still renders and still appears in
the box. When the panel is saved, the server refuses a line that is not a
link and names the line to fix.

A form with a problem returns a 400, with one message under each field, and
nothing is written. The add form keeps the submitted username. The password
forms keep nothing, because a password does not belong in rendered HTML.

**An email address is optional.** You can set it on the add form, or inline on
any row, including another user's. With one role, every user already has every
permission, and an admin who has just added a colleague can enter their
address without waiting for them. Clearing the box removes the address. The
address never appears on the public site.
`geekity user add ada --email ada@example.com` sets one from a shell.

An email address lets the user **get back in without a shell**, through
[password recovery](security.md#forgotten-passwords). It also receives the
notices that [a comment sends](comments.md#being-told-about-one). Beside the
address are the switches for those notices, one per event, on by default.
`data/users.json` stores a switch only when a user turns it off.

An older version kept accounts in a `users` table in the database. On the first
boot of this version, the server writes those rows into `data/users.json` with
their ids and hashes unchanged, so nobody has to log in again, and drops the
table. If `data/users.json` already exists, the server keeps it and ignores the
table.

To create a user from your own code, as the CLI does:

```ts
import { createUser } from '@geekity/cms';

await createUser({
  dataDir: 'data',
  username: 'ada',
  password: process.env.PASSWORD ?? '',
});
```

## Navigation

The site stores each menu under a name, and the theme requests menus by name.

**The site stores menus by name.** `content/_data/site.json` holds a `menus`
object keyed by the name of each menu. Each menu is an ordered list of items:

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

An item has a label, a URL and its `rel` values.

- The URL is a site-root path or an absolute `http(s)` URL. Anything else is
  refused.
- `rel` is one string that holds every value, such as `"me"` or
  `"nofollow noopener"`. It is present only when the item has a value. Values
  are lower case and each appears once. A theme prints the string as the whole
  of the link's `rel` attribute.

The values can be any HTML link types the site wants. Most menus use `me`.
Mastodon and the rest of the IndieWeb use it to verify that the site and the
profile it links belong to the same person. An item written `"me": true`, the
format from before `rel` held a list, is still read as `"rel": "me"`.

**The theme declares the areas it renders.** `theme.json` has an `areas` list.
Each entry has a `name`, which is the key under `menus`, and a `label` for
people to read:

```json
{ "areas": [{ "name": "primary", "label": "Site menu" }] }
```

The packaged theme declares `primary` ("Site menu") and `footer` ("Footer
links"). A theme that wants a third area declares it. If `areas` is missing or
unreadable, the theme declares no areas and still loads. The Navigation screen
then offers the packaged theme's areas. A site theme is laid over the packaged
one a file at a time. A theme that declares nothing has not overridden the
declaration, and its inherited `layouts/base.njk` still renders
`menus.primary` and `menus.footer`.

**A theme renders a menu by name.** Every template gets `menus`, keyed by the
same names. Each item is already marked `current` for the path being rendered.
A theme needs only `{% for item in menus.footer %}`, so a site theme can render
a menu that the packaged theme does not know about.

Every stored menu is on the context, not only the declared ones. The Navigation
screen reads the declaration. A menu that no template loops over is rendered
nowhere and kept. A site owner can therefore write the menu a theme will use
before switching to that theme.

**The menus are managed on `/admin/navigation`.** It is a top-level section
after Pages, not a settings page. A menu is content the site arranges, like its
pages, and the active theme decides the screen's shape. The screen shows two
lists:

1. The areas the active theme declares, in the theme's order and under its
   labels. An area the site has never filled in shows as an empty box.
2. Every other stored menu, under a heading that says this theme renders them
   nowhere. These menus are still editable, so you can write the menu a theme
   will use before switching to it. Each has a Delete button, which is the only
   way to remove a menu.

An area the theme declares can be emptied but not deleted. The theme still
requests that name, and the box stays for the next items.

Each menu is one box of `Label | URL` lines. The menu renders them in the order
typed and marks the item whose path matches the current page with
`aria-current`. A line may end in the link's `rel` values, one word each, as in
`Mastodon | https://example.social/@me | me` or
`A source | https://example.com/thing | nofollow noopener`.

The parser takes the values off the end of the line only when the last
bar-separated part reads as a list of `rel` values. A URL that contains a bar
keeps it. `Odd | /odd/?a=1|2` keeps its query string, because `2` is not a
word. The server refuses a line that is not an item and names it. The box
still holds every line that was submitted, and nothing is written. The Links
box on a profile takes the same line format.

**A menu name** is lower-case ASCII letters, digits and underscores, starting
with a letter, at most 32 characters. A theme writes the name after the dot,
as in `{% for item in menus.footer %}`. A dash is refused because after a dot
it is a minus sign: `menus.top-bar` renders nothing and raises no error.

The lower-case rule refuses confusable spellings. `Footer` is refused, not
converted to lower case, because `footer` and `Footer` would be two menus on
one screen that nobody could tell apart. A name the site already holds is
refused too, and the message says its box is already on the page.

The rule applies to a name someone types. A name that a `theme.json` declares
is a menu name by declaration, and the screen shows it as the theme spells it.
If the screen hid a declared area over its spelling, a site owner could not
fill in a menu their site renders.

There is no second source. A page cannot add itself to a menu. Each menu has
one screen to edit it on and one order, and the same link cannot appear twice.
To link a page, type a line for it. This includes the page a site serves as its
front page. Type it as `Home | /`, the URL a visitor lands on, not the
permalink that redirects there.

The menus live in `site.json`, so an Eleventy build renders the same ones. The
example config assembles them as `collections.menus`. See
[Navigation](theme/navigation.md) for how the default theme prints them. If a
hand-edited `site.json` has a `menus` value that is not an object of lists of
items, the site renders no menu and raises no error. A bad archive base falls
back the same way instead of taking the site down.

## Tags and categories

`/admin/tags` and `/admin/categories` list every term in use, each with two
counts and a link to its archive:

- **Posts**: what the public site lists under the term.
- **Files**: every file that carries the term, including drafts, scheduled
  posts and the trash.

Check **Files** before acting. It counts the files an action will rewrite.

You can rename, merge or delete a term. All three use the same operation.

- **Rename.** Type a new name into a row's field and press Rename. The server
  rewrites the front matter of every file that carries the term.
- **Merge.** Rename onto a term that already exists. The screen returns a
  question that names both counts, and only a confirmed form goes through. A
  merge cannot be undone by renaming back. A file that carried both terms keeps
  the target once, in the place it already had.
- **Delete.** The server removes the term from every file and changes nothing
  else.

Each action reports how many files it wrote. The files are the source of truth
(decision-1). The server re-reads and re-parses each file from disk before it
rewrites it, and does not use the index. The index can lag a moment behind a
hand edit, and a bulk rewrite based on it would undo that edit. The server
skips, counts and names in the message any file that is missing or does not
parse.

The server announces every rewrite the same way as an editor save. The index,
the feeds, the notify server and the fediverse all update. Each affected
published post gets one `Update`, because its hashtags changed. A term on many
published posts therefore causes many deliveries. Keep this in mind before you
rename a tag that half the archive carries.

A rename moves an archive, and someone may have linked to the old archive URL.
The server records the move in a `taxonomyRedirects` list of
`{ taxonomy, from, to }` entries in `content/_data/site.json`, with the rest of
the settings. The old archive URL and its feed then return `301` to the new
ones.

- The server collapses chains when it records them. `a → b` followed by
  `b → c` is stored as `a → c` and answered in one hop.
- A term that comes back into use is served, not redirected.
- Deleting a term drops every record that points at it, because a redirect to a
  404 is worse than the 404.

## Tools > Export

Tools > Export writes the same archive as
[`geekity export`](cli.md#exporting-a-site) and offers it as a download. The
archive always holds `content/`. An archive of a site with many uploads can
take minutes to write, so the export runs as the `site.export` job in the
background, and the request that starts it returns at once.

Before you start an export, the screen shows how many deliveries are waiting
in `data/queue.sqlite`. The archive never holds them. Before you move a site,
wait until the number is 0. The number is read when the page loads, so load
the page again to see it change.

To start an export:

1. Select **Include credentials** to put the credential files in the archive:
   `mail.json`, `akismet.json`, `tmdb.json` and each plugin's `secrets.json`. Without it,
   they are left out, and you type them in again after an import.
2. Type your password. Every archive holds the actor keys, the password hashes
   and personal data, so the screen asks for the password again. A wrong or
   missing password queues nothing.
3. Select **Export**.

While the job waits or runs, the screen shows its state, the number of files
written out of the total, and the bytes written out of the total. The status
updates every few seconds without a page load until the job ends, and the
result then replaces it. Without JavaScript, select **Check again**. While an
export is queued or running, the screen does not offer a second one.

When the job finishes, the screen shows the number of files, the size, whether
credentials are included, which credentials were left out, any file under
`data/` that was left out because no declaration covers it, and any entry
under `content/` that was left out because it is not a regular file, such as
a symbolic link. **Download** sends
the archive with `Content-Disposition: attachment`. The download URL,
`/admin/tools/export/download`, is behind the admin sign-in like every other
admin URL.

The job writes the archive to `data/exports/`, whose class is `scratch`, so an
export never holds an earlier export. The folder keeps one archive:

- When an export finishes, the job deletes every other file in the folder.
- An archive is deleted 24 hours after it was written. The time is the one in
  its name. From that moment the screen and the download no longer offer it.
  The retention sweep, which runs every 6 hours, deletes the file if nobody
  opens the screen.

If the server stops during an export, the job runs again when the server
starts, and it writes a new archive. It deletes the temporary files that the
cut-off run left in `data/exports/`.
