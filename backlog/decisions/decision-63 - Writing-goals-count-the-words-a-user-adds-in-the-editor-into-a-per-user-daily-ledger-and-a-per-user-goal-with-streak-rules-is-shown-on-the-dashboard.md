---
id: decision-63
title: >-
  Writing goals count the words a user adds in the editor into a per-user daily
  ledger, and a per-user goal with streak rules is shown on the dashboard
date: '2026-10-23 14:10'
status: accepted
---
## Context

The dashboard has a posting activity card that counts published posts per day (`admin/widget-posting.ts`). Nothing measures how much a person writes. The focus mode bar shows a word count, but only while focus mode is on (`admin/focus-mode.ts` `wordCount`, `editor/focus.ts`). Nothing records edit history: the only traces of work are the autosave copy under `data/autosave` (decision-62) and the `updated` time on the file.

On 2026-10-23 the user asked for writing goals: a goal such as "250 words daily" or "100,000 words monthly" set in settings, progress toward it on the dashboard, a streak of days the writer kept going, rules such as "missing one day is fine, missing two breaks the streak", and a word counter in the editor and in distraction-free mode. The user chose:

- words count when they are written in the editor, not when a post is published;
- each user has their own goal, and words are credited to the user who wrote them;
- only additions count toward a day. Deleting words never subtracts. The editor still shows the post's true current word count, so a writer aiming at a 250-word essay can see where it stands, next to the words they wrote today.

## Decision

**One way to count words.** A shared pure module counts the words in a Markdown body and the words one body adds to another. The server and the editor bundle both use it, so the editor's figure matches the dashboard's.

- A word is a run of characters that contains a letter or a digit, as `wordCount` counts today. Before counting, link and image targets, HTML tags and Markdown markers (`#`, `*`, `>`, list bullets, fences) are removed, so `[my post](https://example.com/a/long/path)` is two words. Text inside code still counts.
- Only the body counts. The title, summary and other fields do not.
- **Added words** between an earlier and a later body are the words the later body inserts, found with a word-level diff (common prefix and suffix trimmed first, so a long post with a small edit stays cheap). Replacing one word with another adds one. Deleting adds none. Moving a paragraph adds its words, which is accepted.

**Words are credited when the server sees new text from a user.** Each credit adds the added words to that user's total for the current day in the site timezone (`site.timezone`, `calendarDayIn`).

- **Autosave** (`POST /admin/autosave`): added words between the user's previous autosave copy of that document (or, with no copy, the saved file, or nothing for a new document) and the submitted body.
- **Save, publish or update** in the editor: added words between the user's autosave copy (or the file on disk) and the saved body. The copy is then cleared as decision-62 says.
- **Micropub** create and update made with a user's token: a create credits the whole body; an update credits the words it adds to the file.
- Imports (WordPress and others), the CLI and MCP do not credit anyone. They move text; they are not writing.

No extra baseline store is needed: the autosave copy already holds the last text the server credited, and the file on disk holds it after a save. Discarding a copy does not take back words already credited. Text kept only in the browser while the server is unreachable is credited by the first autosave that reaches the server, on that day.

**The ledger** is `data/writing/<userId>.json`: `{ "days": { "2026-10-23": 312, … } }`, written atomically. Its class under decision-55 is kept and private: it is the user's history and cannot be rebuilt. Days with no words are not stored. Deleting a user deletes their ledger.

**Goals and streaks belong to the user** and live on their record in `data/users.json`, next to `dashboardLayout`, edited on the user's own profile page:

- `writingGoal`: `{ words, period }`, with `period` one of `day`, `week`, `month` or `year`. Weeks start on Monday. No goal means no goal card and no streak.
- `streak`: `{ dailyWords, missesAllowed }`. A day keeps the streak when the user wrote at least `dailyWords` that day. The form defaults `dailyWords` to the goal for a daily goal, and otherwise to the goal's daily pace rounded up (100,000 a month is 3,334). `missesAllowed` (0 to 7) is how many missed days in a row the streak survives: with 1, missing a day is fine and missing two in a row ends it.
- The streak is the number of days that met the rule in the current run; allowed misses do not add to it. Today does not break a streak until it is over. The best streak is the longest run in the ledger.
- Progress and streaks are computed from the ledger each time, by pure functions. Changing the rules re-reads all history under the new rules.

**The dashboard** gains a core Writing goal card for the signed-in user. It shows words this period against the goal, whether the user is ahead of or behind the even pace for today, words today, the current and best streak, and a calendar of words per day. With no goal set it offers a link to set one. Its cache key includes the user, because the widget board keys cached results by owner, widget and period only.

**The editor** always shows the body's current word count, in the normal view and in the focus mode bar, with the words written today next to it ("1,240 words · 312 today"). The page carries the user's total for today, each autosave response returns the new total, and the bundle adds the words typed since the last autosave using the shared module. Without JavaScript the page shows the counts as of the moment it loaded.

## Consequences

- Writing goals have no history before the release that ships them. Words written before then do not count.
- Only-additions counting can be gamed by rewriting the same paragraph. The user accepted this: the goal is a personal tool, not a contest.
- The day boundary is the site timezone, not the writer's. Writing at 00:30 in another zone lands on the site's day.
- The ledger is a new kept file a site export must carry, and a new file under `data/` that needs a declared class.
- A goal card is per user, so two users see different cards on the same dashboard.

