import { formFor } from '../../content/document-form.ts';
import { POST_KIND } from '../../content/document-kind.ts';
import { postLocations } from '../../content/locations.ts';
import { isTrashedPath } from '../../content/store.ts';
import { writeDocument } from '../../content/write.ts';
import { absoluteUrl } from '../../util/url.ts';
import { documentSiteFrom } from '../../web/document-site.ts';
import { POST_INPUT } from '../inspect/post.ts';
import { defineTool, isRefused, refused } from '../tools.ts';
import { ownPost, unsaved } from './shared.ts';

export const publishPost = defineTool({
  name: 'publish_post',
  title: 'Publish a draft',
  description:
    'Publish one of your drafts as it reads now, as the editor’s Publish button does: the post goes public, federates a Create to followers and sends its webmentions. A post that is already published is left as it is.',
  scope: 'publish',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: { post: POST_INPUT },
    required: ['post'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      slug: { type: 'string' },
      alreadyPublished: {
        type: 'boolean',
        description: 'true when the post was published before this call, which changed nothing.',
      },
    },
    required: ['url', 'slug', 'alreadyPublished'],
  },
  run: async (args, { user, site }) => {
    const document = ownPost(site, user, args.post);
    if (isRefused(document)) return document;
    const { baseUrl, dataDir } = site.config;
    if (isTrashedPath(document.path)) {
      return refused(`${document.slug} is in the trash. Restore it in the admin first.`);
    }
    if (!document.draft) {
      const url = absoluteUrl(document.permalink, baseUrl);
      return {
        ok: true,
        summary: `${document.slug} was already published at ${url}; nothing changed.`,
        structured: { url, slug: document.slug, alreadyPublished: true },
      };
    }

    const timezone = site.siteAtRequestStart.timezone;
    const form = formFor(
      POST_KIND,
      document,
      timezone,
      postLocations(dataDir).read(document.permalink),
    );
    const written = await writeDocument(documentSiteFrom(site, user.username), {
      kind: POST_KIND,
      document,
      form,
      draft: false,
    });
    if (written.outcome !== 'saved') return unsaved(written, document.slug);
    const { saved } = written;
    const url = absoluteUrl(saved.permalink, baseUrl);
    return {
      ok: true,
      summary: `Published ${saved.slug} at ${url}.`,
      structured: { url, slug: saved.slug, alreadyPublished: false },
    };
  },
});
