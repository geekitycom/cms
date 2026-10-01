/**
 * The content `pnpm dev` serves: a gitignored copy of `content/`.
 *
 * `content/` is the seed and the tests read it, so nothing done in the admin
 * while poking around ever shows up in git. The copy is made when it is
 * missing and left alone when it is there; `--reset` throws it away first.
 */
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SEED = new URL('./content/', import.meta.url);
const PLAYGROUND = new URL('./playground/', import.meta.url);

if (process.argv.includes('--reset')) {
  await rm(PLAYGROUND, { recursive: true, force: true });
}

if (!existsSync(PLAYGROUND)) {
  await cp(SEED, PLAYGROUND, { recursive: true });
  console.log('copied content/ to playground/');
}
