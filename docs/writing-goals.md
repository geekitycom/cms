# Writing goals

Geekity CMS counts the words each user writes in the admin editor. A user can
set a goal, such as 250 words a day or 100,000 words a month, and a streak
rule. The dashboard then shows that user's progress on a Writing goal card.
Each user has their own counts, goal and card. The design is decision-63.

## What counts as a word

A word is a run of characters that holds a letter or a digit. Only the
Markdown body counts. The title, summary and other fields do not.

Before counting, the site removes link and image addresses, HTML tags and
Markdown markers such as `#`, `*`, `>`, list bullets and code fences. So
`[my post](https://example.com/a/long/path)` is two words. Text inside code
counts.

The editor uses the same rules for its word count, so the editor and the
dashboard give the same figures.

## What counts as writing

Only the words you add count. Deleting words never takes any away, and
replacing one word with another adds one. Moving a paragraph adds its words.

The site credits words to you when the server receives new text from you:

- **Autosave.** The words added since your previous autosave copy of that
  document, or since the saved file when you have no copy. All of a new
  document's words count.
- **Save draft, Publish or Update.** The words added since your autosave copy,
  or since the file on disk when you have no copy. Text an autosave already
  credited is not credited again, so typing 100 words, autosaving and then
  saving counts 100 words. Saving twice with no change counts nothing the
  second time. A save that is refused or meets a conflict counts nothing.
- **Micropub.** A create counts the whole body for the token's user. An update
  counts the words it adds to the file.

Imports such as the WordPress import do not count, and neither do the command
line and MCP. They move text, and moving text is not writing. Each user is counted from
their own autosave copy, so two users editing one post are credited
separately. Discarding a copy does not take back words already counted.

Each word counts on the day it reaches the server, in the site time zone
(Settings > General). Writing at 00:30 in another zone lands on the site's day.

The site counts words whether or not you track writing goals. When you turn
tracking on, the words you wrote before count toward your goal and streak.
Words written before the release that added writing goals are not counted.

## Where the counts are kept

The counts are kept in `data/writing/<user id>.json`, mode `0600`, as
`{ "days": { "2026-10-23": 312 } }`. Days with no words are not stored. The
site writes the file atomically. The file is in every site export and is
deleted with its user. Nothing else holds these counts, so the site cannot
rebuild the file.

## Setting a goal

Users > Writing goals at `/admin/users/writing-goals` holds your own goal. It
starts with a **Track writing goals** checkbox, off for every user. Tick it
and save, and the page shows the goal and streak fields:

- **Words** and **Every**. The goal, such as 250 words a day or 100,000 words
  a month. The period is a day, a week, a month or a year. Weeks start on
  Monday. A goal is required while tracking is on.
- **Words a day**. A day keeps your streak when you write at least this many
  words. Left empty, it is the goal for a daily goal and the goal's daily pace
  rounded up otherwise. For this default a week is 7 days, a month 30 and a
  year 365, so 100,000 words a month gives 3,334.
- **Missed days allowed**. How many missed days in a row the streak survives,
  from 0 to 7.

Untick the box to stop tracking. Your goal and rules are kept, and ticking the
box again restores them. The settings are stored on your entry in
`data/users.json` as `writingGoals`.

## Streaks

A day meets the streak rule when you wrote at least the **Words a day** that
day. Your current streak is the number of days that met the rule in the
current run.

A missed day does not end the run until more days in a row are missed than
**Missed days allowed**. With 1, missing a day is fine and missing two in a
row ends the streak. Missed days do not add to the streak. For example, with
1 miss allowed, writing on Monday, Tuesday and Thursday but not Wednesday is
a streak of 3.

Today does not break your streak until it is over. Today adds to the streak
once it meets the rule.

The best streak is the longest run anywhere in your history. The site counts
progress and streaks from the stored counts each time, so changing the rules
recounts all of your history under the new rules.

## The Writing goal card

While you track writing goals, the dashboard at `/admin` has a Writing goal
card. It shows:

- the words you wrote this period against your goal, as a bar and a
  percentage. A month is the calendar month and a week runs Monday to Sunday.
- how far ahead of or behind even pace you are. Even pace is the goal shared
  equally over the days of the period, up to and including today, rounded
  up. With 31,000 words for October, even pace on 20 October is 20,000 words.
- the words you wrote today, your current streak and your best streak.
- how many more words today needs to keep your streak going, or that today
  has already kept it going.
- a calendar of the words you wrote each day over the last 52 weeks. Days
  that met the streak rule have an outline. Show the numbers lists each day
  with words and whether it met the rule.

With tracking on and no words counted yet, the card shows the goal and says
that no words are written yet, with no calendar. If the file of counts cannot
be read, the card says so and the site logs a warning.

The card shows only your own figures. Each user who is signed in sees their
own card, and the site never shows one user's figures to another. The card
reads your counts each time the dashboard loads, so it includes your latest
autosave.

You can move, collapse and remove the card like any other dashboard card (see
[The dashboard](admin.md#the-dashboard)). A user who does not track writing
goals has no card, and Add back does not list it. Turning tracking on adds
the card. Turning it off removes the card again. A card you removed stays
removed when you turn tracking off and on, and Add back lists it.
