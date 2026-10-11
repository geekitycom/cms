/**
 * Check that every relative link and every `#anchor` in the repository's
 * Markdown points at a file that exists and a heading that file has.
 *
 * It reads the root README, each package's README, the default theme's README
 * and everything under `docs/`. A link to this repository on GitHub
 * (`https://github.com/geekitycom/cms/blob/main/...`) is checked against the
 * checkout too, because the READMEs that ship to npm cannot use relative links
 * into `docs/`. For the same reason a README that ships to npm may not link
 * relatively out of its own package.
 *
 * Anchors follow GitHub's rules: the heading's text, lower-cased, with
 * everything but letters, digits, spaces, `-` and `_` dropped, spaces turned
 * into `-`, and `-1`, `-2` and so on added to a repeated heading.
 *
 * Usage (from the repository root):
 *
 *   node scripts/check-doc-links.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const REPOSITORY = 'https://github.com/geekitycom/cms';

export interface Link {
  readonly line: number;
  readonly target: string;
}

export interface Problem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** The lines with fenced code blocks blanked out, line count kept. */
function withoutFences(markdown: string): string[] {
  const lines = markdown.split('\n');
  let fence: string | undefined;
  return lines.map((line) => {
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length) {
        fence = undefined;
      }
      return '';
    }
    if (opener !== undefined) {
      fence = opener;
      return '';
    }
    return line;
  });
}

function withoutCodeSpans(line: string): string {
  return line.replace(/(`+)(?:(?!\1).)+?\1/g, (span) => ' '.repeat(span.length));
}

/** The anchor GitHub gives a heading whose Markdown source is `text`. */
export function slug(text: string): string {
  const rendered = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*]/g, '')
    .replace(/(^|\s)_+(?=\S)|(?<=\S)_+(?=\s|$)/g, '$1');
  return rendered
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor a Markdown file answers to: its headings and its explicit `id`s. */
export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of withoutFences(markdown)) {
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const base = slug(heading[1] ?? '');
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${String(count)}`);
    }
    for (const id of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(id[1] ?? '');
  }
  return anchors;
}

/** Every inline link, image and reference definition outside code. */
export function linksOf(markdown: string): Link[] {
  const links: Link[] = [];
  withoutFences(markdown)
    .map(withoutCodeSpans)
    .forEach((line, index) => {
      for (const match of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
        links.push({ line: index + 1, target: (match[1] ?? '').replace(/^<|>$/g, '') });
      }
      const definition = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(line);
      if (definition !== null) {
        links.push({ line: index + 1, target: (definition[1] ?? '').replace(/^<|>$/g, '') });
      }
    });
  return links;
}

/** Every `[text][label]` whose label no `[label]: target` line in the file defines. */
export function undefinedReferences(markdown: string): Link[] {
  const lines = withoutFences(markdown).map(withoutCodeSpans);
  const defined = new Set<string>();
  for (const line of lines) {
    const definition = /^\s{0,3}\[([^\]]+)\]:/.exec(line);
    if (definition !== null) defined.add((definition[1] ?? '').toLowerCase());
  }
  const missing: Link[] = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\[([^\]]*)\]\[([^\]]*)\]/g)) {
      const label = (match[2] === '' ? match[1] : match[2])?.toLowerCase() ?? '';
      if (!defined.has(label)) missing.push({ line: index + 1, target: `[${label}]` });
    }
  });
  return missing;
}

/** The Markdown files this checker owns, relative to the repository root. */
export function docFiles(root: string): string[] {
  const files = ['README.md', 'packages/cms/themes/default/README.md'];
  const packages = path.join(root, 'packages');
  const entries = fs.existsSync(packages) ? fs.readdirSync(packages, { withFileTypes: true }) : [];
  for (const entry of entries) {
    const readme = path.join('packages', entry.name, 'README.md');
    if (entry.isDirectory() && fs.existsSync(path.join(root, readme))) files.push(readme);
  }
  const docs = path.join(root, 'docs');
  if (fs.existsSync(docs)) {
    for (const file of fs.readdirSync(docs, { recursive: true, encoding: 'utf8' })) {
      if (file.endsWith('.md')) files.push(path.join('docs', file));
    }
  }
  return files.filter((file) => fs.existsSync(path.join(root, file))).sort();
}

/** The package folder a README ships to npm from, when it is one. */
function shippedFrom(file: string): string | undefined {
  return /^(packages\/[^/]+)\//.exec(file.split(path.sep).join('/'))?.[1];
}

export function checkDocLinks(root: string, files: readonly string[]): Problem[] {
  const anchorCache = new Map<string, Set<string>>();
  const anchors = (file: string): Set<string> => {
    let found = anchorCache.get(file);
    if (found === undefined) {
      found = anchorsOf(fs.readFileSync(file, 'utf8'));
      anchorCache.set(file, found);
    }
    return found;
  };

  const problems: Problem[] = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const markdown = fs.readFileSync(absolute, 'utf8');
    for (const reference of undefinedReferences(markdown)) {
      problems.push({
        file,
        line: reference.line,
        message: `${reference.target}: no reference definition in this file`,
      });
    }
    for (const link of linksOf(markdown)) {
      const report = (message: string): void => {
        problems.push({ file, line: link.line, message: `${link.target}: ${message}` });
      };

      let target = link.target;
      let base = path.dirname(absolute);
      if (target === REPOSITORY || target === `${REPOSITORY}#readme`) {
        target = 'README.md';
        base = root;
      } else if (target.startsWith(`${REPOSITORY}#`)) {
        target = `README.md${target.slice(REPOSITORY.length)}`;
        base = root;
      } else if (/^https:\/\/github\.com\/geekitycom\/cms\/(?:blob|tree)\/main\//.test(target)) {
        target = target.replace(
          /^https:\/\/github\.com\/geekitycom\/cms\/(?:blob|tree)\/main\//,
          '',
        );
        base = root;
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
        continue;
      }

      const hash = target.indexOf('#');
      const pathPart = decodeURI(hash === -1 ? target : target.slice(0, hash)).replace(/\?.*$/, '');
      const anchor = hash === -1 ? undefined : decodeURIComponent(target.slice(hash + 1));
      const resolved = pathPart === '' ? absolute : path.resolve(base, pathPart);

      const shipped = shippedFrom(file);
      if (shipped !== undefined && base !== root) {
        const inside = path.relative(path.join(root, shipped), resolved);
        if (inside.startsWith('..')) {
          report(
            `this README ships to npm, so link outside ${shipped} as ${REPOSITORY}/blob/main/...`,
          );
          continue;
        }
      }
      if (!fs.existsSync(resolved)) {
        report(`no such file ${path.relative(root, resolved)}`);
        continue;
      }
      if (anchor === undefined || !resolved.endsWith('.md')) continue;
      if (!anchors(resolved).has(anchor)) {
        report(`no heading in ${path.relative(root, resolved)} has the anchor #${anchor}`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, '..');
  const files = docFiles(root);
  const problems = checkDocLinks(root, files);
  for (const problem of problems) {
    console.error(`${problem.file}:${String(problem.line)}: ${problem.message}`);
  }
  if (problems.length > 0) {
    console.error(`${String(problems.length)} broken link(s) in ${String(files.length)} files`);
    process.exit(1);
  }
  console.log(`Every link resolves in ${String(files.length)} Markdown files`);
}
