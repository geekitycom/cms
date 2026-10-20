import { declareDataFile } from '../files/data-files.ts';
import { declareNamespace } from './declare.ts';
import { text } from './kinds.ts';

export const TMDB_FILE = declareDataFile({
  pattern: 'tmdb.json',
  dataClass: { kind: 'credential' },
  lost: 'The TMDb API key, typed in again on Settings > General.',
});

export const TMDB = declareNamespace({
  namespace: 'tmdb',
  storage: { kind: 'file', under: 'data', file: TMDB_FILE },
  envPrefix: 'GEEKITY_TMDB',
  settings: {
    key: {
      type: text,
      default: '',
      secret: true,
      description:
        'The TMDb API key or API read access token. Empty looks up no TMDb or IMDb link through TMDb.',
    },
  },
});
