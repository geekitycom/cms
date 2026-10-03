/**
 * Where a post was written (TASK-223): what Micropub's `location` property
 * carries, and what of it the site shares.
 *
 * It is not front matter. `content/` may be a public git repository, so a
 * location written there would be public whatever the site chooses; it lives
 * in `data/locations.json` instead (decision-29, `locations.ts`). This module
 * is the shape and the two readings of it: from a Micropub value at the
 * boundary, and back out for `q=source`.
 *
 * Nothing that renders a page reads a {@link PostLocation}. It reads the
 * {@link SharedLocation} that {@link shareLocation} reduces it to under the
 * site's setting, and only the `exact` variant of that union carries a
 * coordinate, so printing one under `place` is a type error rather than a
 * forgotten branch.
 */

/** A point on the ground, as a `geo:` URI (RFC 5870) spells one. */
export interface GeoPoint {
  /** Decimal degrees, -90 to 90. */
  readonly latitude: number;
  /** Decimal degrees, -180 to 180. */
  readonly longitude: number;
  /** Metres above sea level, when given. */
  readonly altitude?: number | undefined;
  /** The `u=` parameter: how far off the point may be, in metres. */
  readonly accuracy?: number | undefined;
}

/** The words of a place, each an h-adr or h-card property. Any may be missing. */
export interface PlaceWords {
  readonly name?: string | undefined;
  readonly locality?: string | undefined;
  readonly region?: string | undefined;
  readonly country?: string | undefined;
}

/**
 * A post's location as stored: a point, words, or both. One with neither is
 * no location, and {@link locationFromMicropub} and {@link locationOf} never
 * make one.
 */
export interface PostLocation extends PlaceWords {
  readonly geo?: GeoPoint | undefined;
}

/** What the site shares of a location, in the order the Privacy page offers them. */
export const LOCATION_SHARING = ['none', 'place', 'exact'] as const;

/**
 * `none` keeps the location and publishes nothing of it (the default);
 * `place` publishes the words and never a coordinate; `exact` publishes the
 * coordinates as well.
 */
export type LocationSharing = (typeof LOCATION_SHARING)[number];

export function isLocationSharing(value: unknown): value is LocationSharing {
  return (LOCATION_SHARING as readonly unknown[]).includes(value);
}

/**
 * The part of a location a renderer may print. `place` is words alone;
 * `exact` is words, possibly none, and the point.
 */
export type SharedLocation =
  | { readonly kind: 'place'; readonly place: PlaceWords }
  | { readonly kind: 'exact'; readonly place: PlaceWords; readonly geo: GeoPoint };

/**
 * The location reduced to what the setting lets out, or `undefined` when
 * nothing may be printed: everything under `none`, and coordinates alone
 * under `place`.
 */
export function shareLocation(
  location: PostLocation | undefined,
  sharing: LocationSharing,
): SharedLocation | undefined {
  if (location === undefined || sharing === 'none') return undefined;
  const place = placeWords(location);
  if (sharing === 'exact' && location.geo !== undefined) {
    return { kind: 'exact', place, geo: location.geo };
  }
  return placeWordList(place).length === 0 ? undefined : { kind: 'place', place };
}

/** The words of a place that are there, in the order they read: name, locality, region, country. */
export function placeWordList(place: PlaceWords): string[] {
  return [place.name, place.locality, place.region, place.country].filter(
    (word): word is string => word !== undefined,
  );
}

/** A `geo:` URI as a point: `geo:LAT,LNG[,ALT][;u=ACC]`, as Quill sends one. */
export function parseGeoUri(text: string): GeoPoint | undefined {
  const match = /^geo:([^;]*)((?:;[^;=]+(?:=[^;]*)?)*)$/i.exec(text.trim());
  if (match === null) return undefined;
  const coordinates = (match[1] ?? '').split(',').map((part) => Number(part.trim()));
  const [latitude, longitude, altitude] = coordinates;
  if (coordinates.length < 2 || coordinates.length > 3) return undefined;
  const accuracy = /;u=([^;]*)/i.exec(match[2] ?? '')?.[1];
  return geoPoint({
    latitude,
    longitude,
    altitude,
    accuracy: accuracy === undefined ? undefined : Number(accuracy),
  });
}

/** A point as the `geo:` URI Quill spells it. */
export function geoUri(geo: GeoPoint): string {
  const coordinates = [
    geo.latitude,
    geo.longitude,
    ...(geo.altitude === undefined ? [] : [geo.altitude]),
  ];
  const accuracy = geo.accuracy === undefined ? '' : `;u=${String(geo.accuracy)}`;
  return `geo:${coordinates.map(String).join(',')}${accuracy}`;
}

/** A point from loose numbers, or `undefined` when they do not make one. */
export function geoPoint(parts: {
  latitude: number | undefined;
  longitude: number | undefined;
  altitude?: number | undefined;
  accuracy?: number | undefined;
}): GeoPoint | undefined {
  const problem = geoProblem(parts);
  if (problem !== undefined || parts.latitude === undefined || parts.longitude === undefined) {
    return undefined;
  }
  return {
    latitude: parts.latitude,
    longitude: parts.longitude,
    ...(parts.altitude === undefined ? {} : { altitude: parts.altitude }),
    ...(parts.accuracy === undefined ? {} : { accuracy: parts.accuracy }),
  };
}

/**
 * What is wrong with a point's numbers, or `undefined` for a point that is one.
 * `NaN` is a number that was typed and did not parse, so it is named too.
 */
export function geoProblem(parts: {
  latitude: number | undefined;
  longitude: number | undefined;
  altitude?: number | undefined;
  accuracy?: number | undefined;
}): string | undefined {
  const { latitude, longitude, altitude, accuracy } = parts;
  if (latitude === undefined || longitude === undefined) {
    return 'needs both a latitude and a longitude';
  }
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return 'latitude has to be a number between -90 and 90';
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return 'longitude has to be a number between -180 and 180';
  }
  if (altitude !== undefined && !Number.isFinite(altitude)) {
    return 'altitude has to be a number of metres';
  }
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0)) {
    return 'accuracy has to be a number of metres, 0 or more';
  }
  return undefined;
}

/**
 * The microformats2 types a `location` may be given as, and whether each may
 * name a place. An h-geo is coordinates alone.
 */
const LOCATION_TYPES: Readonly<Record<string, { readonly words: boolean }>> = {
  'h-geo': { words: false },
  'h-adr': { words: true },
  'h-card': { words: true },
};

const GEO_URI_HINT = 'a geo: URI such as geo:48.85837,2.29448;u=50';

/**
 * A Micropub `location` value as a location, or why it is not one.
 *
 * A string is a `geo:` URI, which is all Quill sends. An object is an
 * embedded h-geo, h-adr or h-card: `latitude`, `longitude` and `altitude` as
 * numbers or numeric text, `name`, `locality`, `region` and `country-name` as
 * text, and `geo` as a `geo:` URI or a nested h-geo. Every refusal names the
 * property, so a client can tell its user what did not land.
 */
export function locationFromMicropub(value: unknown): PostLocation | { readonly error: string } {
  if (typeof value === 'string') {
    const geo = parseGeoUri(value);
    return geo === undefined
      ? { error: `location is ${GEO_URI_HINT}, or an h-geo, h-adr or h-card object.` }
      : { geo };
  }
  if (!isRecord(value)) {
    return { error: `location is ${GEO_URI_HINT}, or an h-geo, h-adr or h-card object.` };
  }
  const type = Array.isArray(value['type']) ? value['type'].find(isLocationType) : undefined;
  if (type === undefined) {
    return { error: 'location is an object whose type is h-geo, h-adr or h-card.' };
  }
  const properties = isRecord(value['properties']) ? value['properties'] : {};
  const first = (name: string): unknown => {
    const given: unknown = properties[name];
    return Array.isArray(given) ? given[0] : given;
  };
  const number = (name: string): number | undefined => {
    const given = first(name);
    if (given === undefined || given === '') return undefined;
    return typeof given === 'number' ? given : typeof given === 'string' ? Number(given) : NaN;
  };
  const word = (name: string): string | undefined => {
    const given = first(name);
    const text = typeof given === 'string' ? given.trim() : '';
    return text === '' ? undefined : text;
  };

  let geo: GeoPoint | undefined;
  const nested = first('geo');
  if (nested !== undefined) {
    const read = locationFromMicropub(nested);
    if ('error' in read) return { error: `location geo: ${read.error}` };
    geo = read.geo;
  } else if (number('latitude') !== undefined || number('longitude') !== undefined) {
    const parts = {
      latitude: number('latitude'),
      longitude: number('longitude'),
      altitude: number('altitude'),
    };
    const problem = geoProblem(parts);
    if (problem !== undefined) return { error: `location ${problem}.` };
    geo = geoPoint(parts);
  }

  const location = postLocation({
    geo,
    ...(LOCATION_TYPES[type]?.words === true
      ? {
          name: word('name'),
          locality: word('locality'),
          region: word('region'),
          country: word('country-name'),
        }
      : {}),
  });
  return location ?? { error: 'location names no place and no coordinates.' };
}

function isLocationType(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(LOCATION_TYPES, value);
}

/**
 * A location as `q=source` answers it, so a client can send it back as it
 * came: coordinates alone as the `geo:` URI, words as an h-adr, a named
 * place as an h-card, each with its point nested as `geo` so the accuracy
 * survives the trip.
 */
export function locationToMicropub(location: PostLocation): string | Record<string, unknown> {
  const words = placeWordList(location);
  if (words.length === 0 && location.geo !== undefined) return geoUri(location.geo);
  const properties: Record<string, unknown[]> = {};
  for (const [property, value] of [
    ['name', location.name],
    ['locality', location.locality],
    ['region', location.region],
    ['country-name', location.country],
  ] as const) {
    if (value !== undefined) properties[property] = [value];
  }
  if (location.geo !== undefined) properties['geo'] = [geoUri(location.geo)];
  return { type: [location.name === undefined ? 'h-adr' : 'h-card'], properties };
}

/**
 * A stored value as a location, read tolerantly because a person may edit the
 * file by hand: a point that is not one is dropped on its own, and an entry
 * with nothing left is no location.
 */
export function locationOf(value: unknown): PostLocation | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value['geo'];
  const geo = isRecord(raw)
    ? geoPoint({
        latitude: numberOf(raw['latitude']),
        longitude: numberOf(raw['longitude']),
        altitude: numberOf(raw['altitude']),
        accuracy: numberOf(raw['accuracy']),
      })
    : undefined;
  const text = (name: string): string | undefined => {
    const given = value[name];
    return typeof given === 'string' && given.trim() !== '' ? given.trim() : undefined;
  };
  return postLocation({
    geo,
    name: text('name'),
    locality: text('locality'),
    region: text('region'),
    country: text('country'),
  });
}

/**
 * A location from its parts, with only the parts that are there, or
 * `undefined` when there are none: the one constructor, so a location with
 * nothing in it cannot be made.
 */
export function postLocation(parts: PostLocation): PostLocation | undefined {
  const location: PostLocation = {
    ...(parts.geo === undefined ? {} : { geo: parts.geo }),
    ...placeWords(parts),
  };
  return Object.keys(location).length === 0 ? undefined : location;
}

/** The words of a place, with only the ones that are there. */
function placeWords(place: PlaceWords): PlaceWords {
  return {
    ...(place.name === undefined ? {} : { name: place.name }),
    ...(place.locality === undefined ? {} : { locality: place.locality }),
    ...(place.region === undefined ? {} : { region: place.region }),
    ...(place.country === undefined ? {} : { country: place.country }),
  };
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
