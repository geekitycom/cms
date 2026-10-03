import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  geoUri,
  isLocationSharing,
  locationFromMicropub,
  locationOf,
  locationToMicropub,
  parseGeoUri,
  postLocation,
  shareLocation,
} from './location.ts';
import type { LocationParts, PostLocation } from './location.ts';

function located(parts: LocationParts): PostLocation {
  const location = postLocation(parts);
  assert.ok(location !== undefined, 'the parts name a location');
  return location;
}

/** Quill's own spelling: five decimals and an accuracy in metres (views/new-post.php:591). */
const QUILL = 'geo:48.85837,2.29448;u=50';

describe('parseGeoUri', () => {
  it('reads latitude, longitude and the u= accuracy Quill sends', () => {
    assert.deepEqual(parseGeoUri(QUILL), { latitude: 48.85837, longitude: 2.29448, accuracy: 50 });
  });

  it('reads an altitude and leaves out what is not given', () => {
    assert.deepEqual(parseGeoUri('geo:-33.8688,151.2093,12'), {
      latitude: -33.8688,
      longitude: 151.2093,
      altitude: 12,
    });
    assert.deepEqual(parseGeoUri('GEO:1,2'), { latitude: 1, longitude: 2 });
  });

  it('is undefined for anything that is not a geo: URI with two coordinates in range', () => {
    for (const bad of [
      'geo:',
      'geo:48.8',
      'geo:91,2',
      'geo:1,181',
      'geo:a,b',
      'https://x',
      '1,2',
    ]) {
      assert.equal(parseGeoUri(bad), undefined, bad);
    }
  });
});

describe('geoUri', () => {
  it('writes the point back the way Quill spells it', () => {
    assert.equal(geoUri({ latitude: 48.85837, longitude: 2.29448, accuracy: 50 }), QUILL);
    assert.equal(geoUri({ latitude: 1, longitude: 2, altitude: 3 }), 'geo:1,2,3');
  });
});

describe('locationFromMicropub', () => {
  it('takes a geo: URI string', () => {
    assert.deepEqual(locationFromMicropub(QUILL), {
      geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
    });
  });

  it('takes an h-geo, an h-adr and an h-card, with a nested geo', () => {
    assert.deepEqual(
      locationFromMicropub({
        type: ['h-geo'],
        properties: { latitude: ['48.85837'], longitude: [2.29448], altitude: ['35'] },
      }),
      { geo: { latitude: 48.85837, longitude: 2.29448, altitude: 35 } },
    );
    assert.deepEqual(
      locationFromMicropub({
        type: ['h-adr'],
        properties: { locality: ['Paris'], region: ['Île-de-France'], 'country-name': ['France'] },
      }),
      { locality: 'Paris', region: 'Île-de-France', country: 'France' },
    );
    assert.deepEqual(
      locationFromMicropub({
        type: ['h-card'],
        properties: { name: ['Eiffel Tower'], locality: ['Paris'], geo: [QUILL] },
      }),
      {
        name: 'Eiffel Tower',
        locality: 'Paris',
        geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
      },
    );
    assert.deepEqual(
      locationFromMicropub({
        type: ['h-card'],
        properties: {
          name: ['Home'],
          geo: [{ type: ['h-geo'], properties: { latitude: ['1'], longitude: ['2'] } }],
        },
      }),
      { name: 'Home', geo: { latitude: 1, longitude: 2 } },
    );
  });

  it('refuses a malformed value with a message naming the problem', () => {
    const says = (value: unknown, pattern: RegExp): void => {
      const parsed = locationFromMicropub(value);
      assert.ok('error' in parsed, JSON.stringify(value));
      assert.match(parsed.error, pattern, JSON.stringify(value));
    };
    says('Paris', /geo: URI/);
    says('geo:48.8', /geo: URI/);
    says(7, /geo: URI/);
    says({ properties: { latitude: ['1'] } }, /h-geo, h-adr or h-card/);
    says({ type: ['h-event'], properties: {} }, /h-geo, h-adr or h-card/);
    says({ type: ['h-geo'], properties: { latitude: ['1'] } }, /both a latitude and a longitude/);
    says({ type: ['h-geo'], properties: { latitude: ['95'], longitude: ['1'] } }, /latitude/);
    says({ type: ['h-geo'], properties: { latitude: ['1'], longitude: ['181'] } }, /longitude/);
    says({ type: ['h-adr'], properties: {} }, /names no place and no coordinates/);
    says({ type: ['h-adr'], properties: { locality: [''] } }, /names no place and no coordinates/);
  });
});

describe('locationToMicropub', () => {
  it('answers coordinates alone as the geo: URI they came as', () => {
    assert.equal(
      locationToMicropub(
        located({ geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 } }),
      ),
      QUILL,
    );
  });

  it('answers words as an h-adr, a named place as an h-card, coordinates nested as geo', () => {
    assert.deepEqual(locationToMicropub(located({ locality: 'Paris', country: 'France' })), {
      type: ['h-adr'],
      properties: { locality: ['Paris'], 'country-name': ['France'] },
    });
    assert.deepEqual(
      locationToMicropub(located({ name: 'Eiffel Tower', geo: { latitude: 1, longitude: 2 } })),
      { type: ['h-card'], properties: { name: ['Eiffel Tower'], geo: ['geo:1,2'] } },
    );
  });

  it('round-trips through its own reading', () => {
    const locations = [
      located({ geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 } }),
      located({ name: 'Eiffel Tower', locality: 'Paris', region: 'IDF', country: 'France' }),
      located({ locality: 'Paris', geo: { latitude: 1, longitude: 2, altitude: 3, accuracy: 4 } }),
    ];
    for (const location of locations) {
      assert.deepEqual(locationFromMicropub(locationToMicropub(location)), location);
    }
  });
});

describe('locationOf', () => {
  it('reads the stored value, dropping what is not a location', () => {
    assert.deepEqual(
      locationOf({ geo: { latitude: 1, longitude: 2, accuracy: 3 }, locality: 'Paris', junk: 1 }),
      { geo: { latitude: 1, longitude: 2, accuracy: 3 }, locality: 'Paris' },
    );
    assert.deepEqual(locationOf({ geo: { latitude: 95, longitude: 2 }, locality: 'Paris' }), {
      locality: 'Paris',
    });
    assert.equal(locationOf({ geo: { latitude: 95, longitude: 2 } }), undefined);
    assert.equal(locationOf('geo:1,2'), undefined);
    assert.equal(locationOf({}), undefined);
  });
});

describe('isLocationSharing', () => {
  it('knows the three levels and nothing else', () => {
    for (const level of ['none', 'place', 'exact']) assert.ok(isLocationSharing(level), level);
    for (const other of ['', 'all', 'NONE', 1, undefined]) assert.ok(!isLocationSharing(other));
  });
});

describe('shareLocation', () => {
  const full = located({
    name: 'Eiffel Tower',
    locality: 'Paris',
    country: 'France',
    geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
  });

  it('shares nothing under none, whatever is stored', () => {
    assert.equal(shareLocation(full, 'none'), undefined);
    assert.equal(shareLocation(undefined, 'none'), undefined);
  });

  it('shares the words alone under place, and nothing for coordinates alone', () => {
    assert.deepEqual(shareLocation(full, 'place'), {
      kind: 'place',
      place: { name: 'Eiffel Tower', locality: 'Paris', country: 'France' },
    });
    assert.equal(shareLocation(located({ geo: full.geo }), 'place'), undefined);
  });

  it('shares the coordinates too under exact, and only the words when there are none', () => {
    assert.deepEqual(shareLocation(full, 'exact'), {
      kind: 'exact',
      place: { name: 'Eiffel Tower', locality: 'Paris', country: 'France' },
      geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
    });
    assert.deepEqual(shareLocation(located({ locality: 'Paris' }), 'exact'), {
      kind: 'place',
      place: { locality: 'Paris' },
    });
    assert.equal(shareLocation(undefined, 'exact'), undefined);
  });
});
