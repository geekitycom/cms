import nunjucks from 'nunjucks';
import type { Environment } from 'nunjucks';

import { createTemplateEnvironment, useThemeDirs } from '../theme/templates.ts';
import { formatFileSize } from '../util/file-size.ts';
import { escapeMarkdown } from './markdown-page.ts';
import type { MarkdownUrl } from './markdown-page.ts';
import type { TextFormat } from './negotiate.ts';
import type { RenderDeps, ThemeText } from './render.ts';
import { slotFormat } from './theme-templates.ts';
import type { TextTemplates } from './theme-templates.ts';

export interface MarkdownEnvironment {
  readonly environment: Environment;
  renderText(
    templates: TextTemplates,
    format: TextFormat,
    context: Record<string, unknown>,
  ): ThemeText;
  /** The format a slot is written in on a page in `format`, `undefined` when no theme has it. */
  slotFormat(templates: TextTemplates, format: TextFormat): TextFormat | undefined;
  render(template: string, context: Record<string, unknown>): string;
}

export function createMarkdownEnvironment(
  deps: Pick<RenderDeps, 'config' | 'themes'>,
): MarkdownEnvironment {
  const { config, themes } = deps;
  const environment = createTemplateEnvironment({
    themeDirs: themes.current().dirs,
    baseUrl: config.baseUrl,
    now: config.now,
    noCache: config.watch,
    autoescape: false,
  });
  addMarkdownFilters(environment);

  const current = (): readonly string[] => {
    const { dirs } = themes.current();
    useThemeDirs(environment, dirs);
    return dirs;
  };

  return {
    environment,
    renderText(templates, format, context) {
      const dirs = current();
      const written =
        format === 'gemini' ? (slotFormat(dirs, templates, format) ?? 'markdown') : 'markdown';
      return { format: written, text: environment.render(templates[written], context) };
    },
    slotFormat: (templates, format) => slotFormat(current(), templates, format),
    render(template, context) {
      current();
      return environment.render(template, context);
    },
  };
}

function addMarkdownFilters(environment: Environment): void {
  environment.addFilter('escapeMarkdown', (value: unknown) => escapeMarkdown(filterText(value)));
  environment.addFilter('fileSize', (value: unknown) =>
    typeof value === 'number' ? formatFileSize(value) : '',
  );
  environment.addFilter('nest', (value: unknown, width: unknown) =>
    nest(
      value instanceof nunjucks.runtime.SafeString ? value.toString() : filterText(value),
      typeof width === 'number' ? width : 2,
    ),
  );
  environment.addFilter('quote', (value: unknown) => quote(filterText(value)));
  for (const name of ['markdownUrl', 'geminiUrl']) {
    environment.addFilter(name, function (this: unknown, value: unknown) {
      const url = filterText(value);
      const lookup = (this as { lookup?: (name: string) => unknown } | undefined)?.lookup;
      const write = typeof lookup === 'function' ? lookup.call(this, name) : undefined;
      return typeof write === 'function' ? (write as MarkdownUrl)(url) : url;
    });
  }
}

function nest(text: string, width: number): string {
  const indent = ' '.repeat(width);
  return text.replace(/\n(?=[^\n])/g, `\n${indent}`);
}

function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
}

function filterText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}
