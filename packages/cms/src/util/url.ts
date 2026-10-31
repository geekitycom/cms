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

/** A decoded path with each segment percent-encoded, so `#`, `?`, `%` and spaces name the file rather than end the path. */
export function encodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * A decoded relative path, or `undefined` when a segment is empty, `.` or `..`
 * or it holds a NUL, so each file has one spelling and no path resolves
 * somewhere its text does not say.
 */
export function plainRelativePath(decoded: string): string | undefined {
  if (decoded.includes('\0')) return undefined;
  const plain = decoded.split('/').every((segment) => !['', '.', '..'].includes(segment));
  return plain ? decoded : undefined;
}

/** A relative URL path decoded segment by segment, then held to {@link plainRelativePath}. */
export function decodedRelativePath(encoded: string): string | undefined {
  try {
    return plainRelativePath(encoded.split('/').map(decodeURIComponent).join('/'));
  } catch {
    return undefined;
  }
}
