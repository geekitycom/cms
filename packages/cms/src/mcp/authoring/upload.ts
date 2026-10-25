import { writeAltText } from '../../content/alt-text.ts';
import { uploadPath } from '../../content/image-tags.ts';
import {
  largestUploadLimit,
  refusedUpload,
  storeUpload,
  tooLargeMessage,
} from '../../media/uploads.ts';
import { nullable } from '../../util/json-schema.ts';
import { absoluteUrl } from '../../util/url.ts';
import { defineTool } from '../tools.ts';
import { refused } from './shared.ts';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The longest base64 text a file of `bytes` is written as. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export const uploadMedia = defineTool({
  name: 'upload_media',
  title: 'Upload media',
  description:
    'Store a file in the media library, under the same rules as the admin’s uploads and the Micropub media endpoint, with its alt text. Returns the file’s address, to use as a photo property or in a post’s content.',
  scope: 'media',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description:
          'The file’s name with its extension, such as sunset.jpg. The extension decides what the file is.',
      },
      data: { type: 'string', description: 'The file’s bytes, base64-encoded.' },
      alt: {
        type: 'string',
        description: 'What the image shows, for somebody who cannot see it.',
      },
    },
    required: ['filename', 'data'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The file’s address.' },
      kind: { type: 'string', description: 'image, audio, video or document.' },
      alt: nullable({ type: 'string' }),
    },
    required: ['url', 'kind', 'alt'],
  },
  run: async (args, { site }) => {
    const { config } = site;
    const limit = largestUploadLimit(config);
    const data = args.data.replace(/\s+/g, '');
    if (data.length > base64Length(limit)) return refused(tooLargeMessage(limit));
    if (!BASE64.test(data) || data.length % 4 === 1) return refused('data is not base64.');

    const stored = await storeUpload(
      new File([Buffer.from(data, 'base64')], args.filename),
      config,
    );
    if (refusedUpload(stored)) return refused(stored.error);

    const alt = args.alt?.trim().replace(/\s+/g, ' ') ?? '';
    const source = uploadPath(stored.url);
    if (alt !== '' && source !== undefined) {
      await writeAltText(config.contentDir, source, { kind: 'described', text: alt });
    }
    const url = absoluteUrl(stored.url, config.baseUrl);
    return {
      ok: true,
      summary: `Stored ${url}${alt === '' ? ' with no alt text' : ''}.`,
      structured: { url, kind: stored.media.kind, alt: alt === '' ? null : alt },
    };
  },
});
