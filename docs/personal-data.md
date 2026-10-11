# Personal data

This is every piece of personal data the CMS stores, where it is, and how long
it stays. "Kept" means until somebody deletes it, unless a retention period
says otherwise.

| What                                                                                                                   | Where                                                         | How long                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A commenter's name, website and words                                                                                  | `content/_data/comments/{slug}.json`, public and in git       | Kept. Erasing on request replaces the name and drops the website.                                                    |
| A commenter's email, and whether they asked to be told about replies                                                   | `data/comments/{slug}.json`, mode `0600`, keyed by comment id | `commentEmailRetentionDays`: forever unless set, 180 on a new site.                                                  |
| A salted hash of the address a comment, webmention or contact message came from (the address itself is never stored)   | The comment file, or the contact message file                 | `addressHashRetentionDays`: forever unless set, 30 on a new site.                                                    |
| A webmention's author name, website, avatar URL and the source page's words                                            | `content/_data/comments/{slug}.json`                          | Kept, as a copy of a page that is public already.                                                                    |
| A contact message: the sender's name, email, subject and message                                                       | `data/contact/{id}.json`, mode `0600`                         | `contactMessageRetentionDays`: forever unless set, 365 on a new site.                                                |
| The addresses that unsubscribed from reply notices                                                                     | `data/comment-optouts.json`, mode `0600`                      | Kept, so the site goes on not writing to them. Erasing on request removes one.                                       |
| Followers: actor id, handle, display name, avatar URL, profile URL                                                     | `content/_data/federation/{username}/followers.json`, in git  | Until they unfollow.                                                                                                 |
| Inbound likes, boosts, replies and quotes, with the actor who sent them                                                | `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`, in git    | Kept.                                                                                                                |
| What a reply shows of the post it answers: its title, words and author                                                 | `content/_data/replyContexts.json`, in git                    | Kept.                                                                                                                |
| Other actors who liked, boosted, answered or quoted: handle, display name, avatar URL, profile URL                     | `data/geekity.db`, fetched from their actor document          | A cache. Refetched weekly while the inbox log names them.                                                            |
| Remote avatars, shrunk                                                                                                 | `data/avatars/`                                               | Deleted by the avatar sweep once nothing shown names them.                                                           |
| Users: username, email, argon2id password hash, profile                                                                | `data/users.json`, mode `0600`                                | Until the user is deleted.                                                                                           |
| The apps a user signed in to with IndieAuth: app, scopes, hashes of its tokens, when they expire                       | `data/indieauth-tokens.json`, mode `0600`                     | Until the user is deleted, or 60 days after the app last refreshed.                                                  |
| Recent IndieAuth and Micropub requests: app, username, what it sent (no secrets, values cut short), the answer         | `data/indieauth-activity.json`, mode `0600`                   | The last 100 requests, none older than 14 days.                                                                      |
| Plugins added, updated and removed on Admin > Plugins: the username, when, the package and its versions                | `data/plugin-changes.json`, mode `0600`                       | The last 200 changes.                                                                                                |
| An index of all of the above, and sessions, reset tokens and spent link tokens                                         | `data/geekity.db`                                             | A cache of the files. Sessions and tokens are pruned when they expire.                                               |
| Client addresses in the rate limits                                                                                    | Memory                                                        | Until the window passes or the site restarts.                                                                        |
| Where and when a photo or video was taken, and the camera or phone (EXIF, XMP, IPTC, a video's `©xyz`)                 | Removed from `content/uploads/` on upload                     | Never stored. Older uploads keep it until `geekity strip-metadata`; git history keeps the old bytes until rewritten. |
| Where the author wrote a post or checked in: coordinates, accuracy, and the place's name, locality, region and country | `data/locations.json`, mode `0600`, keyed by permalink        | Kept until the author clears it. Published only as far as **Settings > Privacy** allows, nothing by default.         |
| Micropub properties a post was sent that the site does not understand, such as an RSVP                                 | `data/kept-properties.json`, mode `0600`, keyed by permalink  | Kept until an update deletes them. Never published.                                                                  |
| Client addresses in the access log                                                                                     | stdout, and whatever collects it                              | Only with `accessLogAddress` on. The collector keeps them.                                                           |

Two services outside the site see personal data when a site turns them on.
Akismet is sent a commenter's or sender's address, user agent, referrer, name,
email, website and words. The mail provider is sent every address a message
goes to.

## The starter privacy page

`geekity init` writes `content/pages/privacy.md`, served at `/privacy/` and
linked from the footer by a `Privacy | /privacy/` line in `menus.footer`. It
says in plain language what the table above says, marks the contact form,
reply emails and Akismet as optional, and quotes the retention periods a new
site starts with. It is a starting point written from what the software does,
not legal advice, and a note at its top says so to the owner: review it, add
whatever the site does beyond the CMS (analytics, a host's logs, a theme that
loads fonts from elsewhere), change the numbers when a retention period
changes, and remove the menu line if the page is deleted.

The link is a menu line rather than something the theme prints, because the
footer prints `menus.footer` and nothing of its own (TASK-105). A site that
upgrades gets no page and no link; it can copy the file from
`templates/site/content/pages/privacy.md` in the package.

## Retention

Three settings in `content/_data/site.json`, on **Settings > Discussion**,
decide how long the site keeps what readers hand it. Each counts whole days from
when the data arrived, and `0` keeps it forever:

| Setting                       | Recommended | What goes when it runs out                                        |
| ----------------------------- | ----------- | ----------------------------------------------------------------- |
| `commentEmailRetentionDays`   | `180`       | The email on a comment, and with it the reply subscription.       |
| `addressHashRetentionDays`    | `30`        | The address hash on a comment, a webmention or a contact message. |
| `contactMessageRetentionDays` | `365`       | The whole contact message.                                        |

**A site keeps everything until its owner sets a period.** A `site.json`
without these keys reads as `0` for all three, so an existing site that
upgrades loses nothing, and the Discussion screen says "Kept forever" beside
each one. A new site from `geekity init` starts with the recommended periods
written into its `site.json`. An existing site opts in by typing them on
Settings > Discussion and saving once.

They are settings rather than config because how long a site keeps people's
data is the owner's decision, and a privacy notice quotes it; `site.json` is
public, which suits a policy. The recommended periods are long enough for a
reply notice to arrive, a run of spam to be spotted and a year of
correspondence to be answered, and no longer. The first sweep after a site
sets a period removes whatever is already past it.

A sweep runs when the site starts serving and every six hours after that, and
`cms.retention.sweep()` runs one now. It reads the files rather than the index,
rewrites each comment file and message inside the same lock every other writer
takes, and puts each changed comment back into the index in the same step. A
second sweep finds nothing left to remove and writes nothing.

A comment that loses its email keeps its id, its place in the thread, its
status, its words and its name. It gains `"redacted": ["email"]`, which is how
the index tells an email removed from one never given: a name whose email was
removed does not count toward auto-approval, so nobody can type that name and
skip the queue. Its author is no longer told about replies, and their next
comment waits for a moderator. A moderation link in an inbox names the comment
by id, so it goes on working.

The sweep changes the files as they are now. The emails are in `data/`, which
is not in git, so removing one removes it. Emails from before they moved out of
the comment files (TASK-182) were committed with those files, and they stay in
the repository's history until that history is rewritten, whatever the sweep or
an erasure does to the files today.

## Erasing one person's data

**Tools > Personal data** erases what the site holds for one email address.
It shows what it found first: how many comments carry the address, how many
contact messages came from it, and whether it is on the opt-out list. Erasing
then signs each of those comments `Anonymous`, removes its email, website,
avatar and address hash, and marks it `"redacted": ["email", "addressHash",
"author"]`; the comment keeps its place in the thread, its status and its words.
The contact messages are deleted and the address comes off the opt-out list.

A comment is found by its email, so one whose email the sweep has already
removed, a webmention and a fediverse reply are not found there. The Comments
screen deletes those one at a time.
