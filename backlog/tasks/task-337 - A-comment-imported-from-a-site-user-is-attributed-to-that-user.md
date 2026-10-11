---
id: TASK-337
title: A comment imported from a site user is attributed to that user
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 22:40'
updated_date: '2026-10-11 00:28'
labels:
  - enhancement
milestone: m-31
dependencies:
  - TASK-336
priority: low
ordinal: 296800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org import (2026-10-08 export). WordPress records who wrote a comment while signed in: comment_user_id. Andrew's 5 replies (comments 4, 20, 22, 26 and 27 on posts 223 and 501) carry comment_user_id 2, his WordPress user. plugin-wordpress ignores it, so Geekity shows them as a stranger's comment: an author h-card linking to https://andrewshell.org/ with rel="nofollow ugc noopener noreferrer", and nothing marking him as the site's author. Since v0.29.0 a signed-in user's reply is a reply post, so a native one would be shown as the author's own. Proposal: when an imported comment's comment_user_id maps to a Geekity user (the same mapping post authors use, which matches by user name, as import wordpress-actor --wordpress-id does), the record names that user, and the thread shows it the way it shows a user's reply post: the user's own name and link, no nofollow ugc, marked as the site's author. Converting such comments into reply posts is out of scope; they stay migrated comment records (TASK-336).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 plugin-wordpress records the Geekity user on an imported comment whose comment_user_id maps to one
- [x] #2 The thread shows such a comment as that user's, with their author archive as the profile link (as a reply post's author link is) and no rel=nofollow ugc
- [x] #3 On the andrewshell.org import, comments 4, 20, 22, 26 and 27 show as Andrew's
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: an optional `user` (a Geekity username) on CommentRecord, PluginComment and the comments cache (SQLite column user, migration 28); absent on every comment nobody signed in wrote. Read and written through records.ts (content file), store.ts (cache), plugins/site.ts (plugin view), with one userField helper.
2. InteractionAuthor gains `username` (null unless a site user): the one marker a theme reads for 'this is the site's own user'. documentAuthor and a stored comment naming a user both build it from the same AuthorContext (profileContext), so a user's comment shows their display name, avatar, author archive and author feed exactly as their reply post does. A stored comment naming a user the site no longer has falls back to the name it stored.
3. Default theme: partials/comment.njk and layouts/comment.njk drop rel=nofollow ugc when author.username is set, replacing the source != "post" test (one marker for reply posts and user comments).
4. plugin-wordpress: comment_user_id -> wp:author login (exported.authors) -> Geekity username when the site has that user (the post-author rule in posts-import), written as user on the migrated comment.
5. Tests first: plugin-wordpress records user; cms thread and comment page show a user's comment as theirs without nofollow, and fall back for a vanished user; round trip through file and cache.
6. Verify AC#3 on a scratch import of the andrewshell.org WXR (user andrew), curl posts 223 and 501.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built (2026-10-10):
- Data shape: CommentRecord.user?: string (a Geekity username), absent on every comment nobody signed in wrote, so existing comment files stay byte for byte. userField helper in admin/store.ts beside viaField; read and written in comments/records.ts (content file, both writers), the comments cache (admin/store.ts column user, migration 28, putComment/replaceComments/toComment), and the plugin view (plugin.ts PluginComment.user, plugins/site.ts both ways). updateComment keeps it by spreading the held entry.
- web/conversation.ts: InteractionAuthor.username (string | null) is the one marker a theme reads for a site user. documentAuthor now goes through bylineAuthor(AuthorContext, fallback), and interactionOf (now given the site's users once per gather) builds a stored comment's author with the same bylineAuthor(profileContext(user)) when its user is on the site: display name, avatar, /author/{username}/ link, author feed. A comment naming a user the site no longer has keeps the name and link it was stored with. Fediverse authors carry username null.
- Default theme: partials/comment.njk and both author links in layouts/comment.njk drop rel=nofollow ugc when author.username is set. This replaces the old source != "post" test, so a reply post and a site user's imported comment share one marker. The comment page's main author link was always nofollow before; it now follows the same rule. Theme README documents author.username.
- plugin-wordpress comments-import.ts: comment_user_id -> wp:author id -> login, kept as user when the site has a user by that login (the post-author rule in posts-import.ts). content-import.ts: a rerun gives an existing imported comment its user even when a moderator changed it (the import owns who wrote it), and never clears one. README documents both.
- Deleted: the source != "post" rel tests in the theme (replaced by the marker).
Not done: no CSS class or visible badge marks the site's author; reply posts had none either, so nothing to share beyond the rel rule and the h-card link.

Verification: web/migrated-comments.test.ts (a user's comment on the post, on its own page and cited on a reply's page shows Ada at /author/ada/ with no nofollow; a vanished user keeps the stored name with nofollow) and plugin-wordpress comments-import.test.ts (user 2 -> ada only when the site has ada; user 3 not in the export and user 0 name nobody; a rerun after ada is created names her on a comment a moderator marked spam) were seen failing before the code. pnpm build, pnpm test (cms 5419, plugin-wordpress 95, all 0 fail), pnpm typecheck, pnpm lint, pnpm format:check pass.
AC#3: scratchpad/site337, user andrew (display name Andrew Shell) created, then the real andrewshell.org WXR imported with dist/cli.js and plugin-wordpress: exactly five comment records carry user andrew (comments 4 on post 223 and 20, 22, 26, 27 on post 501, per the import report). Served: on /2026/03/wordpress-migration/ and /2026/04/blurt-marketing-gone-wrong/ all five render <a class="url u-url" href="/author/andrew/">Andrew Shell</a> with no rel; the other five comments on post 501 keep rel=nofollow ugc; /author/andrew/ answers 200; /comment/a43a98d3631c5dca/ names Andrew Shell at /author/andrew/; /comments/feed/ still has no item. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A comment record can name the Geekity user who wrote it (user, a username; absent otherwise) in the comment file, the cache (migration 28) and the plugin API. The thread names such a comment's author the way it names a reply post's, through one bylineAuthor built from the user's AuthorContext, and InteractionAuthor.username is now the single marker the default theme reads to drop rel=nofollow ugc, for reply posts and these comments alike. plugin-wordpress maps comment_user_id to a site user by WordPress login, as post authors are mapped, and a rerun fills it in on comments already imported. Verified by red-then-green tests in cms and plugin-wordpress, the full gate set, and a scratch import of the real andrewshell.org WXR where comments 4, 20, 22, 26 and 27 show as Andrew Shell linking to /author/andrew/ without nofollow.
<!-- SECTION:FINAL_SUMMARY:END -->
