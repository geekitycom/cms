import nunjucks from 'nunjucks';
import type { Environment } from 'nunjucks';

import { createTemplateEnvironment, useThemeDirs } from '../theme/templates.ts';
import { formatFileSize } from '../util/file-size.ts';
import { escapeMarkdown } from './markdown-page.ts';
import type { MarkdownUrl } from './markdown-page.ts';
import type { TextFormat } from './negotiate.ts';
import type { RenderDeps, ThemeText } from './render.ts';
import { writesGemtext } from './theme-templates.ts';
import type { TextTemplates } from './theme-templates.ts';

export interface MarkdownEnvironment {
  readonly environment: Environment;
  /**
   * One Markdown or gemtext template pair through the chosen theme: gemtext
   * comes from the first of the theme's `.gmi.njk`, its `.md.njk`, the default
   * theme's `.gmi.njk` and its `.md.njk`, and the result says
   * which format the theme wrote.
   */
  renderText(
    templates: TextTemplates,
    format: TextFormat,
    context: Record<string, unknown>,
  ): ThemeText;
}

/**
 * The twin the Markdown partials render through: the same loader and filters
 * as the HTML environment, autoescaping off, and the Markdown filters.
 */
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

  return {
    environment,
    renderText(templates, format, context) {
      const { dirs } = themes.current();
      useThemeDirs(environment, dirs);
      const written = format === 'gemini' && writesGemtext(dirs, templates) ? 'gemini' : 'markdown';
      return { format: written, text: environment.render(templates[written], context) };
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

/** Every line after the first indented by `width` spaces, blank lines left blank. */
function nest(text: string, width: number): string {
  const indent = ' '.repeat(width);
  return text.replace(/\n(?=[^\n])/g, `\n${indent}`);
}

/** Markdown as a blockquote: every line after `> `, a blank line as `>`. */
function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** A filter's input as text: a string, number or boolean as written, anything else empty. */
function filterText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}
