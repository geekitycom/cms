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

export type ThemeRender = (template: string, context?: Record<string, unknown>) => string;

export interface ThemeEnvironment {
  readonly environment: Environment;
  readonly render: ThemeRender;
}

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
    ...(site['llmsTxt'] === false ? {} : { llmsTxt: LLMS_TXT_PATH }),
  };
}

function chromeContext(
  site: SiteData,
  context: Record<string, unknown>,
  icons: readonly SiteIcon[],
  siteOwner: AuthorContext | undefined,
): Record<string, unknown> {
  const headerIcon = site['headerIcon'] === true ? svgElseTouchIconHref(icons) : undefined;
  const owner = context['siteAuthor'] === undefined ? siteOwner : undefined;
  return {
    menus: navigationMenus({ site, url: currentUrl(context) }),
    ...(headerIcon === undefined ? {} : { headerIcon }),
    ...(owner === undefined ? {} : { siteAuthor: owner }),
    ...(siteOwner === undefined ? {} : { soloAuthor: siteOwner }),
  };
}

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
