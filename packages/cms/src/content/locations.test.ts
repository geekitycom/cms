import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { LOCATIONS_FILE, postLocations } from './locations.ts';
import { postLocation } from './location.ts';
import type { LocationParts, PostLocation } from './location.ts';
function located(parts: LocationParts): PostLocation {
  const location = postLocation(parts);
  assert.ok(location !== undefined, 'the parts name a location');
  return location;
}

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-locations-'));
  dirs.push(dir);
  return dir;
}

const PARIS = located({
  locality: 'Paris',
  geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
});

describe('the post locations file (decision-29)', () => {
  it('is under dataDir at mode 0600, and reads back what was set', async () => {
    const dir = await dataDir();
    const locations = postLocations(dir);
    assert.equal(locations.read('/2026/10/a-note/'), undefined, 'nothing stored yet');

    await locations.set('/2026/10/a-note/', PARIS);

    const file = path.join(dir, LOCATIONS_FILE);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { '/2026/10/a-note/': PARIS });
    assert.deepEqual(locations.read('/2026/10/a-note/'), PARIS);
    assert.deepEqual(postLocations(dir).read('/2026/10/a-note/'), PARIS, 'a fresh reader sees it');
  });

  it('removes an entry set to nothing, and the file says so', async () => {
    const dir = await dataDir();
    const locations = postLocations(dir);
    await locations.set('/a/', PARIS);
    await locations.set('/b/', located({ name: 'Home' }));

    await locations.set('/a/', undefined);

    assert.equal(locations.read('/a/'), undefined);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, LOCATIONS_FILE), 'utf8')), {
      '/b/': { name: 'Home' },
    });
  });

  it('moves an entry to a post’s new permalink and leaves none behind', async () => {
    const dir = await dataDir();
    const locations = postLocations(dir);
    await locations.set('/2026/10/old/', PARIS);

    await locations.move('/2026/10/old/', '/2026/10/new/');

    assert.equal(locations.read('/2026/10/old/'), undefined);
    assert.deepEqual(locations.read('/2026/10/new/'), PARIS);

    await locations.move('/nothing/', '/elsewhere/');
    assert.equal(locations.read('/elsewhere/'), undefined, 'moving nothing stores nothing');
  });

  it('does not rewrite the file when nothing changed', async () => {
    const dir = await dataDir();
    const locations = postLocations(dir);
    await locations.set('/a/', PARIS);
    const file = path.join(dir, LOCATIONS_FILE);
    const before = await stat(file);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await locations.set('/a/', { ...PARIS });
    await locations.set('/missing/', undefined);

    assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  });

  it('drops an entry a hand edit left unreadable rather than failing', async () => {
    const dir = await dataDir();
    const locations = postLocations(dir);
    await locations.set('/a/', PARIS);
    const file = path.join(dir, LOCATIONS_FILE);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      file,
      JSON.stringify({ '/a/': PARIS, '/b/': 'geo:1,2', '/c/': { geo: { latitude: 99 } } }),
      'utf8',
    );

    assert.deepEqual(locations.read('/a/'), PARIS);
    assert.equal(locations.read('/b/'), undefined);
    assert.equal(locations.read('/c/'), undefined);

    await writeFile(file, 'not json', 'utf8');
    assert.equal(locations.read('/a/'), undefined);
  });
});
