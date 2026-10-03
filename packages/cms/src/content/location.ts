/** A point on the ground, as a `geo:` URI (RFC 5870) spells one. */
export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude?: number | undefined;
  /** The `u=` parameter: how far off the point may be, in metres. */
  readonly accuracy?: number | undefined;
}

export interface PlaceWords {
  readonly name?: string | undefined;
  readonly locality?: string | undefined;
  readonly region?: string | undefined;
  readonly country?: string | undefined;
}

export interface LocationParts extends PlaceWords {
  readonly geo?: GeoPoint | undefined;
}

declare const nonEmpty: unique symbol;

export type PostLocation = LocationParts & { readonly [nonEmpty]: true };

export const LOCATION_SHARING = ['none', 'place', 'exact'] as const;

export type LocationSharing = (typeof LOCATION_SHARING)[number];

export function isLocationSharing(value: unknown): value is LocationSharing {
  return (LOCATION_SHARING as readonly unknown[]).includes(value);
}

export type SharedLocation =
  | { readonly kind: 'place'; readonly place: PlaceWords }
  | { readonly kind: 'exact'; readonly place: PlaceWords; readonly geo: GeoPoint };

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

const LOCATION_TYPES: Readonly<Record<string, { readonly words: boolean }>> = {
  'h-geo': { words: false },
  'h-adr': { words: true },
  'h-card': { words: true },
};

const GEO_URI_HINT = 'a geo: URI such as geo:48.85837,2.29448;u=50';

export function locationFromMicropub(value: unknown): PostLocation | { readonly error: string } {
  if (typeof value === 'string') {
    const geo = parseGeoUri(value);
    const location = geo === undefined ? undefined : postLocation({ geo });
    return (
      location ?? { error: `location is ${GEO_URI_HINT}, or an h-geo, h-adr or h-card object.` }
    );
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

export function postLocation(parts: LocationParts): PostLocation | undefined {
  const location: LocationParts = {
    ...(parts.geo === undefined ? {} : { geo: parts.geo }),
    ...placeWords(parts),
  };
  return Object.keys(location).length === 0 ? undefined : (location as PostLocation);
}

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
