import type { Environment } from 'nunjucks';

import { createTemplateEnvironment, useThemeDirs } from '../web/templates.ts';
import { findThemeFile } from '../web/themes.ts';
import type { ThemeSource } from '../web/themes.ts';

/**
 * What a message looks like before it is addressed: a subject, a plain text
 * body, and an HTML twin when the theme wrote one.
 *
 * Messages are Nunjucks templates under `mail/` in the theme, looked up the
 * way every other template is — the theme the site has chosen first, the theme
 * that ships in this package second, file by file. So a theme overrides the
 * text of one message and keeps the subject and the HTML the package ships,
 * and one that writes `mail/welcome.txt.njk` has a message the package never
 * had.
 *
 * Three files rather than one, because the three parts of a message have
 * nothing to do with each other: a subject is one line with no markup, a text
 * body is what most mail readers show, and the HTML twin is optional
 * throughout. A message with no `.html.njk` is sent as plain text, which is
 * the right thing rather than a missing feature.
 */

/** One rendered message, ready to be addressed and handed to a provider. */
export interface RenderedMail {
  /**
   * The subject, on one line. Empty when the message has no `.subject.njk`,
   * in which case the caller's own subject is what is sent.
   */
  readonly subject: string;
  /** The plain text body. Every message has one. */
  readonly text: string;
  /** The HTML twin, when the theme wrote one. */
  readonly html?: string | undefined;
}

/** The three templates one message is built from. */
export interface MailTemplateFiles {
  /** The subject line. Optional. */
  readonly subject: string;
  /** The plain text body. Required. */
  readonly text: string;
  /** The HTML twin. Optional. */
  readonly html: string;
}

/** Which files a named message is built from, relative to a theme directory. */
export function mailTemplateFiles(name: string): MailTemplateFiles {
  return {
    subject: `mail/${name}.subject.njk`,
    text: `mail/${name}.txt.njk`,
    html: `mail/${name}.html.njk`,
  };
}

/** What {@link createMailTemplates} needs. */
export interface CreateMailTemplatesOptions {
  /**
   * Which theme the messages are read from, asked per message.
   *
   * A source rather than a directory because mail is part of the theme
   * (decision-15): a site that changes theme changes the words its password
   * resets and moderation notices are written in, and the message after the
   * change should be the new theme's rather than the next boot's.
   */
  themes: ThemeSource;
  /** Public origin, for the `url` and `absoluteUrl` filters. */
  baseUrl: string;
  /**
   * Recompile a template on every render instead of caching it. On while the
   * content watcher is on, so editing a message in development shows up
   * without a restart, exactly as editing a layout does.
   */
  noCache?: boolean | undefined;
}

/** Turns a named message and some data into the three parts of an email. */
export interface MailTemplates {
  /**
   * Render one message.
   *
   * Throws when there is no `.txt.njk` for that name anywhere on the search
   * path — a message with no body is a mistake in the calling code, and
   * sending an empty one would hide it.
   */
  render(name: string, context?: Record<string, unknown>): RenderedMail;
  /**
   * The Nunjucks environment the HTML half renders through, for a site that
   * wants to add its own filters.
   */
  readonly environment: Environment;
  /**
   * The twin the subject and the text body render through: the same loader and
   * the same filters, with autoescaping off.
   *
   * A plain text body is not HTML. Escaping it turns the `&` between two query
   * parameters into `&amp;` — which is what a one-click moderation link is
   * made of (TASK-55) — and an apostrophe in somebody's name into `&#39;`. A
   * site adding a filter that both halves should have adds it to both.
   */
  readonly plainEnvironment: Environment;
}

/** Build the mail templates for one site. */
export function createMailTemplates(options: CreateMailTemplatesOptions): MailTemplates {
  // The same environment the theme is rendered through, so a message has the
  // same `date`, `url` and `absoluteUrl` filters a page does and a site does
  // not have to learn a second set of rules to write one.
  const environment = createTemplateEnvironment({
    themeDirs: options.themes.current().dirs,
    baseUrl: options.baseUrl,
    ...(options.noCache === undefined ? {} : { noCache: options.noCache }),
  });

  // The same again with autoescaping off, for the two halves of a message that
  // are not HTML. Built here rather than by unescaping afterwards, because
  // there is no way to tell an `&amp;` the template meant from one it did not.
  const plainEnvironment = createTemplateEnvironment({
    themeDirs: options.themes.current().dirs,
    baseUrl: options.baseUrl,
    autoescape: false,
    ...(options.noCache === undefined ? {} : { noCache: options.noCache }),
  });

  /**
   * The theme this message is being written in, with both environments pointed
   * at it.
   *
   * Asked per message rather than held, for the reason a page asks per render:
   * a theme chosen a minute ago is the one the next message should come from.
   * The directories it hands back are what `present` then asks about, so which
   * halves of a message exist is the same question as which file a render
   * would read.
   */
  function themeDirs(): readonly string[] {
    const dirs = options.themes.current().dirs;
    useThemeDirs(environment, dirs);
    useThemeDirs(plainEnvironment, dirs);
    return dirs;
  }

  return {
    environment,
    plainEnvironment,

    render(name, context = {}) {
      const files = mailTemplateFiles(name);
      const searchPath = themeDirs();

      /** Whether any theme on the search path has that template. */
      const present = (template: string): boolean =>
        findThemeFile(searchPath, template) !== undefined;

      if (!present(files.text)) {
        throw new Error(
          `There is no mail template ${files.text} in the site theme or in the packaged one.`,
        );
      }

      return {
        // A subject is a header, and a header is one line: whatever the
        // template did with whitespace, what goes out is a single line.
        subject: present(files.subject)
          ? plainEnvironment.render(files.subject, context).replace(/\s+/g, ' ').trim()
          : '',
        text: plainEnvironment.render(files.text, context),
        ...(present(files.html) ? { html: environment.render(files.html, context) } : {}),
      };
    },
  };
}
