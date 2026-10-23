import type { HostLookup } from '../../util/public-address.ts';
import { css2Url } from '../family.ts';
import type { FontStyle } from '../family.ts';

export const REGULAR: FontStyle = { weight: 400, italic: false };
export const ITALIC: FontStyle = { weight: 400, italic: true };
export const BOLD: FontStyle = { weight: 700, italic: false };
export const BODY: readonly FontStyle[] = [BOLD, ITALIC, REGULAR];

export const FAMILY = 'Atkinson Hyperlegible';
const GSTATIC = 'https://fonts.gstatic.com/s/atkinsonhyperlegible/v11';
const SUBSETS = ['latin-ext', 'latin'];

export const googleLookup: HostLookup = (hostname) => {
  if (hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com') {
    return Promise.resolve(['142.250.0.1']);
  }
  if (hostname === 'elsewhere.example') return Promise.resolve(['203.0.113.9']);
  return Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`));
};

export function woff2(seed: string): Uint8Array {
  return Buffer.concat([Buffer.from('wOF2'), Buffer.from(`font bytes for ${seed}`)]);
}

export function face(style: FontStyle, subset: string, url: string, family = FAMILY): string {
  return [
    `/* ${subset} */`,
    '@font-face {',
    `  font-family: '${family}';`,
    `  font-style: ${style.italic ? 'italic' : 'normal'};`,
    `  font-weight: ${String(style.weight)};`,
    '  font-display: swap;',
    `  src: url(${url}) format('woff2');`,
    subset === 'latin'
      ? '  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+FEFF, U+FFFD;'
      : '  unicode-range: U+0100-02BA, U+02BD-02C5, U+1E00-1E9F;',
    '}',
  ].join('\n');
}

function fileUrl(style: FontStyle, subset: string): string {
  return `${GSTATIC}/${style.italic ? 'i' : 'n'}${String(style.weight)}-${subset}.woff2`;
}

function combinations(styles: readonly FontStyle[]): FontStyle[][] {
  const [first, ...rest] = styles;
  if (first === undefined) return [[]];
  return combinations(rest).flatMap((others) => [others, [first, ...others]]);
}

export interface StubbedGoogle {
  readonly requested: { url: string; userAgent: string | null }[];
  web: Record<string, () => Response>;
  serveFamily(styles: readonly FontStyle[], family?: string): void;
  reset(): void;
  restore(): void;
}

export function stubGoogle(): StubbedGoogle {
  const original = globalThis.fetch;
  const stub: StubbedGoogle = {
    requested: [],
    web: {},
    serveFamily(styles, family = FAMILY) {
      for (const style of styles) {
        for (const subset of SUBSETS) {
          const url = fileUrl(style, subset);
          stub.web[url] = () =>
            new Response(woff2(url), { headers: { 'content-type': 'font/woff2' } });
        }
      }
      for (const wanted of combinations(styles)) {
        const served =
          wanted.length > 0
            ? wanted
            : styles.filter((style) => style.weight === 400 && !style.italic);
        if (served.length === 0) continue;
        const css = served
          .flatMap((style) =>
            SUBSETS.map((subset) => face(style, subset, fileUrl(style, subset), family)),
          )
          .join('\n');
        stub.web[css2Url(family, wanted)] = () =>
          new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8' } });
      }
    },
    reset() {
      stub.requested.length = 0;
      stub.web = {};
    },
    restore() {
      globalThis.fetch = original;
    },
  };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    stub.requested.push({ url: request.url, userAgent: request.headers.get('user-agent') });
    return Promise.resolve(
      stub.web[request.url]?.() ?? new Response('Bad Request', { status: 400 }),
    );
  }) as typeof fetch;
  return stub;
}
