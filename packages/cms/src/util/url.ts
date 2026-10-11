/** `value` with every trailing slash removed, so `https://h/v1//` and `https://h/v1` agree. */
export function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** `value` ending in exactly one slash, ready to resolve a relative path against. */
export function withTrailingSlash(value: string): string {
  return `${withoutTrailingSlash(value)}/`;
}

/**
 * A base URL carrying a path — a site served from a subdirectory — puts that
 * path in front of a root-relative one; `new URL('/x', 'https://h/blog/')`
 * would drop `/blog`.
 */
export function absoluteUrl(pathname: string, baseUrl: string): string {
  const base = new URL(withTrailingSlash(baseUrl));
  const basePath = withoutTrailingSlash(base.pathname);
  const resolved = pathname.startsWith('/') ? `${basePath}${pathname}` : pathname;
  return URL.parse(resolved, base)?.toString() ?? pathname;
}
