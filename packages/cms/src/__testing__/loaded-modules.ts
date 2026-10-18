import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const loaded = new Set<string>();

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    loaded.add(resolved.url);
    return resolved;
  },
});

// A file rather than stderr: a write to a pipe in an exit handler stops at
// the pipe's 64 KB buffer, and a site that loads the whole CMS lists more.
process.on('exit', () => {
  const file = process.env['GEEKITY_TEST_LOADED_MODULES'];
  if (file !== undefined) writeFileSync(file, JSON.stringify([...loaded]));
});
