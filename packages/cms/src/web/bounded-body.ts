/**
 * Read a request body as text, or `undefined` when it is longer than `max`
 * bytes, by its `Content-Length` or by the bytes that arrive.
 */
export async function readBounded(request: Request, max: number): Promise<string | undefined> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return undefined;
  if (request.body === null) return '';

  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  let read = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      read += chunk.value.length;
      if (read > max) return undefined;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

/**
 * Read a form body, urlencoded or multipart, as its text fields. `too-large`
 * when it is longer than `max` bytes, and `malformed` when it does not parse
 * as the type it says it is.
 */
export async function readBoundedForm(
  request: Request,
  max: number,
): Promise<Record<string, string> | 'too-large' | 'malformed'> {
  const text = await readBounded(request, max);
  if (text === undefined) return 'too-large';

  let parsed: FormData;
  try {
    parsed = await new Response(text, {
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
    }).formData();
  } catch {
    return 'malformed';
  }

  const fields: Record<string, string> = {};
  for (const [name, value] of parsed) {
    if (typeof value === 'string') fields[name] = value;
  }
  return fields;
}
