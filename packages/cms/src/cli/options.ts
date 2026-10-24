export interface OptionSpec {
  readonly name: string;
  readonly value?: ValueSpec | undefined;
}

export interface ValueSpec {
  readonly missing?: string;
  readonly dashed?: true;
  readonly empty?: true;
}

export interface ReadOption {
  readonly name: string;
  readonly value: string | true;
  readonly words: 1 | 2;
}

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
