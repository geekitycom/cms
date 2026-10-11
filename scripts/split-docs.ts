/**
 * Split the three long READMEs into `docs/`, one topic per file.
 *
 * The sources are read from git at SOURCE_REF, the last commit before the
 * split, so the script gives the same output however the READMEs read now.
 * PAGES is the mapping: which README section goes to which page, in what
 * order. Every `##` section of every source is either in PAGES or in DROPPED,
 * and the script refuses to run otherwise.
 *
 * Each moved section keeps its text. Headings shift so that a page has one
 * `#`, and every link is rewritten: an `#anchor` into any of the three READMEs
 * points at the page and heading the section now lives under, and a relative
 * link to code resolves from the page's new folder.
 *
 * Where the root README and the package README both had a section, both copies
 * are placed side by side; merging them is done by hand afterwards. To see
 * exactly what the hand merges changed, write the split somewhere else, format
 * it, and diff it against `docs/`:
 *
 *   node scripts/split-docs.ts --out /tmp/split
 *   npx prettier --write /tmp/split
 *   diff -r /tmp/split docs
 *
 * Usage (from the repository root):
 *
 *   node scripts/split-docs.ts [--out docs]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { slug } from './check-doc-links.ts';

const SOURCE_REF = '9284aac';

const SOURCES = {
  root: 'README.md',
  cms: 'packages/cms/README.md',
  theme: 'packages/cms/themes/default/README.md',
} as const;
type Source = keyof typeof SOURCES;

interface Piece {
  readonly from: Source;
  /** The heading path from the `##` down, joined with ` > `; `''` is the text before the first `##`. */
  readonly section: string;
}

interface Page {
  readonly file: string;
  readonly group: string;
  readonly summary: string;
  /** The page's `#`. Without one, the first piece's heading becomes it. */
  readonly title?: string;
  readonly pieces: readonly Piece[];
}

const root = (section: string): Piece => ({ from: 'root', section });
const cms = (section: string): Piece => ({ from: 'cms', section });
const theme = (section: string): Piece => ({ from: 'theme', section });

export const GROUPS = [
  'Use it',
  'Write content',
  'Run the site',
  'Federate and converse',
  'Extend and theme',
  'Contribute',
] as const;

export const PAGES: readonly Page[] = [
  {
    file: 'getting-started.md',
    group: 'Use it',
    summary: 'Create a site, add the package to a project, and upgrade it.',
    title: 'Getting started',
    pieces: [cms('A new site'), cms('An existing project'), cms('Upgrading')],
  },
  {
    file: 'cli.md',
    group: 'Use it',
    summary: 'What each `geekity` command does, and how `geekity serve` reloads.',
    pieces: [cms('The `geekity` command')],
  },
  {
    file: 'configuration.md',
    group: 'Use it',
    summary: 'Every config field and environment variable, `createCms`, and the access log.',
    title: 'Configuration',
    pieces: [
      cms('Configuration'),
      root('Configuration'),
      cms('Using the package from an entry file'),
      root('Using the package'),
      cms('The access log'),
      root('The public site > The access log'),
    ],
  },
  {
    file: 'content.md',
    group: 'Write content',
    summary:
      'Documents on disk, the two directories, the index, dates, scheduling and unlisted posts.',
    title: 'Content',
    pieces: [
      root('Content'),
      root('Two directories: `content/` and `data/`'),
      cms('Two directories: `content/` and `data/`'),
      root('The content index'),
      root('Keeping the index in step'),
      cms('Keeping the index in step'),
      cms('Dates and the timezone setting'),
      cms('Scheduling'),
      cms('Unlisted posts'),
      cms('The archive page'),
    ],
  },
  {
    file: 'admin.md',
    group: 'Write content',
    summary: 'The admin screens, the editor, users, menus, and tags and categories.',
    title: 'The admin',
    pieces: [
      cms('The admin'),
      root('The admin editor'),
      root('Users'),
      root('Navigation'),
      cms('The public site > Navigation'),
      root('Tags and categories'),
      cms('The admin > Managing tags and categories'),
    ],
  },
  {
    file: 'settings.md',
    group: 'Write content',
    summary: 'The settings pages, `site.json`, and what the front page shows.',
    title: 'Site settings',
    pieces: [root('Site settings'), cms('The admin > Settings'), cms('The admin > The front page')],
  },
  {
    file: 'media.md',
    group: 'Write content',
    summary: 'The media library, alt text, stripped metadata and image variants.',
    title: 'Media',
    pieces: [
      root('The media library'),
      cms('The admin > The media library'),
      root('Image optimization'),
      cms('The admin > Image variants'),
    ],
  },
  {
    file: 'public-site.md',
    group: 'Run the site',
    summary:
      'Routes, redirects, health and maintenance, content negotiation, sitemap, llms.txt, IndexNow and compression.',
    title: 'The public site',
    pieces: [
      root('The public site'),
      cms('The public site'),
      cms('Content negotiation'),
      cms('Sitemap and robots.txt'),
      cms('llms.txt'),
      cms('IndexNow'),
      cms('The admin > Compression'),
    ],
  },
  {
    file: 'security.md',
    group: 'Run the site',
    summary: 'Login and session hardening, password recovery, security headers and security.txt.',
    title: 'Security',
    pieces: [
      cms('The admin > Login hardening'),
      root('The admin editor > Login hardening and security headers'),
      cms('The admin > Session hardening'),
      cms('The admin > Forgotten passwords'),
      cms('The admin > Security headers'),
      cms('The admin > security.txt and change-password'),
    ],
  },
  {
    file: 'deploying.md',
    group: 'Run the site',
    summary:
      'Run the Docker image behind a proxy, back it up, upgrade it, and hold it in dev mode.',
    title: 'Deploying',
    pieces: [root('Deploying with Docker'), cms('Dev mode')],
  },
  {
    file: 'email.md',
    group: 'Run the site',
    summary: 'How the site sends mail, through Brevo or SMTP, and what it sends.',
    pieces: [cms('Email')],
  },
  {
    file: 'personal-data.md',
    group: 'Run the site',
    summary: 'Every piece of personal data the site keeps, how long, and how to erase it.',
    pieces: [cms('Personal data'), root('Two directories: `content/` and `data/` > Personal data')],
  },
  {
    file: 'federation.md',
    group: 'Federate and converse',
    summary: 'ActivityPub delivery, replies, quotes, relays, profiles, and moving from WordPress.',
    pieces: [cms('Federation')],
  },
  {
    file: 'feeds.md',
    group: 'Federate and converse',
    summary: 'RSS, Atom and JSON Feed, comment feeds, podcasts and real-time notification.',
    pieces: [cms('Feeds')],
  },
  {
    file: 'comments.md',
    group: 'Federate and converse',
    summary: 'Comments, moderation, notices and Akismet, and the contact form.',
    title: 'Comments and the contact form',
    pieces: [cms('Comments'), cms('The contact form')],
  },
  {
    file: 'webmentions.md',
    group: 'Federate and converse',
    summary: 'Sending and receiving webmentions, and syndication targets.',
    pieces: [cms('Webmentions')],
  },
  {
    file: 'indieweb-sign-in.md',
    group: 'Federate and converse',
    summary: 'Sign in to IndieAuth apps with your own site, and manage the apps.',
    pieces: [root('Signing in with your own site')],
  },
  {
    file: 'micropub.md',
    group: 'Federate and converse',
    summary: 'Post, edit and upload from a Micropub app.',
    pieces: [root('Micropub')],
  },
  {
    file: 'plugins.md',
    group: 'Extend and theme',
    summary: 'Install, write and bundle plugins, and run code of your own on a change.',
    title: 'Plugins and hooks',
    pieces: [root('Plugins'), cms('Hooks')],
  },
  {
    file: 'themes.md',
    group: 'Extend and theme',
    summary: 'How themes are chosen and looked up, and how a site theme overrides the default.',
    title: 'Themes',
    pieces: [root('The theme'), cms('Theme overrides')],
  },
  {
    file: 'theme/README.md',
    group: 'Extend and theme',
    summary: 'Its files, templates, context and filters.',
    title: 'The default theme',
    pieces: [theme('')],
  },
  ...(
    [
      ['manifest.md', 'The manifest', 'The `theme.json` that makes a folder a theme.'],
      [
        'overriding-a-template.md',
        'Overriding a template',
        'Replace one template and keep the rest.',
      ],
      [
        'adding-to-every-page.md',
        'Adding to every page',
        'The head-end and body-end partials, analytics and scripts.',
      ],
      [
        'page-shell.md',
        'The page shell',
        'The base layout, entries, listings, the head, colours, code and video.',
      ],
      [
        'mail-templates.md',
        'Mail templates',
        'The messages the site sends, and how to override them.',
      ],
      ['template-context.md', 'Template context', 'Every key a template is handed.'],
      ['bylines.md', 'Bylines and author archives', 'Who an entry is by, and the author pages.'],
      ['navigation.md', 'Navigation', 'Menu areas and how the theme prints them.'],
      ['feeds.md', 'Feeds', 'The feed links a theme prints.'],
      ['conversation.md', 'The conversation', 'Replies, likes and boosts under a post.'],
      ['comment-form.md', 'The comment form', 'The form, its refusals, and a signed-in commenter.'],
      ['contact-form.md', 'The contact form', 'The form on a page that asks for one.'],
      ['taxonomy-macros.md', 'Taxonomy macros', 'The tag and category link macros.'],
      ['filters.md', 'Filters', 'Every filter a template can use.'],
    ] as const
  ).map(([file, section, summary]): Page => ({
    file: `theme/${file}`,
    group: 'Extend and theme',
    summary,
    pieces: [theme(section)],
  })),
  {
    file: 'eleventy.md',
    group: 'Extend and theme',
    summary: 'The example config, what carries over, and the test that keeps the URLs equal.',
    pieces: [cms('Building the same content with Eleventy')],
  },
  {
    file: 'development.md',
    group: 'Contribute',
    summary: 'The workspace, its commands and gates, CI and releasing.',
    title: 'Developing Geekity CMS',
    pieces: [
      root('Workspace layout'),
      root('Requirements'),
      root('Commands'),
      root('Quality gates'),
      root('Continuous integration'),
      root('Releasing'),
    ],
  },
];

/** Sections that stay in the READMEs, which are rewritten by hand. */
const DROPPED: readonly Piece[] = [root(''), root('License'), cms(''), cms('License')];

interface Section {
  readonly from: Source;
  readonly path: string;
  readonly level: number;
  readonly anchor: string;
  readonly lines: readonly string[];
  readonly children: Section[];
}

function fenceOpener(line: string): string | undefined {
  return /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
}

/** Each line of `markdown`, and whether it is inside a fenced code block. */
function lineKinds(markdown: string): { line: string; code: boolean }[] {
  let fence: string | undefined;
  return markdown.split('\n').map((line) => {
    const opener = fenceOpener(line);
    if (fence !== undefined) {
      if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length) {
        fence = undefined;
      }
      return { line, code: true };
    }
    if (opener !== undefined) fence = opener;
    return { line, code: opener !== undefined };
  });
}

function headingOf(line: string): { level: number; text: string } | undefined {
  const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
  return match === null ? undefined : { level: match[1]?.length ?? 0, text: match[2] ?? '' };
}

/** The source as a tree of sections; the root is the text before the first `##`. */
function parse(from: Source, markdown: string): Section {
  const top: Section = { from, path: '', level: 1, anchor: '', lines: [], children: [] };
  const stack: Section[] = [top];
  const seen = new Map<string, number>();
  for (const { line, code } of lineKinds(markdown)) {
    const heading = code ? undefined : headingOf(line);
    if (heading?.level === 1) continue;
    if (heading === undefined) {
      (stack.at(-1)?.lines as string[]).push(line);
      continue;
    }
    while ((stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    const parent = stack.at(-1) ?? top;
    const base = slug(heading.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const section: Section = {
      from,
      path: parent.path === '' ? heading.text : `${parent.path} > ${heading.text}`,
      level: heading.level,
      anchor: count === 0 ? base : `${base}-${String(count)}`,
      lines: [line],
      children: [],
    };
    parent.children.push(section);
    stack.push(section);
  }
  return top;
}

function walk(section: Section, visit: (section: Section) => void): void {
  visit(section);
  for (const child of section.children) walk(child, visit);
}

function main(argv: readonly string[]): void {
  const repo = path.resolve(import.meta.dirname, '..');
  const outFlag = argv.indexOf('--out');
  const out = path.resolve(repo, outFlag === -1 ? 'docs' : (argv[outFlag + 1] ?? 'docs'));

  const trees = Object.fromEntries(
    (Object.keys(SOURCES) as Source[]).map((from) => [
      from,
      parse(
        from,
        execFileSync('git', ['show', `${SOURCE_REF}:${SOURCES[from]}`], {
          cwd: repo,
          encoding: 'utf8',
        }),
      ),
    ]),
  ) as Record<Source, Section>;

  const find = (piece: Piece): Section => {
    let found: Section | undefined;
    walk(trees[piece.from], (section) => {
      if (section.path === piece.section) found = section;
    });
    if (found === undefined) throw new Error(`${piece.from}: no section "${piece.section}"`);
    return found;
  };

  const claimed = new Map<Section, string>();
  for (const page of PAGES) for (const piece of page.pieces) claimed.set(find(piece), page.file);
  for (const piece of DROPPED) claimed.set(find(piece), '');

  const unplaced: string[] = [];
  for (const tree of Object.values(trees)) {
    for (const section of tree.children) {
      let covered = false;
      walk(section, (inner) => {
        if (claimed.has(inner)) covered = true;
      });
      if (!covered) unplaced.push(`${section.from}: ${section.path}`);
    }
  }
  if (unplaced.length > 0) throw new Error(`sections in no page:\n  ${unplaced.join('\n  ')}`);

  interface Placed {
    readonly section: Section;
    readonly shift: number;
  }
  const placedOn = new Map<string, Placed[]>();
  const anchorMap = new Map<string, { file: string; anchor: string }>();

  for (const page of PAGES) {
    const placed: Placed[] = [];
    page.pieces.forEach((piece, index) => {
      const top = find(piece);
      const promote = page.title === undefined && index === 0;
      const shift = top.path === '' ? 0 : (promote ? 1 : 2) - top.level;
      const emit = (section: Section): void => {
        placed.push({ section, shift });
        for (const child of section.children) if (!claimed.has(child)) emit(child);
      };
      emit(top);
    });
    placedOn.set(page.file, placed);

    const seen = new Map<string, number>();
    if (page.title !== undefined) seen.set(slug(page.title), 1);
    for (const { section, shift } of placed) {
      if (section.path === '') continue;
      if (section.level + shift === 1) {
        anchorMap.set(`${section.from}#${section.anchor}`, { file: page.file, anchor: '' });
        seen.set(slug(headingOf(section.lines[0] ?? '')?.text ?? ''), 1);
        continue;
      }
      const text = headingOf(section.lines[0] ?? '')?.text ?? '';
      const base = slug(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchorMap.set(`${section.from}#${section.anchor}`, {
        file: page.file,
        anchor: count === 0 ? base : `${base}-${String(count)}`,
      });
    }
  }
  const sourceOfPath = (repoPath: string): Source | undefined =>
    (Object.keys(SOURCES) as Source[]).find((from) => SOURCES[from] === repoPath);

  const unresolved: string[] = [];
  const rewrite = (target: string, from: Source, page: string): string => {
    let repoPath: string;
    let anchor: string | undefined;
    const github =
      /^https:\/\/github\.com\/geekitycom\/cms(?:\/(?:blob|tree)\/main\/([^#]*))?(?:#(.*))?$/.exec(
        target,
      );
    if (github !== null) {
      repoPath = github[1] ?? 'README.md';
      anchor = github[2] === 'readme' ? undefined : github[2];
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      return target;
    } else {
      const hash = target.indexOf('#');
      const file = hash === -1 ? target : target.slice(0, hash);
      anchor = hash === -1 ? undefined : target.slice(hash + 1);
      repoPath =
        file === ''
          ? SOURCES[from]
          : path.posix.normalize(path.posix.join(path.posix.dirname(SOURCES[from]), file));
    }
    const fromPage = path.posix.dirname(path.posix.join('docs', page));
    const relative = (to: string): string => {
      const link = path.posix.relative(fromPage, to);
      return link === '' ? path.posix.basename(to) : link;
    };

    const source = sourceOfPath(repoPath);
    if (source === undefined) {
      return relative(repoPath) + (anchor === undefined ? '' : `#${anchor}`);
    }
    if (anchor === undefined) {
      return relative(source === 'theme' ? 'docs/theme/README.md' : SOURCES[source]);
    }
    const moved = anchorMap.get(`${source}#${anchor}`);
    if (moved === undefined) {
      unresolved.push(`${page}: ${target}`);
      return target;
    }
    const fragment = moved.anchor === '' ? '' : `#${moved.anchor}`;
    return moved.file === page && fragment !== ''
      ? fragment
      : relative(`docs/${moved.file}`) + fragment;
  };

  const rewriteLine = (line: string, from: Source, page: string): string => {
    const blanked = line.replace(/(`+)(?:(?!\1).)+?\1/g, (span) => ' '.repeat(span.length));
    const edits: { start: number; end: number; text: string }[] = [];
    for (const match of blanked.matchAll(/\]\(\s*([^)\s]+)/g)) {
      const start = (match.index ?? 0) + match[0].length - (match[1]?.length ?? 0);
      edits.push({ start, end: start + (match[1]?.length ?? 0), text: match[1] ?? '' });
    }
    const definition = /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/.exec(blanked);
    if (definition !== null) {
      const start = definition[1]?.length ?? 0;
      edits.push({ start, end: start + (definition[2]?.length ?? 0), text: definition[2] ?? '' });
    }
    let result = line;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      const original = line.slice(edit.start, edit.end);
      result = result.slice(0, edit.start) + rewrite(original, from, page) + result.slice(edit.end);
    }
    return result;
  };

  fs.mkdirSync(path.join(out, 'theme'), { recursive: true });
  for (const page of PAGES) {
    const body: string[] = [];
    if (page.title !== undefined) body.push(`# ${page.title}`, '');
    for (const { section, shift } of placedOn.get(page.file) ?? []) {
      lineKinds(section.lines.join('\n')).forEach(({ line, code }, index) => {
        if (code) {
          body.push(line);
          return;
        }
        const heading = headingOf(line);
        if (index === 0 && heading !== undefined && section.path !== '') {
          body.push(
            `${'#'.repeat(heading.level + shift)} ${rewriteLine(heading.text, section.from, page.file)}`,
          );
          return;
        }
        body.push(rewriteLine(line, section.from, page.file));
      });
    }
    if (page.file === 'theme/README.md')
      body.push(
        '',
        ...index(
          PAGES.filter((p) => p.file.startsWith('theme/') && p.file !== page.file),
          'theme/',
        ),
      );
    const text = `${body
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()}\n`;
    fs.writeFileSync(path.join(out, page.file), text);
  }
  fs.writeFileSync(path.join(out, 'README.md'), docsIndex());

  if (unresolved.length > 0) {
    throw new Error(`links into sections that moved nowhere:\n  ${unresolved.join('\n  ')}`);
  }
  console.log(`Wrote ${String(PAGES.length + 1)} pages to ${path.relative(repo, out) || '.'}`);
}

function titleOf(page: Page): string {
  return page.title ?? page.pieces[0]?.section.split(' > ').at(-1) ?? page.file;
}

function index(pages: readonly Page[], prefix: string): string[] {
  return [
    '## Contents',
    '',
    ...pages.map(
      (page) => `- [${titleOf(page)}](${page.file.slice(prefix.length)}). ${page.summary}`,
    ),
  ];
}

function docsIndex(): string {
  const lines = [
    '# Geekity CMS documentation',
    '',
    'Each page covers one topic. The [root README](../README.md) says what the',
    'CMS is and how to start a site.',
  ];
  for (const group of GROUPS) {
    lines.push('', `## ${group}`, '');
    for (const page of PAGES.filter(
      (p) => p.group === group && !/^theme\/(?!README)/.test(p.file),
    )) {
      lines.push(`- [${titleOf(page)}](${page.file}). ${page.summary}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) main(process.argv.slice(2));
