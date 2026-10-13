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

/** An instant as ISO 8601 text, or `''` for none. */
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
