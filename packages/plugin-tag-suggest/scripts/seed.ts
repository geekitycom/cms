/**
 * The seed list's filter: hashtags people follow on tags.pub, from a
 * `tag,followers` export, kept when enough people follow them and dropped when
 * they are tags.pub's own service accounts or on the denylist.
 */

import { hashtagKey } from '../src/key.ts';

/** A tag as the export spells it, and how many follow it. */
export type SeedTag = readonly [name: string, followers: number];

/**
 * The denylist's test for a folded tag. A line is a tag, or a fragment
 * between asterisks that rules out every tag containing it; `#` starts a
 * comment.
 */
function denied(denylist: string): (key: string) => boolean {
  const names = new Set<string>();
  const fragments: string[] = [];
  for (const raw of denylist.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    const fragment = /^\*(.+)\*$/.exec(line)?.[1];
    if (fragment === undefined) names.add(hashtagKey(line));
    else fragments.push(hashtagKey(fragment));
  }
  return (key) => names.has(key) || fragments.some((fragment) => key.includes(fragment));
}

/** The tags worth suggesting for reach, most followed first, then by name. */
export function seedTags(csv: string, denylist: string, minimumFollowers: number): SeedTag[] {
  const isDenied = denied(denylist);
  const kept = new Map<string, SeedTag>();
  csv.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    const match = /^([^,]+),(\d+)$/.exec(line);
    if (match === null)
      throw new Error(`line ${String(index + 1)} is not "tag,followers": ${line}`);
    const [, name = '', count = ''] = match;
    const followers = Number(count);
    const key = hashtagKey(name);
    if (name.startsWith('_') || key === '' || followers < minimumFollowers || isDenied(key)) return;
    const held = kept.get(key);
    if (held === undefined || held[1] < followers) kept.set(key, [name, followers]);
  });
  return [...kept.values()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
