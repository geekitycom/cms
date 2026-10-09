/**
 * What makes two spellings one tag, and the segment of its archive URL.
 *
 * `toLowerCase()` rather than a locale's rules, so a tag matches the same way
 * on every server whatever its locale, and so the key a URL carries is the key
 * the index stores. It does no Unicode normalisation: a tag typed once
 * precomposed and once decomposed stays two tags.
 */
export function tagKey(tag: string): string {
  return tag.toLowerCase();
}

/** The tags without a second spelling of one already listed. The first spelling stays. */
export function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of tags) {
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tag);
  }
  return unique;
}

/** One tag given in another spelling than the site's, and the site's spelling it took. */
export interface Respelling {
  readonly given: string;
  readonly site: string;
}

/**
 * Tags as a write should store them: each one the site already carries in the
 * site's spelling, and no tag twice. `siteSpelling` answers how the site spells
 * a tag, or `undefined` for one it does not carry.
 */
export function respellTags(
  tags: readonly string[],
  siteSpelling: (tag: string) => string | undefined,
): { tags: string[]; respelled: Respelling[] } {
  const respelled: Respelling[] = [];
  const spelled = uniqueTags(tags).map((given) => {
    const site = siteSpelling(given);
    if (site === undefined || site === given) return given;
    respelled.push({ given, site });
    return site;
  });
  return { tags: spelled, respelled };
}
