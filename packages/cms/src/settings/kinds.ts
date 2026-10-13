import type { Parsed, SettingType } from './types.ts';

const TRUE_WORDS = ['1', 'true', 'yes', 'on'];
const FALSE_WORDS = ['0', 'false', 'no', 'off'];

export const boolean: SettingType<boolean> = {
  fromJson: (raw) =>
    typeof raw === 'boolean'
      ? { ok: true, value: raw }
      : { ok: false, problem: 'must be true or false' },
  fromText(text) {
    const normalized = text.trim().toLowerCase();
    if (TRUE_WORDS.includes(normalized)) return { ok: true, value: true };
    if (FALSE_WORDS.includes(normalized)) return { ok: true, value: false };
    return { ok: false, problem: `must be true or false, received ${JSON.stringify(text)}` };
  },
  toJson: (value) => value,
  toText: (value) => String(value),
};

export const instantOrEmpty: SettingType<string> = {
  fromJson: (raw) =>
    typeof raw === 'string' ? instant(raw) : { ok: false, problem: 'must be a time as text' },
  fromText: instant,
  toJson: (value) => value,
  toText: (value) => value,
};

function instant(text: string): Parsed<string> {
  if (text.trim() === '') return { ok: true, value: '' };
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? {
        ok: false,
        problem: `must be a time such as 2026-09-28T14:00:00Z, received ${JSON.stringify(text)}`,
      }
    : { ok: true, value: date.toISOString() };
}

export const text: SettingType<string> = {
  fromJson: (raw) =>
    typeof raw === 'string' ? { ok: true, value: raw } : { ok: false, problem: 'must be text' },
  fromText: (value) => ({ ok: true, value }),
  toJson: (value) => value,
  toText: (value) => value,
};

export const port: SettingType<number> = {
  fromJson: (raw) => portIn(raw),
  fromText: (value) => portIn(value.trim() === '' ? NaN : Number(value), value),
  toJson: (value) => value,
  toText: (value) => String(value),
};

function portIn(raw: unknown, received: unknown = raw): Parsed<number> {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 65535
    ? { ok: true, value: raw }
    : {
        ok: false,
        problem: `must be a whole number between 1 and 65535, received ${JSON.stringify(received)}`,
      };
}

export function oneOf<const T extends string>(choices: readonly T[]): SettingType<T> {
  const parse = (raw: unknown): Parsed<T> =>
    choices.includes(raw as T)
      ? { ok: true, value: raw as T }
      : {
          ok: false,
          problem: `must be one of ${choices.join(', ')}, received ${JSON.stringify(raw)}`,
        };
  return { fromJson: parse, fromText: parse, toJson: (value) => value, toText: (value) => value };
}

export const nonEmptyText: SettingType<string> = {
  fromJson: (raw) =>
    typeof raw === 'string' && raw !== ''
      ? { ok: true, value: raw }
      : { ok: false, problem: 'must be text that is not empty' },
  fromText: (value) => nonEmptyText.fromJson(value),
  toJson: (value) => value,
  toText: (value) => value,
};

/** Text the file leaves out when it is empty. */
export const optionalText: SettingType<string> = {
  ...text,
  toJson: (value) => (value === '' ? undefined : value),
};

/**
 * A whole number of at least `min`. `coerced` also reads a number written as
 * text, as `"7"`, which files written by hand hold.
 */
export function wholeNumber(min: number, { coerced = false } = {}): SettingType<number> {
  const parse = (raw: unknown, received: unknown = raw): Parsed<number> => {
    const count = coerced ? Number(raw) : raw;
    return typeof count === 'number' && Number.isInteger(count) && count >= min
      ? { ok: true, value: count }
      : {
          ok: false,
          problem: `must be a whole number of ${String(min)} or more, received ${JSON.stringify(received)}`,
        };
  };
  return {
    fromJson: (raw) => parse(raw),
    fromText: (value) => parse(value.trim() === '' ? NaN : Number(value), value),
    toJson: (value) => value,
    toText: (value) => String(value),
  };
}

/** A value the file holds as JSON, given in the environment and the CLI as JSON text. */
export function jsonValue<V>(
  fromJson: (raw: unknown) => Parsed<V>,
  toJson: (value: V) => unknown,
): SettingType<V> {
  return {
    fromJson,
    fromText(value) {
      try {
        return fromJson(JSON.parse(value));
      } catch {
        return { ok: false, problem: `must be JSON, received ${JSON.stringify(value)}` };
      }
    },
    toJson,
    toText: (value) => JSON.stringify(toJson(value) ?? null),
  };
}
