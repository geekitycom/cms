import { declareDataFile } from '../files/data-files.ts';
import { isRecord } from '../util/guards.ts';
import { declareNamespace } from './declare.ts';
import { instantOrEmpty, oneOf, text } from './kinds.ts';

export const AKISMET_KEY_STATUSES = ['valid', 'invalid', 'unchecked'] as const;

export type AkismetKeyStatus = (typeof AKISMET_KEY_STATUSES)[number];

export const AKISMET_FILE = declareDataFile({
  pattern: 'akismet.json',
  dataClass: { kind: 'credential' },
  lost: 'The Akismet key, typed in again on Settings > Discussion.',
});

export const AKISMET = declareNamespace({
  namespace: 'akismet',
  storage: { kind: 'file', under: 'data', file: AKISMET_FILE },
  envPrefix: 'GEEKITY_AKISMET',
  legacy: renameCheckedAt,
  settings: {
    key: {
      type: text,
      default: '',
      secret: true,
      description: 'The Akismet API key. Empty sends nothing to Akismet.',
    },
    status: {
      type: oneOf(AKISMET_KEY_STATUSES),
      default: 'unchecked',
      description: 'What Akismet said about the key when it was last checked.',
    },
    checked_at: {
      type: instantOrEmpty,
      default: '',
      description: 'When the key was last checked, as an instant.',
    },
  },
});

function renameCheckedAt(raw: unknown): unknown {
  if (!isRecord(raw) || !('checkedAt' in raw)) return raw;
  const { checkedAt, key, status, ...rest } = raw;
  return {
    ...rest,
    key: typeof key === 'string' ? key.trim() : '',
    status: status === 'valid' || status === 'invalid' ? status : 'unchecked',
    checked_at: typeof checkedAt === 'string' ? checkedAt : '',
  };
}
