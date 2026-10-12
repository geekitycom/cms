import type { FieldError } from './form-error.ts';
import { geoPoint, geoProblem, parseGeoUri, postLocation } from './location.ts';
import type { GeoPoint, PostLocation } from './location.ts';

export interface LocationForm {
  geo: string;
  accuracy: string;
  name: string;
  locality: string;
  region: string;
  country: string;
  checkin: boolean;
}

export const BLANK_LOCATION_FORM: LocationForm = {
  geo: '',
  accuracy: '',
  name: '',
  locality: '',
  region: '',
  country: '',
  checkin: false,
};

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
    checkin: location.checkin === true,
  };
}

export function resolveLocation(
  form: LocationForm,
): { location: PostLocation | undefined } | FieldError {
  const accuracy = form.accuracy === '' ? undefined : Number(form.accuracy);
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0)) {
    return {
      error: 'Accuracy has to be a number of metres, 0 or more.',
      field: 'editor-location-accuracy',
    };
  }
  const geo = coordinates(form.geo, accuracy);
  if ('error' in geo) return { error: geo.error, field: 'editor-location-geo' };
  const word = (value: string): string | undefined => (value === '' ? undefined : value);
  return {
    location: postLocation({
      geo: geo.geo,
      name: word(form.name),
      locality: word(form.locality),
      region: word(form.region),
      country: word(form.country),
      checkin: form.checkin ? true : undefined,
    }),
  };
}

const EXAMPLE = 'like 48.85837, 2.29448';

function coordinates(
  text: string,
  boxAccuracy: number | undefined,
): { geo: GeoPoint | undefined } | { error: string } {
  if (text === '') return { geo: undefined };
  if (/^geo:/i.test(text)) {
    const geo = parseGeoUri(text);
    if (geo === undefined) {
      return {
        error: 'Coordinates as a geo: URI are geo:LATITUDE,LONGITUDE, like geo:48.85837,2.29448.',
      };
    }
    return {
      geo: boxAccuracy === undefined ? geo : { ...geo, accuracy: boxAccuracy },
    };
  }
  const numbers = text.split(/[\s,]+/).filter((part) => part !== '');
  if (numbers.length > 3)
    return { error: `Coordinates are a latitude and a longitude, ${EXAMPLE}.` };
  const [latitude, longitude, altitude] = numbers.map(Number);
  const parts = { latitude, longitude, altitude, accuracy: boxAccuracy };
  const problem = geoProblem(parts);
  return problem === undefined
    ? { geo: geoPoint(parts) }
    : { error: `Coordinates: ${problem}, ${EXAMPLE}.` };
}
