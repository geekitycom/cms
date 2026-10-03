/**
 * The post editor's location fields (TASK-223): where the post was written,
 * as a form has it and as `data/locations.json` gets it (decision-29).
 *
 * Six text boxes rather than a map: the coordinates as one box, since that is
 * how a `geo:` URI and a phone both spell them, the accuracy beside them, and
 * the four words of a place. Every box empty is no location, which is what
 * clearing them means.
 */
import { geoPoint, geoProblem, parseGeoUri, postLocation } from '../content/location.ts';
import type { GeoPoint, PostLocation } from '../content/location.ts';

/** The location fields, as strings, which is what a form has. */
export interface LocationForm {
  /** `LAT, LNG` or `LAT, LNG, ALT`, or a whole `geo:` URI; empty for none. */
  geo: string;
  /** Metres, or empty when nobody said. */
  accuracy: string;
  name: string;
  locality: string;
  region: string;
  country: string;
}

/** The form field names, in one place for the template and the reader. */
export const LOCATION_FIELDS = {
  geo: 'location-geo',
  accuracy: 'location-accuracy',
  name: 'location-name',
  locality: 'location-locality',
  region: 'location-region',
  country: 'location-country',
} as const satisfies Record<keyof LocationForm, string>;

/** No location. */
export const BLANK_LOCATION_FORM: LocationForm = {
  geo: '',
  accuracy: '',
  name: '',
  locality: '',
  region: '',
  country: '',
};

/** A stored location as the editor shows it. */
export function locationForm(location: PostLocation | undefined): LocationForm {
  if (location === undefined) return BLANK_LOCATION_FORM;
  const geo = location.geo;
  return {
    geo:
      geo === undefined
        ? ''
        : [geo.latitude, geo.longitude, ...(geo.altitude === undefined ? [] : [geo.altitude])]
            .map(String)
            .join(', '),
    accuracy: geo?.accuracy === undefined ? '' : String(geo.accuracy),
    name: location.name ?? '',
    locality: location.locality ?? '',
    region: location.region ?? '',
    country: location.country ?? '',
  };
}

/** The location fields out of a submitted form. */
export function readLocationForm(body: Record<string, unknown>): LocationForm {
  const field = (name: string): string => (typeof body[name] === 'string' ? body[name] : '').trim();
  return {
    geo: field(LOCATION_FIELDS.geo),
    accuracy: field(LOCATION_FIELDS.accuracy),
    name: field(LOCATION_FIELDS.name),
    locality: field(LOCATION_FIELDS.locality),
    region: field(LOCATION_FIELDS.region),
    country: field(LOCATION_FIELDS.country),
  };
}

/** The location to store, none for a form with every box empty, or why it cannot be. */
export function resolveLocation(
  form: LocationForm,
): { location: PostLocation | undefined } | { error: string } {
  const accuracy = form.accuracy === '' ? undefined : Number(form.accuracy);
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0)) {
    return { error: 'Accuracy has to be a number of metres, 0 or more.' };
  }
  const geo = coordinates(form.geo, accuracy);
  if ('error' in geo) return geo;
  const word = (value: string): string | undefined => (value === '' ? undefined : value);
  return {
    location: postLocation({
      geo: geo.geo,
      name: word(form.name),
      locality: word(form.locality),
      region: word(form.region),
      country: word(form.country),
    }),
  };
}

const EXAMPLE = 'like 48.85837, 2.29448';

/**
 * The coordinates box as a point: a `geo:` URI, or a latitude and a longitude
 * with an altitude after them, however they are separated. The accuracy box
 * wins over a URI's own `u=`, since it is the one on the screen.
 */
function coordinates(
  text: string,
  accuracy: number | undefined,
): { geo: GeoPoint | undefined } | { error: string } {
  if (text === '') return { geo: undefined };
  if (/^geo:/i.test(text)) {
    const geo = parseGeoUri(text);
    if (geo === undefined) {
      return {
        error: 'Coordinates as a geo: URI are geo:LATITUDE,LONGITUDE, like geo:48.85837,2.29448.',
      };
    }
    return { geo: accuracy === undefined ? geo : { ...geo, accuracy } };
  }
  const numbers = text.split(/[\s,]+/).filter((part) => part !== '');
  if (numbers.length > 3)
    return { error: `Coordinates are a latitude and a longitude, ${EXAMPLE}.` };
  const [latitude, longitude, altitude] = numbers.map(Number);
  const parts = { latitude, longitude, altitude, accuracy };
  const problem = geoProblem(parts);
  return problem === undefined
    ? { geo: geoPoint(parts) }
    : { error: `Coordinates: ${problem}, ${EXAMPLE}.` };
}
