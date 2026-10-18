import { registerHooks } from 'node:module';

const loaded = new Set<string>();

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    loaded.add(resolved.url);
    return resolved;
  },
});

process.on('exit', () => {
  process.stderr.write(`loaded-modules ${JSON.stringify([...loaded])}\n`);
});
