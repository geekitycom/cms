export function shared<Args extends unknown[], Built>(
  build: (...args: Args) => Promise<Built>,
): (...args: Args) => Promise<Built> {
  const built = new Map<string, Promise<Built>>();
  return (...args) => {
    const key = JSON.stringify(args, (_, value: unknown) => {
      if (typeof value === 'function') throw new TypeError('a shared site takes plain data only');
      return value;
    });
    let found = built.get(key);
    if (found === undefined) {
      found = build(...args);
      built.set(key, found);
    }
    return found;
  };
}
