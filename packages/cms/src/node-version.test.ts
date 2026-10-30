import assert from 'node:assert/strict';
import fs from 'node:fs';
import { it } from 'node:test';

const repository = new URL('../../../', import.meta.url);

it('builds the Docker image on the Node that .node-version pins', () => {
  const pinned = fs.readFileSync(new URL('.node-version', repository), 'utf8').trim();
  const dockerfile = fs.readFileSync(new URL('Dockerfile', repository), 'utf8');
  const image = /^ARG NODE_IMAGE=node:([\d.]+)-/m.exec(dockerfile)?.[1];
  assert.equal(image, pinned);
});
