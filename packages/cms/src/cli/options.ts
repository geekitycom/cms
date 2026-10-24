/** How one `--name` option is read off the command line. */
export interface OptionSpec {
  readonly name: string;
  /** How the option's value is read. Left out, the option is a switch: simply on or off. */
  readonly value?: ValueSpec | undefined;
}

export interface ValueSpec {
  /** What the refusal says when the value is missing. Defaults to `--<name> needs a value.` */
  readonly missing?: string;
  /**
   * Whether the word after the option is taken even when it starts with a
   * dash. Off, such a word is read as the next option and the value as missing.
   */
  readonly dashed?: true;
  /** Whether `--<name>=` with nothing after it is the empty string rather than a missing value. */
  readonly empty?: true;
}

/** One option as read: its name, its value or `true` for a switch, and how many words it took. */
export interface ReadOption {
  readonly name: string;
  readonly value: string | true;
  readonly words: 1 | 2;
}

/**
 * Read the option at `argv[index]`, which starts with `--`, by its spec: as
 * `--name`, `--name=value` or `--name value`. An option no spec names is
 * refused here rather than left to be read as a file name by whatever command
 * was running.
 */
export function readOption(
  argv: readonly string[],
  index: number,
  specs: readonly OptionSpec[],
): ReadOption {
  const arg = argv[index] as string;
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
  const inline = equals === -1 ? undefined : arg.slice(equals + 1);
  const spec = specs.find((entry) => entry.name === name);
  if (spec === undefined) {
    throw new Error(`Unknown option "--${name}". Run geekity --help to see what is available.`);
  }

  if (spec.value === undefined) {
    if (inline !== undefined) throw new Error(`--${name} takes no value.`);
    return { name, value: true, words: 1 };
  }

  const missing = spec.value.missing ?? `--${name} needs a value.`;
  if (inline !== undefined) {
    if (inline === '' && spec.value.empty !== true) throw new Error(missing);
    return { name, value: inline, words: 1 };
  }
  const next = argv[index + 1];
  if (next === undefined || (next.startsWith('-') && spec.value.dashed !== true)) {
    throw new Error(missing);
  }
  return { name, value: next, words: 2 };
}
