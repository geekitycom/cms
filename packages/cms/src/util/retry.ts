export interface RetryOptions {
  attempts: number;
  backoffMs: (attempt: number) => number;
  wait?: ((ms: number) => Promise<void>) | undefined;
}

export interface Tried<T> {
  readonly value: T;
  readonly retry: boolean;
}

export async function retry<T>(
  options: RetryOptions,
  attemptOnce: (attempt: number) => Promise<Tried<T>>,
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const wait = options.wait ?? sleep;
  for (let attempt = 1; ; attempt += 1) {
    const tried = await attemptOnce(attempt);
    if (!tried.retry || attempt >= attempts) return tried.value;
    await wait(options.backoffMs(attempt));
  }
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
