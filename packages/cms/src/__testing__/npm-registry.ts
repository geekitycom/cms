import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

/**
 * A stand-in for the npm registry on loopback, so `geekity plugin add` is
 * tested without reaching registry.npmjs.org (TASK-279). It answers the two
 * requests an install makes: the package document, and a version's tarball.
 */

/** One published version: its files under `package/`, as `npm pack` lays them out. */
export interface FakePackage {
  name: string;
  version: string;
  files: Record<string, string>;
  /** The integrity the registry claims, when a test wants it to lie. */
  integrity?: string;
  /** Dist-tags pointing at this version. `latest` follows the last version given. */
  tags?: string[];
}

export interface FakeRegistry {
  url: string;
  /** Every path asked for, in order. */
  requests: string[];
  close(): Promise<void>;
}

export async function fakeNpmRegistry(packages: readonly FakePackage[]): Promise<FakeRegistry> {
  const requests: string[] = [];
  const tarballs = new Map<string, Buffer>();
  const documents = new Map<string, Record<string, unknown>>();

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    requests.push(pathname);
    const tarball = tarballs.get(pathname);
    if (tarball !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(tarball);
      return;
    }
    const document = documents.get(pathname.slice(1));
    if (document === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"Not found"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/vnd.npm.install-v1+json' });
    response.end(JSON.stringify(document));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  for (const entry of packages) {
    const bytes = packTarball(entry.files);
    const tarballPath = `/tarballs/${entry.name}-${entry.version}.tgz`;
    tarballs.set(tarballPath, bytes);
    const document = documents.get(entry.name) ?? {
      name: entry.name,
      'dist-tags': {},
      versions: {},
    };
    const tags = document['dist-tags'] as Record<string, string>;
    tags.latest = entry.version;
    for (const tag of entry.tags ?? []) tags[tag] = entry.version;
    (document.versions as Record<string, unknown>)[entry.version] = {
      name: entry.name,
      version: entry.version,
      dist: {
        tarball: `${url}${tarballPath}`,
        integrity:
          entry.integrity ?? `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      },
    };
    documents.set(entry.name, document);
  }

  return {
    url,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A gzipped ustar archive with each file under `package/`. */
export function packTarball(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
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

/** A bundle and manifest as the bundle build writes them, for a fake package's files. */
export function pluginFiles(options: {
  name: string;
  version: string;
  hostApi?: number;
  requires?: Record<string, string>;
  core?: string;
}): Record<string, string> {
  const { name, version, hostApi = 1, requires = {}, core = '>=0.0.0' } = options;
  return {
    'package.json': JSON.stringify({ name, version }),
    'dist/index.js': 'export {};\n',
    'dist/bundle/index.js': `export default {
  name: ${JSON.stringify(name)},
  version: ${JSON.stringify(version)},
  label: ${JSON.stringify(`Label of ${name}`)},
  description: 'From the registry.',
  hostApi: ${String(hostApi)},
  requires: ${JSON.stringify(requires)},
  register() {},
};
`,
    'dist/bundle/plugin.json': JSON.stringify({
      name,
      version,
      hostApi,
      peerDependencies: { '@geekity/cms': core, ...requires },
    }),
  };
}
