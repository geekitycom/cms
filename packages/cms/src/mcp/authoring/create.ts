import { POST_KIND } from '../../content/document-kind.ts';
import { writeDocument } from '../../content/write.ts';
import { createForm, fromJson, propertyName } from '../../content/micropub-create.ts';
import { absoluteUrl } from '../../util/url.ts';
import { documentSiteFrom } from '../../web/document-site.ts';
import { ANY_OBJECT } from '../inspect/schemas.ts';
import { defineTool } from '../tools.ts';
import { POST_WRITTEN, refused } from './shared.ts';

export const MICROPUB_PROPERTIES = {
  ...ANY_OBJECT,
  description:
    'Microformats2 properties as Micropub JSON has them, each a list of values: {"content": ["Hello"], "category": ["a", "b"]}. Any property the site’s Micropub endpoint takes, such as name, content, summary, category, in-reply-to, like-of, repost-of, bookmark-of, photo, rsvp, location, published, visibility and mp-slug.',
} as const;

export const createDraft = defineTool({
  name: 'create_draft',
  title: 'Draft a post',
  description:
    'Write a new post as a draft, through the same path a Micropub create takes, so the file is the one the editor would write. Every kind Micropub covers works: a note, an article, a reply, a like, a repost, a bookmark, a photo, an RSVP, an event or a review. A draft is never published, federated or mentioned; publish it with publish_post.',
  scope: 'create',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'h-entry, h-event or h-review. h-entry unless given.',
      },
      properties: MICROPUB_PROPERTIES,
    },
    required: ['properties'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: POST_WRITTEN,
    required: ['url', 'slug', 'draft'],
  },
  run: async (args, { user, site }) => {
    const request = fromJson({ type: [args.type ?? 'h-entry'], properties: args.properties });
    if ('error' in request) return refused(request.error);
    const published = [...request.properties].some(
      ([name, values]) => propertyName(name) === 'post-status' && values.some((v) => v !== 'draft'),
    );
    if (published) {
      return refused(
        'create_draft only writes drafts. Leave out post-status and use publish_post.',
      );
    }

    const { store, config } = site;
    const created = createForm(request, {
      author: user.username,
      timezone: site.siteAtRequestStart.timezone,
      now: store.now(),
      baseUrl: config.baseUrl,
      targets: site.siteRecords.syndicationTargets(),
    });
    if ('errors' in created) return refused(created.errors.join(' '));

    const written = await writeDocument(documentSiteFrom(site, user.username), {
      kind: POST_KIND,
      document: undefined,
      form: created.form,
      draft: true,
      keptProperties: created.keptProperties,
    });
    if (written.outcome === 'refused') return refused(written.message);
    if (written.outcome === 'conflict') throw new Error('A new post has no file to conflict with.');
    const { saved } = written;
    const url = absoluteUrl(saved.permalink, config.baseUrl);
    return {
      ok: true,
      summary: `Drafted ${saved.slug} at ${url}.`,
      structured: { url, slug: saved.slug, draft: saved.draft },
    };
  },
});
