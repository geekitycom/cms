/**
 * `build`, called once for each distinct set of arguments and shared after.
 *
 * Booting a site is most of what a web test costs, and many tests build the
 * same site only to read pages from it. A test that changes its site (writes a
 * file, adds a user, posts a form) must call `build` itself for a fresh one.
 *
 * The arguments are told apart by their JSON, so they must be plain data: a
 * function in them would compare equal to any other function, and is refused.
 */
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
