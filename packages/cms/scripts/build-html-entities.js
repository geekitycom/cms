/**
 * Write `src/util/html-entities.ts`, the HTML named character reference table
 * `decodeEntities` reads, from the WHATWG's `entities.json`.
 *
 * The table is fixed by the HTML standard and has not changed in years, so the
 * module is committed rather than built. Rebuild it with
 *
 *     node scripts/build-html-entities.js [path/to/entities.json]
 *
 * which reads the file given, or fetches https://html.spec.whatwg.org/entities.json
 * when none is, then run prettier over what it writes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(packageDir, 'src/util/html-entities.ts');
const SOURCE = 'https://html.spec.whatwg.org/entities.json';

const given = process.argv[2];
const table = JSON.parse(
  given === undefined ? await (await fetch(SOURCE)).text() : await readFile(given, 'utf8'),
);

const named = [];
const legacy = [];
for (const [reference, { characters }] of Object.entries(table)) {
  const name = reference.slice(1);
  if (name.endsWith(';')) named.push([name.slice(0, -1), characters]);
  else legacy.push(name);
}
named.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
legacy.sort();

const missing = legacy.filter((name) => !named.some(([other]) => other === name));
if (missing.length > 0) throw new Error(`legacy names with no ; form: ${missing.join(', ')}`);

function literal(text) {
  return `'${[...text]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x20 && code < 0x7f && character !== "'" && character !== '\\') return character;
      return `\\u{${code.toString(16)}}`;
    })
    .join('')}'`;
}

await writeFile(
  output,
  [
    `// Written by scripts/build-html-entities.js from ${SOURCE}.`,
    '',
    '/** Every named character reference in HTML, by name without its semicolon. */',
    'export const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([',
    ...named.map(([name, characters]) => `  [${literal(name)}, ${literal(characters)}],`),
    ']);',
    '',
    '/** The names HTML also reads without a semicolon, for pages written before it required one. */',
    'export const LEGACY_REFERENCES: ReadonlySet<string> = new Set([',
    ...legacy.map((name) => `  ${literal(name)},`),
    ']);',
    '',
  ].join('\n'),
);

console.log(`${named.length} names, ${legacy.length} legacy, written to ${output}`);
