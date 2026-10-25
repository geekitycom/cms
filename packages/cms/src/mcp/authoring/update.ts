import { POST_KIND } from '../../content/document-kind.ts';
import { writeDocument } from '../../content/write.ts';
import { parseChanges, updateForm } from '../../content/micropub-update.ts';
import type { Change } from '../../content/micropub-update.ts';
import { absoluteUrl } from '../../util/url.ts';
import { documentSiteFrom } from '../../web/document-site.ts';
import { POST_INPUT } from '../inspect/post.ts';
import { ANY_OBJECT } from '../inspect/schemas.ts';
import { defineTool, isRefused, refused } from '../tools.ts';
import { ownPost, POST_WRITTEN, sourceSite, unsaved } from './shared.ts';

export const updatePost = defineTool({
  name: 'update_post',
  title: 'Edit a post',
  description:
    'Change named properties of one of your posts, as a Micropub update does, leaving every other property as it is. Read the post with get_post_source first and pass its hash: when the post changed since, nothing is written. Changing a published post, or setting post-status to published, publishes: the post is stamped updated, federates an Update and sends webmentions, so it needs the publish scope as well.',
  scope: 'update',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      post: POST_INPUT,
      hash: { type: 'string', description: 'The hash get_post_source returned.' },
      replace: {
        ...ANY_OBJECT,
        description: 'Properties whose values are replaced: {"content": ["New text"]}.',
      },
      add: { ...ANY_OBJECT, description: 'Values added to properties: {"category": ["new"]}.' },
      delete: {
        type: 'array',
        items: { type: 'string' },
        description: 'Properties taken away entirely: ["summary"].',
      },
      deleteValues: {
        ...ANY_OBJECT,
        description: 'Values taken out of properties: {"category": ["old"]}.',
      },
    },
    required: ['post', 'hash'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: POST_WRITTEN,
    required: ['url', 'slug', 'draft'],
  },
  run: async (args, { user, token, site }) => {
    const document = ownPost(site, user, args.post);
    if (isRefused(document)) return document;

    const parsed = parseChanges({
      replace: args.replace,
      add: args.add,
      delete: args.deleteValues,
    });
    if ('error' in parsed) return refused(parsed.error);
    const removed = (args.delete ?? []).map((property): Change => ({
      op: 'delete',
      property,
      values: undefined,
    }));
    const changes = [...parsed, ...removed];
    if (changes.length === 0) return refused('Name a property to replace, add or delete.');

    const { store, config } = site;
    const updated = updateForm(document, changes, {
      ...sourceSite(site),
      timezone: site.siteAtRequestStart.timezone,
      now: store.now(),
    });
    if ('errors' in updated) return refused(updated.errors.join(' '));
    const publishes = !document.draft || !updated.draft;
    if (publishes && !token.scopes.includes('publish')) return { needsScope: 'publish' };

    const written = await writeDocument(documentSiteFrom(site, user.username), {
      kind: POST_KIND,
      document,
      form: { ...updated.form, hash: args.hash },
      draft: updated.draft,
      keptProperties: updated.keptProperties,
    });
    if (written.outcome !== 'saved') return unsaved(written, document.slug);
    const { saved } = written;
    const url = absoluteUrl(saved.permalink, config.baseUrl);
    return {
      ok: true,
      summary: `Updated ${saved.slug} at ${url}${saved.draft ? ', still a draft' : ''}.`,
      structured: { url, slug: saved.slug, draft: saved.draft },
    };
  },
});
