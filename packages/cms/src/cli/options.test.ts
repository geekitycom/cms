import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readOption } from './options.ts';
import type { OptionSpec } from './options.ts';

const SPECS: readonly OptionSpec[] = [
  { name: 'out', value: {} },
  { name: 'secret', value: { missing: '--secret needs one.', dashed: true, empty: true } },
  { name: 'all' },
];

describe('readOption', () => {
  it('reads a value from the next word or after an equals sign', () => {
    assert.deepEqual(readOption(['--out', 'a.tar.gz'], 0, SPECS), {
      name: 'out',
      value: 'a.tar.gz',
      words: 2,
    });
    assert.deepEqual(readOption(['--out=a=b'], 0, SPECS), { name: 'out', value: 'a=b', words: 1 });
  });

  it('reads a switch as true', () => {
    assert.deepEqual(readOption(['--all', 'x'], 0, SPECS), { name: 'all', value: true, words: 1 });
  });

  it('refuses a value on a switch and an option no spec names', () => {
    assert.throws(() => readOption(['--all=yes'], 0, SPECS), /^Error: --all takes no value\.$/);
    assert.throws(
      () => readOption(['--nope'], 0, SPECS),
      /^Error: Unknown option "--nope"\. Run geekity --help to see what is available\.$/,
    );
  });

  it('refuses a missing, empty or dashed value unless the spec allows it', () => {
    for (const argv of [['--out'], ['--out='], ['--out', '--all']]) {
      assert.throws(() => readOption(argv, 0, SPECS), /^Error: --out needs a value\.$/);
    }
    assert.throws(() => readOption(['--secret'], 0, SPECS), /^Error: --secret needs one\.$/);
    assert.equal(readOption(['--secret='], 0, SPECS).value, '');
    assert.equal(readOption(['--secret', '-x'], 0, SPECS).value, '-x');
  });
});
