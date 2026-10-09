# @geekity/plugin-tag-suggest

A [Geekity CMS](../cms/README.md) plugin that suggests tags for a post in the
editor. It asks the language model that
[`@geekity/plugin-llm`](../plugin-llm/README.md) connects the site to for
hashtags that fit the draft: specific tags for the post itself, and tags from a
list of hashtags people follow, for reach. Follower counts on
[tags.pub](https://tags.pub) help rank both. It runs only when the author presses the
button. Nothing is sent when a post is saved or published.

## Installing it

It requires `@geekity/plugin-llm` 0.2.0 or any later 0.x release, and works with
every 0.x release of `@geekity/cms` from the one it was built against, which
its peer dependency names. Add both packages to the site and to `plugins` in
its config:

```sh
pnpm add @geekity/plugin-llm @geekity/plugin-tag-suggest
```

```ts
import { defineConfig } from '@geekity/cms';
import llm from '@geekity/plugin-llm';
import tagSuggest from '@geekity/plugin-tag-suggest';

export default defineConfig({
  plugins: [llm, tagSuggest],
});
```

On Docker, add both packages to the plugins folder instead, then press Reload
under `/admin/plugins`:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-llm
docker compose exec geekity geekity plugin add @geekity/plugin-tag-suggest
```

Enable LLM under `/admin/plugins` and set its API key on its screen. Then
enable Tag suggestions. It uses the model chosen on the LLM screen, which must
support structured output.

Its one setting, **Tag server**, is where follower counts come from. It is
`https://tags.pub` unless you run the tags.pub software yourself.

## In the editor

The plugin puts a **Suggest tags** button under Tags. A press sends the draft
as it stands to the model: the title, the body, the tags it already has, the
kind of post and the tags the site already uses. The model is told to use a
site tag only when the post is about that subject. It is also sent the seed
list described below.

The model answers in two groups, shown under their own headings:

- **For this post** holds 3 to 5 specific tags for what the post is about,
  most fitting first. The model is asked to avoid generic words such as
  "experience" or "thoughts". Tags the site already uses come first, and the
  rest keep the model's order. Follower counts are shown but do not reorder
  this group: fit comes first here, and reach has its own group.
- **For reach** holds up to 5 tags from the seed list that the post is about,
  most followed first. The model is told to leave this group empty when none
  fit, and a tag that is not on the seed list is never offered here. A tag
  already in the first group is not shown again.

Each tag keeps a readable spelling, with several words joined in CamelCase, so
`WordCamp US` is offered as `WordCampUS`. That spelling is what Accept puts in
the Tags field. The plugin uses a folded form, which is lower case with no `#`,
no accents and nothing but letters and digits, only to look the tag up on
tags.pub and to match it against the site's tags. It drops repeats and any tag
whose folded form is empty, such as one in a script tags.pub transliterates. A
tag the site already uses keeps the site's spelling and is marked **Used here**.

Each tag is shown with its tags.pub follower count. tags.pub answers for any
tag, so **No followers** means nobody follows it there yet. Tick the tags you
want and press **Accept**. Accepting adds them to the Tags field, skips any the
field already has, whatever the case, and saves nothing. **Dismiss** drops the
list.

When the model call fails, the reason appears under the button in plain words.
When tags.pub fails or is slow, the tags are still shown, with
**Followers unknown** and the reason. Without JavaScript the button is not
shown.

## The seed list

`src/seed.ts` lists hashtags people follow, with how many follow each. It is
built from a `tag,followers` export of the tags.pub accounts followed on one
Mastodon server, and records that source and the export's date. The current
list comes from mastodon.social on 2026-10-08. A count is the followers from
that one server, so it ranks the tags against each other rather than counting
everyone.

The build keeps tags with at least 2 followers. It drops tags.pub's own service
accounts, whose names start with `_`, such as `_followback`. It also drops
every sexual or adult tag named in `scripts/denylist.txt`. A line there is a
tag, or a fragment between asterisks that drops every tag containing it. To
rebuild the list from a new export, run:

```sh
pnpm --filter @geekity/plugin-tag-suggest seed <export.csv> --source "<where it came from>" --date <YYYY-MM-DD>
```

Read the new tags before committing, and add any adult tag the denylist missed
to it. Do not commit the export itself.

## Being polite to tags.pub

tags.pub publishes no rate limits, so the plugin keeps its requests few:

- It makes one request per tag, for the tag's followers collection. At most
  four run at once, and each gives up after five seconds.
- Each request sends the User-Agent `Geekity-Tag-Suggest/<version> (+<site URL>)`,
  so tags.pub can tell whose site is asking.
- Each count is kept for a day in `data/plugins/@geekity/plugin-tag-suggest/followers.json`.
  A second suggestion within the day asks tags.pub nothing for tags it already
  counted. A failed lookup is not kept.

The requests go from the server, through the site's outbound fetch, which
refuses private and loopback addresses unless the site allows them.
