/**
 * A one-package npm registry for scripts/docker-smoke.sh, run with the image's
 * own node inside the container under test, so the smoke test installs a
 * plugin with `geekity plugin add` without reaching registry.npmjs.org and
 * without Node or pnpm on the machine running it:
 *
 *   node fake-npm-registry.mjs <port>
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

const NAME = '@geekity-smoke/plugin-hello';
const VERSIONS = ['1.0.0', '1.1.0'];
const port = Number(process.argv[2] ?? '4873');
const peerDependencies = { '@geekity/cms': '>=0.0.0' };

function files(version) {
  return {
    'package.json': JSON.stringify({ name: NAME, version, type: 'module', peerDependencies }),
    'dist/bundle/index.js': `export default {
  name: '${NAME}',
  version: '${version}',
  label: 'Hello from the smoke registry',
  description: 'Installed by geekity plugin add in the Docker smoke test.',
  hostApi: 1,
  requires: {},
  register() {},
};
`,
    'dist/bundle/plugin.json': JSON.stringify({
      name: NAME,
      version,
      hostApi: 1,
      peerDependencies,
    }),
  };
}

function tarball(entries) {
  const blocks = [];
  for (const [name, text] of Object.entries(entries)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const tarballs = new Map(
  VERSIONS.map((version) => [`/tarballs/plugin-hello-${version}.tgz`, tarball(files(version))]),
);
const document = JSON.stringify({
  name: NAME,
  'dist-tags': { latest: VERSIONS.at(-1) },
  versions: Object.fromEntries(
    VERSIONS.map((version) => {
      const tarballPath = `/tarballs/plugin-hello-${version}.tgz`;
      const bytes = tarballs.get(tarballPath);
      return [
        version,
        {
          name: NAME,
          version,
          peerDependencies,
          dist: {
            tarball: `http://127.0.0.1:${String(port)}${tarballPath}`,
            integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          },
        },
      ];
    }),
  ),
});

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
  const bytes = tarballs.get(pathname);
  if (bytes !== undefined) {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(bytes);
  } else if (pathname === `/${NAME}`) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(document);
  } else {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"Not found"}');
  }
}).listen(port, '127.0.0.1', () => console.log(`fake registry on ${String(port)}`));
