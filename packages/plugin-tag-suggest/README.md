# @geekity/plugin-tag-suggest

A [Geekity CMS](../cms/README.md) plugin that suggests tags for a post in the
editor. It asks the language model that
[`@geekity/plugin-llm`](../plugin-llm/README.md) connects the site to for
hashtags that fit the draft, then ranks them by how many people follow each one
on [tags.pub](https://tags.pub). It runs only when the author presses the
button. Nothing is sent when a post is saved or published.

## Installing it

It requires `@geekity/plugin-llm`. Add both packages to the site and to
`plugins` in its config:

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

Enable LLM under `/admin/plugins` and set its API key on its screen. Then
enable Tag suggestions. It uses the model chosen on the LLM screen, which must
support structured output.

Its one setting, **Tag server**, is where follower counts come from. It is
`https://tags.pub` unless you run the tags.pub software yourself.

## In the editor

The plugin puts a **Suggest tags** button under Tags. A press sends the draft
as it stands to the model: the title, the body, the tags it already has, the
kind of post and the tags the site already uses, so the model prefers those.

The plugin then folds each tag the way tags.pub names its accounts: lower case,
no `#`, accents dropped, and nothing but letters and digits, so `#Indie-Web`
becomes `indieweb`. It drops repeats and any tag that comes out empty, such as
one in a script tags.pub transliterates. A tag the site already uses keeps the
site's spelling and is marked **Used here**.

Each tag is shown with its tags.pub follower count, most followed first. tags.pub
answers for any tag, so **No followers** means nobody follows it there yet.
Tick the tags you want and press **Accept**. Accepting adds them to the Tags
field, skips any the field already has, whatever the case, and saves nothing.
**Dismiss** drops the list.

When the model call fails, the reason appears under the button in plain words.
When tags.pub fails or is slow, the tags are still shown, with
**Followers unknown** and the reason. Without JavaScript the button is not
shown.

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
