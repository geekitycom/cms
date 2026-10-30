import assert from 'node:assert/strict';
import fs from 'node:fs';
import { it } from 'node:test';

import semver from 'semver';

const repository = new URL('../../../', import.meta.url);

interface Manifest {
  name: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifests(): Manifest[] {
  return ['packages', 'apps'].flatMap((folder) =>
    fs
      .readdirSync(new URL(`${folder}/`, repository))
      .map((name) => new URL(`${folder}/${name}/package.json`, repository))
      .filter((file) => fs.existsSync(file))
      .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest),
  );
}

// pnpm orders a workspace build by a workspace: range only while the range
// accepts the other package's version, so a release that bumps that package
// past the range builds the two at once.
it('has every workspace: range accept the version its package is at now', () => {
  const all = manifests();
  const versions = new Map(all.map((manifest) => [manifest.name, manifest.version]));
  const stale = all.flatMap((manifest) =>
    [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].flatMap((ranges) =>
      Object.entries(ranges ?? {}).flatMap(([name, spec]) => {
        const range = /^workspace:(.*)$/.exec(spec)?.[1];
        const version = versions.get(name);
        if (range === undefined || ['*', '^', '~'].includes(range) || version === undefined) {
          return [];
        }
        return semver.satisfies(version, range) ? [] : [`${manifest.name} → ${name}@${spec}`];
      }),
    ),
  );
  assert.deepEqual(
    stale,
    [],
    `these ranges no longer accept the workspace version: ${stale.join(', ')}`,
  );
});
