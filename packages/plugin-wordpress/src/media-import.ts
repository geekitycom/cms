import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { PluginCommandContext } from '@geekity/cms/plugin';

import type {
  DataEntry,
  ImportedFile,
  ImporterOutput,
  ItemNote,
  WordPressImporter,
} from './content-import.ts';
import { uploadUrl, wordPressMedia } from './media.ts';
import type { UploadPath } from './media.ts';
import type { WordPressExport, WordPressItem } from './wxr.ts';

const MEDIA_FILE = '_data/media.json';

/**
 * Each attachment's original, copied from a local copy of `wp-content/uploads`
 * into `content/uploads/` at the same path, with its alt text. An upload a
 * post or page shows that is no attachment is copied too, for that post.
 */
export const attachments: WordPressImporter = {
  postTypes: ['attachment'],
  import: importAttachments,
};

async function importAttachments(
  exported: WordPressExport,
  context: PluginCommandContext,
): Promise<ImporterOutput> {
  const media = wordPressMedia(exported, context.options['origins']);
  const given = context.options['uploads'];
  if (given === true) {
    throw new Error('--uploads needs the directory, a copy of wp-content/uploads.');
  }

  const wanted = new Map<UploadPath, WordPressItem>(media.originals);
  for (const item of exported.items) {
    if (item.type !== 'post' && item.type !== 'page') continue;
    for (const upload of media.references(item.content)) {
      const original = media.originalOf(upload);
      if (!wanted.has(original)) wanted.set(original, item);
    }
  }

  const files: ImportedFile[] = [];
  const notes: ItemNote[] = [];
  const entries: DataEntry[] = [];
  const uploadsDir = given === undefined ? undefined : path.resolve(context.cwd, given);

  for (const [upload, item] of wanted) {
    if (uploadsDir === undefined) {
      notes.push({
        item,
        outcome: 'warned',
        why: 'not copied: give --uploads <directory>, a copy of wp-content/uploads',
      });
      continue;
    }
    const bytes = await readIfPresent(path.join(uploadsDir, ...upload.split('/')));
    if (bytes === undefined) {
      notes.push({
        item,
        outcome: 'warned',
        why: `${upload} is not in ${uploadsDir}; ${uploadUrl(upload)} will not answer until it is there`,
      });
      continue;
    }
    const check = context.site.checkUpload(path.posix.basename(upload), bytes);
    if (!check.accepted) {
      notes.push({ item, outcome: 'warned', why: `${upload} was not copied: ${check.why}` });
      continue;
    }
    files.push({ item, path: `uploads/${upload}`, contents: check.bytes });

    const alt = item.meta.find((meta) => meta.key === '_wp_attachment_image_alt')?.value.trim();
    if (item.type === 'attachment' && alt !== undefined && alt !== '') {
      entries.push({ item, file: MEDIA_FILE, key: upload, value: { alt } });
    }
  }
  return { files, notes, entries };
}

async function readIfPresent(file: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
