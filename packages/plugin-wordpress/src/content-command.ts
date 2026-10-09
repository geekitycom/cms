import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { PluginCommand, PluginCommandContext, PluginDataFolder } from '@geekity/cms/plugin';

import { importWordPressContent } from './content-import.ts';
import type { ImportReport, Outcome, WordPressImporter } from './content-import.ts';
import { attachments } from './media-import.ts';
import { postsAndPages } from './posts-import.ts';
import { NotAWordPressExportError, parseWordPressExport } from './wxr.ts';
import type { WordPressExport } from './wxr.ts';

const IMPORTERS: readonly WordPressImporter[] = [postsAndPages, attachments];

/**
 * `geekity import wordpress <export.xml>`: a WXR export becomes files in the
 * content directory. Like `import wordpress-actor` it runs whether or not the
 * plugin is enabled, and it is meant to be run again: before the cutover to
 * check the result and after it to pick up what arrived in between.
 */
export function contentImportCommand(data: PluginDataFolder): PluginCommand {
  return {
    words: ['import', 'wordpress'],
    usage: '<export.xml> [--uploads <directory>] [--origins <url,…>]',
    summary:
      'Bring the posts, pages, media, reactions and redirects of a WordPress export (Tools > Export) into the content directory. Rerunnable; never overwrites a file the import did not write.',
    options: [
      {
        name: 'uploads',
        value: '<directory>',
        description:
          "A copy of the site's wp-content/uploads. Each attachment's original is copied from it into content/uploads/ at the same path. Left off, no media is copied and the report names each attachment.",
      },
      {
        name: 'origins',
        value: '<url,…>',
        description:
          "Other origins the posts wrote media URLs on, such as the staging host the site was built on, comma-separated. URLs on the export's own origin are always rewritten.",
      },
    ],
    run: (context) => run(context, data),
  };
}

async function run(context: PluginCommandContext, data: PluginDataFolder): Promise<number> {
  const given = context.args[0];
  if (given === undefined) {
    throw new Error(
      'geekity import wordpress <export.xml> needs the file WordPress wrote under Tools > Export.',
    );
  }
  const exported = await readExport(given, path.resolve(context.cwd, given));
  const report = await importWordPressContent({ exported, context, data, importers: IMPORTERS });
  context.write(formatReport(given, context.site.contentDir, report));
  return 0;
}

async function readExport(given: string, file: string): Promise<WordPressExport> {
  let xml: string;
  try {
    xml = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(
      `${given} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  try {
    return parseWordPressExport(xml);
  } catch (error) {
    if (!(error instanceof NotAWordPressExportError)) throw error;
    throw new Error(
      [`${given} is not a WordPress export:`, ...error.problems.map((line) => `  ${line}`)].join(
        '\n',
      ),
      { cause: error },
    );
  }
}

const OUTCOMES: readonly Outcome[] = [
  'written',
  'unchanged',
  'kept',
  'conflict',
  'clash',
  'skipped',
  'warned',
];

function formatReport(given: string, contentDir: string, report: ImportReport): string {
  const count = (values: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const outcomes = count(report.rows.map((row) => row.outcome));
  const skippedTypes = count(
    report.rows.filter((row) => row.outcome === 'skipped').map((row) => row.item.type),
  );

  const lines = [
    `Imported ${given} into ${contentDir}`,
    `  ${OUTCOMES.map((outcome) => `${String(outcomes.get(outcome) ?? 0)} ${outcome}`).join(', ')}`,
  ];
  if (skippedTypes.size > 0) {
    lines.push(
      `  skipped by type: ${[...skippedTypes]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([type, n]) => `${type} ${String(n)}`)
        .join(', ')}`,
    );
  }
  if ((outcomes.get('conflict') ?? 0) + (outcomes.get('clash') ?? 0) > 0) {
    lines.push(
      '  Conflicts and clashes were left as they are on this site. Resolve each by hand, or remove the file and run the import again.',
    );
  }

  lines.push('', ['outcome', 'type', 'id', 'title', 'path', 'why'].join('\t'));
  for (const row of report.rows) {
    lines.push(
      [
        row.outcome,
        row.item.type,
        String(row.item.id),
        row.item.title.replace(/\s+/g, ' '),
        row.path ?? '',
        row.why,
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}
