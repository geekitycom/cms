import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requirementNotes } from './install.ts';

const LLM = '@geekity/plugin-llm';

function manifest(peerDependencies: Record<string, string>) {
  return { name: '@geekity/plugin-post-summary', version: '0.2.1', hostApi: 1, peerDependencies };
}

describe('requirementNotes', () => {
  const builtAgainst = manifest({ '@geekity/cms': '>=0.26.0 <1.0.0', [LLM]: '>=0.2.0 <1.0.0' });

  it('accepts the core it was built against and every later 0.x core', () => {
    const installed = new Map([[LLM, '0.2.0']]);
    for (const core of ['0.26.0', '0.26.3', '0.27.0', '0.99.1']) {
      assert.deepEqual(requirementNotes(builtAgainst, installed, core), [], core);
    }
  });

  it('refuses an older core and core 1.0', () => {
    const installed = new Map([[LLM, '0.2.0']]);
    assert.deepEqual(requirementNotes(builtAgainst, installed, '0.25.4'), [
      'It needs @geekity/cms >=0.26.0 <1.0.0, and this core is 0.25.4, so it will be unavailable.',
    ]);
    assert.deepEqual(requirementNotes(builtAgainst, installed, '1.0.0'), [
      'It needs @geekity/cms >=0.26.0 <1.0.0, and this core is 1.0.0, so it will be unavailable.',
    ]);
  });

  it('accepts a later 0.x of a required plugin and refuses an older one', () => {
    assert.deepEqual(requirementNotes(builtAgainst, new Map([[LLM, '0.3.0']]), '0.26.0'), []);
    assert.deepEqual(requirementNotes(builtAgainst, new Map([[LLM, '0.1.9']]), '0.26.0'), [
      'It requires @geekity/plugin-llm >=0.2.0 <1.0.0, and 0.1.9 is installed.',
    ]);
  });
});
