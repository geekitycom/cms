import type { PluginPageTag, PluginPageTagAttributes, PluginPageTags } from '../plugin.ts';
import { isRecord } from '../util/guards.ts';
import { escapeAttribute } from '../util/html.ts';

export interface DrawnPageTags {
  readonly headEnd: string;
  readonly bodyEnd: string;
}

export const NO_PAGE_TAGS: DrawnPageTags = { headEnd: '', bodyEnd: '' };

const ATTRIBUTE_NAME = /^[a-zA-Z][a-zA-Z0-9_:.-]*$/;
const EVENT_HANDLER = /^on/i;
const URL_ATTRIBUTES = new Set(['src', 'href']);

export function drawPageTags(tags: PluginPageTags): DrawnPageTags {
  if (!isRecord(tags)) throw new Error('Its page tags are not an object.');
  return { headEnd: drawList(tags.headEnd, 'headEnd'), bodyEnd: drawList(tags.bodyEnd, 'bodyEnd') };
}

function drawList(list: unknown, where: string): string {
  if (list === undefined) return '';
  if (!Array.isArray(list)) throw new Error(`Its ${where} tags are not an array.`);
  return list.map(drawTag).join('\n');
}

function drawTag(tag: unknown): string {
  if (!isRecord(tag)) throw new Error('A page tag is not an object.');
  const declared = tag as Partial<PluginPageTag> & { readonly tag?: unknown };
  switch (declared.tag) {
    case 'script': {
      const attributes = declared.attributes ?? {};
      if (isRecord(attributes) && Object.hasOwn(attributes, 'src')) {
        throw new Error('A script names its src once, outside its attributes.');
      }
      return `<script${drawAttributes({ src: declared.src, ...attributes })}></script>`;
    }
    case 'link':
    case 'meta':
      return `<${declared.tag}${drawAttributes(declared.attributes)}>`;
    default:
      throw new Error(
        `${JSON.stringify(declared.tag)} is not a page tag: use script, link or meta.`,
      );
  }
}

function drawAttributes(
  attributes: PluginPageTagAttributes | Record<string, unknown> | undefined,
): string {
  if (!isRecord(attributes)) throw new Error('A page tag has no attributes object.');
  let drawn = '';
  for (const [name, value] of Object.entries(attributes)) {
    if (!ATTRIBUTE_NAME.test(name) || EVENT_HANDLER.test(name)) {
      throw new Error(`${JSON.stringify(name)} is not an attribute a page tag may carry.`);
    }
    if (value === false) continue;
    if (value === true) {
      drawn += ` ${name}`;
      continue;
    }
    if (typeof value !== 'string') {
      throw new Error(`The ${name} attribute is not text, true or false.`);
    }
    if (URL_ATTRIBUTES.has(name.toLowerCase()) && !isAllowedUrl(value)) {
      throw new Error(
        `The ${name} ${JSON.stringify(value)} is not an http(s) URL or a path that starts with /.`,
      );
    }
    drawn += ` ${name}="${escapeAttribute(value)}"`;
  }
  return drawn;
}

function isAllowedUrl(value: string): boolean {
  if (value.startsWith('/')) return value[1] !== '/' && value[1] !== '\\';
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
