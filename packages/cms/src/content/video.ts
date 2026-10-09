export type Video =
  | { provider: 'youtube'; id: string; start?: number }
  | { provider: 'vimeo'; id: string; hash?: string };

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_PATH = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/;
const YOUTUBE_TIME = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/;

const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com'];
const VIMEO_PATH = /^\/(?:channels\/[\w-]+\/)?(\d+)(?:\/([\da-f]+))?\/?$/;
const VIMEO_PLAYER_PATH = /^\/video\/(\d+)\/?$/;
const VIMEO_HASH = /^[\da-f]+$/;

export function videoOf(href: string): Video | undefined {
  const url = URL.canParse(href) ? new URL(href) : undefined;
  if (url === undefined || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    return undefined;
  return youtubeOf(url) ?? vimeoOf(url);
}

function youtubeOf(url: URL): Video | undefined {
  const id = youtubeIdOf(url);
  if (id === undefined || !YOUTUBE_ID.test(id)) return undefined;
  const start = secondsOf(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return { provider: 'youtube', id, ...(start === undefined ? {} : { start }) };
}

function youtubeIdOf(url: URL): string | undefined {
  if (url.hostname === 'youtu.be') return url.pathname.slice(1).replace(/\/$/, '');
  if (url.hostname === 'www.youtube-nocookie.com') {
    return /^\/embed\/([^/]+)$/.exec(url.pathname)?.[1];
  }
  if (!YOUTUBE_HOSTS.includes(url.hostname)) return undefined;
  if (url.pathname === '/watch') return url.searchParams.get('v') ?? undefined;
  return YOUTUBE_PATH.exec(url.pathname)?.[1];
}

function secondsOf(value: string | null): number | undefined {
  const match = value === null ? null : YOUTUBE_TIME.exec(value);
  if (match === null) return undefined;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return total > 0 ? total : undefined;
}

function vimeoOf(url: URL): Video | undefined {
  if (url.hostname === 'player.vimeo.com') {
    const id = VIMEO_PLAYER_PATH.exec(url.pathname)?.[1];
    if (id === undefined) return undefined;
    const hash = url.searchParams.get('h');
    return { provider: 'vimeo', id, ...(hash !== null && VIMEO_HASH.test(hash) ? { hash } : {}) };
  }
  if (!VIMEO_HOSTS.includes(url.hostname)) return undefined;
  const match = VIMEO_PATH.exec(url.pathname);
  if (match === null) return undefined;
  const [, id = '', hash] = match;
  return { provider: 'vimeo', id, ...(hash === undefined ? {} : { hash }) };
}

/**
 * The player a recognised video URL renders as: the provider's own iframe in
 * its privacy-enhanced mode, with the URL as written linked beneath it, so a
 * feed reader or a fediverse server that drops the frame still has the video.
 */
export function videoEmbedHtml(video: Video, href: string): string {
  const { src, title } = playerOf(video);
  return [
    `<figure class="video-embed video-embed-${video.provider}">`,
    `<iframe src="${escapeHtml(src)}" width="560" height="315"`,
    ` title="${title}" loading="lazy"`,
    ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"',
    ' referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>',
    `<figcaption><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></figcaption>`,
    '</figure>',
  ].join('');
}

function playerOf(video: Video): { src: string; title: string } {
  switch (video.provider) {
    case 'youtube': {
      const start = video.start === undefined ? '' : `?start=${String(video.start)}`;
      return {
        src: `https://www.youtube-nocookie.com/embed/${video.id}${start}`,
        title: 'YouTube video',
      };
    }
    case 'vimeo': {
      const hash = video.hash === undefined ? '' : `h=${video.hash}&`;
      return {
        src: `https://player.vimeo.com/video/${video.id}?${hash}dnt=1`,
        title: 'Vimeo video',
      };
    }
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
