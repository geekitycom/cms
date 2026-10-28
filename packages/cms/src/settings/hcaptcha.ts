import { declareDataFile } from '../files/data-files.ts';
import { declareNamespace } from './declare.ts';
import { instantOrEmpty, oneOf, text } from './kinds.ts';

export const HCAPTCHA_PAIR_STATUSES = ['valid', 'invalid', 'unchecked'] as const;

export type HcaptchaPairStatus = (typeof HCAPTCHA_PAIR_STATUSES)[number];

export const HCAPTCHA_FILE = declareDataFile({
  pattern: 'hcaptcha.json',
  dataClass: { kind: 'credential' },
  lost: 'The hCaptcha site key and secret, typed in again on Settings > Discussion.',
});

export const HCAPTCHA = declareNamespace({
  namespace: 'hcaptcha',
  storage: { kind: 'file', under: 'data', file: HCAPTCHA_FILE },
  envPrefix: 'GEEKITY_HCAPTCHA',
  settings: {
    site_key: {
      type: text,
      default: '',
      description: 'The hCaptcha site key, printed in the page. Empty challenges no form.',
    },
    secret: {
      type: text,
      default: '',
      secret: true,
      description: 'The hCaptcha secret that checks a token. Empty challenges no form.',
    },
    status: {
      type: oneOf(HCAPTCHA_PAIR_STATUSES),
      default: 'unchecked',
      description: 'What hCaptcha said about the site key and secret when they were last checked.',
    },
    checked_at: {
      type: instantOrEmpty,
      default: '',
      description: 'When the site key and secret were last checked, as an instant.',
    },
  },
});
