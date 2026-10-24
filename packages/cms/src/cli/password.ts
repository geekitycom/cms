import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

type PasswordInput = NodeJS.ReadableStream & {
  isTTY?: boolean | undefined;
  isRaw?: boolean | undefined;
  setRawMode?: (mode: boolean) => unknown;
};

export interface ReadPasswordOptions {
  input?: PasswordInput;
  output?: NodeJS.WritableStream;
  prompt?: string;
}

/**
 * Two things would otherwise echo the password, and both are turned off: the
 * terminal driver, silenced by raw mode, and readline, whose output goes to a
 * writable that keeps nothing. Readline happens to set raw mode itself, but it
 * is set here as well rather than relied on. Raw mode also means readline sees
 * Ctrl-C as a byte rather than a signal, so it is turned back into a
 * cancellation here.
 */
export async function readPassword(options: ReadPasswordOptions = {}): Promise<string> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  const terminal = input.isTTY === true;

  if (terminal && options.prompt !== undefined) output.write(options.prompt);

  const wasRaw = input.isRaw === true;
  if (terminal) input.setRawMode?.(true);

  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const reader = createInterface({ input, output: muted, terminal });
  let cancelled = false;
  reader.on('SIGINT', () => {
    cancelled = true;
    reader.close();
  });

  try {
    for await (const line of reader) {
      if (!cancelled) return line;
      break;
    }
  } finally {
    reader.close();
    if (terminal) {
      input.setRawMode?.(wasRaw);
      // The terminal is left on the line the swallowed newline never printed.
      output.write('\n');
    }
    input.pause();
  }

  if (cancelled) throw new Error('Cancelled; no user was created.');

  throw new Error(
    'No password was given: standard input ended before a line arrived. Pass --password, or ' +
      'pipe the password in as a single line.',
  );
}
