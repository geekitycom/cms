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
