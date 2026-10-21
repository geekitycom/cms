import type { PluginWidget } from '@geekity/cms/plugin';

import type { UmamiClient } from './client.ts';
import { lastDays } from './period.ts';

const LISTED = 5;

const BROWSERS: Readonly<Record<string, string>> = {
  android: 'Android',
  aol: 'AOL',
  bb10: 'BlackBerry 10',
  beaker: 'Beaker',
  chrome: 'Chrome',
  'chromium-webview': 'Chrome (webview)',
  crios: 'Chrome (iOS)',
  curl: 'Curl',
  edge: 'Edge',
  'edge-chromium': 'Edge (Chromium)',
  'edge-ios': 'Edge (iOS)',
  facebook: 'Facebook',
  firefox: 'Firefox',
  fxios: 'Firefox (iOS)',
  ie: 'IE',
  instagram: 'Instagram',
  ios: 'iOS',
  'ios-webview': 'iOS (webview)',
  kakaotalk: 'KakaoTalk',
  miui: 'MIUI',
  opera: 'Opera',
  'opera-mini': 'Opera Mini',
  phantomjs: 'PhantomJS',
  safari: 'Safari',
  samsung: 'Samsung',
  searchbot: 'Searchbot',
  silk: 'Silk',
  yandexbrowser: 'Yandex',
};

const DEVICES: Readonly<Record<string, string>> = {
  desktop: 'Desktop',
  laptop: 'Laptop',
  mobile: 'Mobile',
  tablet: 'Tablet',
};

const regions = new Intl.DisplayNames('en', { type: 'region', fallback: 'code' });

function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

const AUDIENCE = {
  country: { id: 'countries', title: 'Umami: countries', label: countryName },
  browser: { id: 'browsers', title: 'Umami: browsers', label: (value) => BROWSERS[value] ?? value },
  device: { id: 'devices', title: 'Umami: devices', label: (value) => DEVICES[value] ?? value },
} satisfies Record<string, { id: string; title: string; label: (value: string) => string }>;

export function audienceWidget(
  client: UmamiClient,
  type: keyof typeof AUDIENCE,
  now: () => Date = () => new Date(),
): PluginWidget {
  const { id, title, label } = AUDIENCE[type];
  return {
    id,
    title,
    width: 'half',
    refreshSeconds: 300,
    async load({ timezone, period, signal }) {
      if (!(await client.configured())) return [];
      const { range } = lastDays(now(), timezone, period);
      const [stats, top] = await Promise.all([
        client.stats(range, { signal }),
        client.metrics(type, range, { limit: LISTED, signal }),
      ]);
      const { visitors } = stats.current;
      if (visitors === 0 || top.length === 0) {
        return [{ paragraph: ['No visitors in this period.'] }];
      }
      return [
        {
          ranked: {
            caption: `Share of visitors per ${type} over the last ${String(period)} days`,
            format: 'percent',
            items: top.slice(0, LISTED).map((entry) => ({
              label: entry.value === '' ? 'Unknown' : label(entry.value),
              value: (entry.count / visitors) * 100,
            })),
          },
        },
      ];
    },
  };
}

export function visitorsNowWidget(client: UmamiClient): PluginWidget {
  return {
    id: 'visitors-now',
    title: 'Umami: visitors right now',
    width: 'half',
    refreshSeconds: 30,
    async load({ signal }) {
      if (!(await client.configured())) return [];
      return [
        { stats: [{ label: 'Visitors right now', value: await client.active({ signal }) }] },
        { paragraph: ['Umami counts the visitors seen on the site in the last 5 minutes.'] },
      ];
    },
  };
}
