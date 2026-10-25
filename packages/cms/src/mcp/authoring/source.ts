import { micropubType, sourceProperties } from '../../content/micropub-update.ts';
import { absoluteUrl } from '../../util/url.ts';
import { POST_INPUT } from '../inspect/post.ts';
import { ANY_OBJECT, READ_ONLY } from '../inspect/schemas.ts';
import { defineTool } from '../tools.ts';
import { isRefused, ownPost, sourceSite } from './shared.ts';

export const getPostSource = defineTool({
  name: 'get_post_source',
  title: 'Read a post’s source',
  description:
    'One of your posts as Micropub q=source answers it: its type and its properties, each a list of values, draft or published. Returns the hash update_post needs, so an edit fails rather than overwrites when the post changed in between.',
  scope: 'update',
  annotations: READ_ONLY,
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
      type: { type: 'string', description: 'h-entry, h-event or h-review.' },
      properties: { ...ANY_OBJECT, description: 'Each property as a list of values.' },
      hash: { type: 'string', description: 'The version read. Pass it to update_post.' },
    },
    required: ['url', 'slug', 'type', 'properties', 'hash'],
  },
  run: (args, { user, site }) => {
    const document = ownPost(site, user, args.post);
    if (isRefused(document)) return Promise.resolve(document);
    const url = absoluteUrl(document.permalink, site.config.baseUrl);
    return Promise.resolve({
      ok: true,
      summary: `${document.slug} is ${document.draft ? 'a draft' : 'published'} at ${url}.`,
      structured: {
        url,
        slug: document.slug,
        type: micropubType(document),
        properties: sourceProperties(document, sourceSite(site)),
        hash: document.hash,
      },
    });
  },
});
