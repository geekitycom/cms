# Personal data

This page lists every piece of personal data the CMS stores, where it is
stored, and how long the CMS keeps it. In the How long column, "Kept" means
until a user deletes it, unless a retention period sets a limit.

The Class column gives the file's declared class (decision-55), which decides
whether a [site export](#site-exports) holds it. Everything under `content/` is
`kept`. [Two directories](content.md#two-directories-content-and-data) defines
the classes.

| What                                                                                                                   | Where                                                         | Class       | How long                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A commenter's name, website and words                                                                                  | `content/_data/comments/{slug}.json`, public and in git       | kept        | Kept. Erasing on request replaces the name and drops the website.                                                                                        |
| A commenter's email, and whether they asked to be told about replies                                                   | `data/comments/{slug}.json`, mode `0600`, keyed by comment id | kept        | `commentEmailRetentionDays`: forever unless set, 180 on a new site.                                                                                      |
| A salted hash of the address a comment, webmention or contact message came from (the address itself is never stored)   | The comment file, or the contact message file                 | kept        | `addressHashRetentionDays`: forever unless set, 30 on a new site.                                                                                        |
| A webmention's author name, website, avatar URL and the source page's words                                            | `content/_data/comments/{slug}.json`                          | kept        | Kept. It is a copy of a page that is already public.                                                                                                     |
| A contact message: the sender's name, email, subject and message                                                       | `data/contact/{id}.json`, mode `0600`                         | kept        | `contactMessageRetentionDays`: forever unless set, 365 on a new site.                                                                                    |
| The addresses that unsubscribed from reply notices                                                                     | `data/comment-optouts.json`, mode `0600`                      | kept        | Kept, so the site continues not to write to them. Erasing on request removes one.                                                                        |
| Followers: actor id, handle, display name, avatar URL, profile URL                                                     | `content/_data/federation/{username}/followers.json`, in git  | kept        | Until they unfollow.                                                                                                                                     |
| Inbound likes, boosts, replies and quotes, with the actor who sent them                                                | `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`, in git    | kept        | Kept.                                                                                                                                                    |
| What a reply shows of the post it answers: its title, words and author                                                 | `content/_data/replyContexts.json`, in git                    | kept        | Kept.                                                                                                                                                    |
| Other actors who liked, boosted, answered or quoted: handle, display name, avatar URL, profile URL                     | `data/geekity.db`, fetched from their actor document          | rebuildable | A cache. Refetched weekly while the inbox log names them.                                                                                                |
| Remote avatars, shrunk                                                                                                 | `data/avatars/`                                               | rebuildable | Deleted by the avatar sweep once nothing shown names them.                                                                                               |
| Users: username, email, argon2id password hash, profile                                                                | `data/users.json`, mode `0600`                                | kept        | Until the user is deleted.                                                                                                                               |
| The apps a user signed in to with IndieAuth: app, scopes, hashes of its tokens, when they expire                       | `data/indieauth-tokens.json`, mode `0600`                     | kept        | Until the user is deleted, or 60 days after the app last refreshed.                                                                                      |
| Recent IndieAuth and Micropub requests: app, username, what it sent (no secrets, values cut short), the answer         | `data/indieauth-activity.json`, mode `0600`                   | rebuildable | The last 100 requests, none older than 14 days.                                                                                                          |
| Plugins added, updated and removed on Admin > Plugins: the username, when, the package and its versions                | `data/plugin-changes.json`, mode `0600`                       | kept        | The last 200 changes.                                                                                                                                    |
| A user's editor forms not saved yet: everything typed into the post or page editor                                     | `data/autosave/{user id}/`, mode `0600`                       | pending     | Until the user saves, trashes or discards the document, the user is deleted, or 30 days pass.                                                            |
| Deliveries, inbox activities and retries waiting to be handled, with the actors and inboxes they name                  | `data/queue.sqlite`, mode `0600`                              | pending     | Until a server handles it. Fedify waits at most 12 hours between two attempts.                                                                           |
| An index of all of the above, and sessions, reset tokens and spent link tokens                                         | `data/geekity.db`                                             | rebuildable | A cache of the files. Sessions and tokens are pruned when they expire.                                                                                   |
| A site export written on Tools > Export: everything above that the site keeps                                          | `data/exports/`                                               | scratch     | Deleted 24 hours after it was written, or when the next export finishes.                                                                                 |
| Client addresses in the rate limits                                                                                    | Memory                                                        | not a file  | Until the window passes or the site restarts.                                                                                                            |
| Where and when a photo or video was taken, and the camera or phone (EXIF, XMP, IPTC, a video's `©xyz`)                 | Removed from `content/uploads/` on upload                     | not stored  | Never stored. Older uploads keep it until the sweep on Tools > Maintenance or `geekity strip-metadata`; git history keeps the old bytes until rewritten. |
| Where the author wrote a post or checked in: coordinates, accuracy, and the place's name, locality, region and country | `data/locations.json`, mode `0600`, keyed by permalink        | kept        | Kept until the author clears it. Published only as far as **Settings > Privacy** allows, nothing by default.                                             |
| Micropub properties a post was sent that the site does not understand, such as an RSVP                                 | `data/kept-properties.json`, mode `0600`, keyed by permalink  | kept        | Kept until an update deletes them. Never published.                                                                                                      |
| Client addresses in the access log                                                                                     | stdout, and whatever collects it                              | not a file  | Only with `accessLogAddress` on. The collector keeps them.                                                                                               |

Two outside services see personal data when the site owner turns them on:

- Akismet receives a commenter's or sender's address, user agent, referrer,
  name, email, website and words.
- The mail provider receives every address a message goes to.

## Site exports

A site export holds personal data, whatever options it was made with.
[`geekity export`](cli.md#exporting-a-site) and
[Tools > Export](admin.md#tools--export) put every `kept` file in the archive.
From the table above, that is the users and their password hashes,
commenters' emails, contact messages, the opt-out list, IndieAuth token hashes,
locations, kept Micropub properties, and all of `content/` with its comments,
followers and inbox log. The archive also holds the actor keys. Credentials
are in it only when the person exporting asks for them. Files of the classes
`rebuildable`, `pending` and `scratch` are never in it, so the IndieAuth
request log, the cached actor profiles and the waiting deliveries are left
out.

Store an archive as carefully as `data/`. The site deletes its own copy in
`data/exports/` 24 hours after it was written, but it cannot reach a copy that
someone downloaded or wrote with `geekity export`. Retention periods and
**Tools > Personal data** change only the site's current files. An email that
the sweep or an erasure removed after an export is still in that archive. A
site imported from the archive has the data again: the next retention sweep
removes what is past its period, but an erasure has to be done again. Delete
old archives once they are no longer needed.

## The starter privacy page

`geekity init` writes `content/pages/privacy.md`. The site serves it at
`/privacy/`, and a `Privacy | /privacy/` line in `menus.footer` links it from
the footer. The page:

- Says in plain language what the table above says.
- Marks the contact form, reply emails and Akismet as optional.
- Quotes the retention periods a new site starts with.

The page is a starting point based on what the software does. It is not legal
advice. A note at its top tells the site owner to:

- Review it.
- Add what the site does beyond the CMS, such as analytics, a host's logs, or
  a theme that loads fonts from another host.
- Change the numbers when a retention period changes.
- Remove the menu line if the page is deleted.

The link is a menu line, not something the theme prints, because the footer
prints only `menus.footer` (TASK-105). An upgraded site gets no page and no
link. To add them, copy the file from
`templates/site/content/pages/privacy.md` in the package.

## Retention

Three settings in `content/_data/site.json`, on **Settings > Discussion**, set
how long the site keeps what visitors send it. Each counts whole days from when
the data arrived. `0` keeps the data forever:

| Setting                       | Recommended | What goes when it runs out                                        |
| ----------------------------- | ----------- | ----------------------------------------------------------------- |
| `commentEmailRetentionDays`   | `180`       | The email on a comment, and with it the reply subscription.       |
| `addressHashRetentionDays`    | `30`        | The address hash on a comment, a webmention or a contact message. |
| `contactMessageRetentionDays` | `365`       | The whole contact message.                                        |

**A site keeps everything until its owner sets a period.** A `site.json`
without these keys reads as `0` for all three. An existing site that upgrades
loses nothing, and the Discussion screen shows "Kept forever" beside each
setting. A new site from `geekity init` starts with the recommended periods in
its `site.json`. To opt in on an existing site, enter the periods on
Settings > Discussion and save.

**Why these are settings, not config.** How long a site keeps people's data is
the site owner's decision, and a privacy notice quotes it. `site.json` is
public, which suits a policy.

The recommended periods are long enough for a reply notice to arrive, for the
site owner to spot a run of spam, and for a year of correspondence to be
answered. They are no longer than that. The first sweep after the site owner
sets a period removes all data already past it.

A sweep runs when the site starts serving and every six hours after that.
`cms.retention.sweep()` runs one immediately. The sweep:

- Reads the files, not the index.
- Rewrites each comment file and message inside the lock that every other
  writer takes.
- Puts each changed comment back into the index in the same step.

The sweep also deletes a site export in `data/exports/` that is 24 hours old.

A second sweep finds nothing to remove and writes nothing.

A comment that loses its email keeps its id, its place in the thread, its
status, its words and its name. It gains `"redacted": ["email"]`. The index
uses this marker to tell a removed email from one that was never given. A name
whose email was removed does not count toward auto-approval, so a visitor
cannot enter that name to skip the queue. The comment's author no longer
receives reply notices, and their next comment waits for a moderator. A
moderation link in an inbox names the comment by id, so the link still works.

The sweep changes only the current files. The emails are in `data/`, which is
not in git, so removing an email deletes it. Emails from before they moved out
of the comment files (TASK-182) were committed with those files. They stay in
the repository's history until that history is rewritten. Neither the sweep
nor an erasure removes them from the history.

## Erasing one person's data

**Tools > Personal data** erases what the site holds for one email address.
First it shows what it found:

- How many comments carry the address.
- How many contact messages came from it.
- Whether it is on the opt-out list.

When you erase, the screen does the following:

- Signs each of those comments `Anonymous`, removes its email, website, avatar
  and address hash, and marks it
  `"redacted": ["email", "addressHash", "author"]`. The comment keeps its place
  in the thread, its status and its words.
- Deletes the contact messages.
- Removes the address from the opt-out list.

The screen finds comments by email. It does not find a comment whose email the
sweep has already removed, a webmention or a fediverse reply. Delete those one
at a time on the Comments screen.
