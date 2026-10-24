import type { Environment } from 'nunjucks';

import type { ResolvedConfig } from '../config.ts';
import { resolveLicense } from '../content/license.ts';
import type { ContentLicense } from '../content/license.ts';
import type { PageFont } from '../fonts/index.ts';
import { iconSetting, siteIcons } from '../images/icons.ts';
import type { SiteIcon } from '../images/icons.ts';
import { siteAuthorContext } from '../site/authors.ts';
import type { AuthorContext } from '../site/authors.ts';
import { navigationMenus } from '../site/navigation.ts';
import { schemeTokens } from '../theme/scheme-tokens.ts';
import type { SchemeTokens } from '../theme/scheme-tokens.ts';
import { siteColors } from '../theme/site-data.ts';
import type { SiteColors, SiteData } from '../theme/site-data.ts';
import { createTemplateEnvironment, useThemeDirs } from '../theme/templates.ts';
import { findThemeFile } from '../theme/themes.ts';
import type { ChosenTheme } from '../theme/themes.ts';
import type { PhotoContext } from './context.ts';
import { LLMS_TXT_PATH } from './llms.ts';
import type { RenderDeps } from './render.ts';
import { pluginTagsContext, requestDevMode, requestSignedIn } from './render-scope.ts';
import { shareImage } from './share-image.ts';

/** Any template by name, with the site data already in the context. */
export type ThemeRender = (template: string, context?: Record<string, unknown>) => string;

export interface ThemeEnvironment {
  readonly environment: Environment;
  readonly render: ThemeRender;
}

/**
 * The HTML Nunjucks environment and the render every page of the theme goes
 * through, which puts on the context what every page carries.
 *
 * Templates are cached unless the content watcher is on, which is the same
 * switch as "this is a development server": with `watch: true` a template edit
 * shows up on the next request, exactly as a content edit does.
 */
export function createThemeEnvironment(deps: RenderDeps): ThemeEnvironment {
  const { config, siteData, themes, users, options } = deps;
  const environment = createTemplateEnvironment({
    themeDirs: themes.current().dirs,
    baseUrl: config.baseUrl,
    now: config.now,
    noCache: config.watch,
  });

  function render(template: string, context: Record<string, unknown> = {}): string {
    const site = siteData.read();
    // Before anything is looked up: a theme chosen on the Appearance screen, or
    // written into `site.json` by hand, decides this very render rather than
    // the next boot. It costs a comparison of two short arrays when nothing
    // has changed, which is every render of a site that is not being rethemed.
    const chosen = themes.current();
    useThemeDirs(environment, chosen.dirs);
    const siteOwner = siteAuthorContext(users(), site.author);
    const icons = siteIcons(config, iconSetting(site));
    const fonts = options.fonts?.(site, chosen.fonts) ?? [];
    return environment.render(template, {
      site,
      ...headContext(site, chosen, icons, fonts),
      ...chromeContext(site, context, icons, siteOwner),
      ...shareImageContext(config, site, context, siteOwner),
      ...context,
      ...licenseContext(site, context),
      devMode: requestDevMode(),
      signedIn: requestSignedIn(),
      pluginTags: pluginTagsContext(),
    });
  }

  return { environment, render };
}

/**
 * What a page's head links: the site's icons, its fonts, the theme's colours
 * and the index for language models.
 *
 * The icons are computed here rather than in the layout (TASK-81, TASK-147)
 * because only this side knows where a derived file is served and whether the
 * site can derive one at all: a theme that was handed the icon's path would
 * have to build the URL itself and would link 404s on a site with image
 * optimization off.
 */
function headContext(
  site: SiteData,
  chosen: ChosenTheme,
  icons: readonly SiteIcon[],
  fonts: readonly PageFont[],
): Record<string, unknown> {
  return {
    icons,
    ...(fonts.length === 0 ? {} : { fonts: pageFontsContext(fonts) }),
    theme: { ...chosen.colors, ...siteColors(site, chosen.schemes) },
    // Where the index for language models is (TASK-149), while the site
    // serves one, so a theme asks `{% if llmsTxt %}`.
    ...(site['llmsTxt'] === false ? {} : { llmsTxt: LLMS_TXT_PATH }),
  };
}

/**
 * What every page's header, menus and bio are drawn from.
 *
 * The menus are built here rather than by each caller because every page of
 * the site carries them: a listing, a document, the 404 and the editor's
 * preview all go through here, and a menu that appeared on some of them and
 * not others would be a worse contract than one that is simply always there.
 * It is `menus` rather than `menus` read off `site` because these items know
 * which one the reader is on; a template reading `site.menus` would be reading
 * the raw lists.
 *
 * Every menu the site stores is here, keyed by name, not only the ones the
 * theme declares an area for: a name nothing loops over is rendered nowhere
 * and kept (TASK-107), and the declaration in `theme.json` is for the screen
 * that edits menus rather than a filter on the render.
 *
 * Who the page is by, for the bio, the `rel="me"` links and the structured
 * data (decision-16), is the site's own author only when the page is about
 * nobody in particular: a document's byline and an author archive's person are
 * put on the context by the callers, and win by going on last.
 */
function chromeContext(
  site: SiteData,
  context: Record<string, unknown>,
  icons: readonly SiteIcon[],
  siteOwner: AuthorContext | undefined,
): Record<string, unknown> {
  // The icon a header prints before the title, when the site asks for one
  // (TASK-486): the SVG itself if it is one, which is sharp at any size.
  const headerIcon = site['headerIcon'] === true ? svgElseTouchIconHref(icons) : undefined;
  const owner = context['siteAuthor'] === undefined ? siteOwner : undefined;
  return {
    menus: navigationMenus({ site, url: currentUrl(context) }),
    ...(headerIcon === undefined ? {} : { headerIcon }),
    ...(owner === undefined ? {} : { siteAuthor: owner }),
    // Who the homepage speaks for, on a site whose author is a user (TASK-180,
    // TASK-192): the bio on the homepage and the `rel="me"` claims between
    // it and their archive. Every page carries it, because the archive is
    // where the claim back is printed. A site with several authors has none.
    ...(siteOwner === undefined ? {} : { soloAuthor: siteOwner }),
  };
}

/**
 * The picture a shared link shows (TASK-146), here for the reason the icons
 * are: its alt text and its size are in files only this side reads.
 */
function shareImageContext(
  config: ResolvedConfig,
  site: SiteData,
  context: Record<string, unknown>,
  siteOwner: AuthorContext | undefined,
): Record<string, unknown> {
  const title = [context['title'], context['label']].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  const by = (context['siteAuthor'] ?? siteOwner) as AuthorContext | undefined;
  // A photo post is shown by its first photo (TASK-166).
  const [photo] = (context['photos'] ?? []) as readonly PhotoContext[];
  const image = shareImage({
    config,
    image: context['image'],
    imageAlt: context['imageAlt'],
    title: title ?? site.title,
    fallbacks: [
      ...(photo === undefined
        ? []
        : [{ url: photo.url, describedAs: photo.alt || (title ?? site.title) }]),
      { url: site.avatar, describedAs: siteOwner?.name ?? site.title },
      { url: by?.avatar, describedAs: by?.name ?? site.title },
      { url: iconSetting(site), describedAs: site.title },
    ],
  });
  return image === undefined ? {} : { shareImage: image };
}

/**
 * The scheme and mode the site draws its pages in right now, with the scheme's
 * colour tokens from the theme's stylesheet, as {@link Renderer.siteColors}
 * says.
 */
export function siteColorsWithTokens(
  deps: Pick<RenderDeps, 'siteData' | 'themes'>,
): (SiteColors & { readonly tokens: SchemeTokens }) | undefined {
  const chosen = deps.themes.current();
  const colors = siteColors(deps.siteData.read(), chosen.schemes);
  if (colors === undefined) return undefined;
  const stylesheet = findThemeFile(chosen.dirs, 'static/style.css');
  const tokens =
    stylesheet === undefined
      ? { light: new Map<string, string>(), dark: new Map<string, string>() }
      : schemeTokens(stylesheet, colors.scheme.name);
  return { ...colors, tokens };
}

function pageFontsContext(fonts: readonly PageFont[]): {
  stylesheets: string[];
  properties: { property: string; value: string }[];
} {
  return {
    stylesheets: [...new Set(fonts.map((font) => font.href))],
    properties: fonts.map((font) => ({ property: font.font.property, value: font.value })),
  };
}

function svgElseTouchIconHref(icons: readonly SiteIcon[]): string | undefined {
  return (
    icons.find((icon) => icon.type === 'image/svg+xml') ??
    icons.find((icon) => icon.rel === 'apple-touch-icon')
  )?.href;
}

/**
 * The path a render is of, for marking the current menu item.
 *
 * Read off `page.url` and then `url`, the two names every caller here already
 * sets, so nothing has to pass the path a third time. A template rendered with
 * neither — a site calling `render` for a fragment of its own — is treated as
 * the home page's, which marks nothing that a page of the site would not.
 */
function currentUrl(context: Record<string, unknown>): string {
  const page = context['page'];
  if (typeof page === 'object' && page !== null) {
    const url = (page as Record<string, unknown>)['url'];
    if (typeof url === 'string') return url;
  }
  return typeof context['url'] === 'string' ? context['url'] : '/';
}

function licenseContext(
  site: SiteData,
  context: Record<string, unknown>,
): { license: ContentLicense | undefined; siteLicense: ContentLicense | undefined } {
  return { license: resolveLicense(site, context), siteLicense: resolveLicense(site) };
}
