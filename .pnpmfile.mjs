/**
 * The peer ranges a workspace package publishes, as `pnpm pack` writes them
 * into the tarball's package.json and scripts/build-plugin-bundle.js writes
 * them into a plugin's plugin.json.
 *
 * pnpm turns `workspace:^` into a caret range on the workspace version, and
 * before 1.0 a caret range accepts a single minor. A plugin built against core
 * 0.26.0 would refuse core 0.27.0, though the host API version, not the core
 * minor, is what marks a break for plugins. So a peer written `workspace:^` on
 * a 0.x package publishes as `>=<version> <1.0.0`: the version it was built
 * against, up to 1.0. From 1.0 on it is the caret range pnpm writes.
 *
 * pnpm runs `beforePacking` after its own `workspace:` rewrite, on every
 * `pnpm pack` in the workspace, which is how `pnpm release` and
 * scripts/pack-install-smoke.sh build their tarballs. pnpm records this file's
 * checksum in pnpm-lock.yaml, so a change to it needs `pnpm install`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const WORKSPACE = 'workspace:';

/** @param {string} packageDir @returns {Record<string, string>} */
export function publishedPeerDependencies(packageDir) {
  const manifestPath = path.join(packageDir, 'package.json');
  const peers = JSON.parse(readFileSync(manifestPath, 'utf8')).peerDependencies ?? {};
  const require = createRequire(manifestPath);
  const versionOf = (name) =>
    JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version;
  return Object.fromEntries(
    Object.entries(peers).map(([name, range]) => [
      name,
      range.startsWith(WORKSPACE)
        ? publishedRange(range.slice(WORKSPACE.length), name, versionOf)
        : range,
    ]),
  );
}

function publishedRange(wanted, name, versionOf) {
  if (['', '*', '^', '~'].includes(wanted)) {
    const version = versionOf(name);
    if (wanted === '' || wanted === '*') return version;
    if (wanted === '^' && version.startsWith('0.')) return `>=${version} <1.0.0`;
    return `${wanted}${version}`;
  }
  return wanted;
}

export const hooks = {
  beforePacking(manifest, packageDir) {
    if (manifest.peerDependencies === undefined) return manifest;
    return { ...manifest, peerDependencies: publishedPeerDependencies(packageDir) };
  },
};
