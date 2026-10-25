import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nullable, problemsWith } from './json-schema.ts';

describe('a nullable schema', () => {
  const schema = {
    type: 'object',
    properties: { error: nullable({ type: 'string' }) },
    required: ['error'],
  } as const;

  it('takes null or a value of the inner schema', () => {
    assert.deepEqual(problemsWith(schema, { error: null }), []);
    assert.deepEqual(problemsWith(schema, { error: 'HTTP 403' }), []);
  });

  it('refuses anything else as the inner schema would', () => {
    assert.deepEqual(problemsWith(schema, { error: 403 }), ['error must be a string.']);
    assert.deepEqual(problemsWith(schema, {}), ['error is required.']);
  });
});
