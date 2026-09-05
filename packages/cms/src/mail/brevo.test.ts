import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BREVO_ENDPOINT, createBrevoProvider } from './brevo.ts';

/** One call the stubbed endpoint saw. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A `fetch` that records what it was asked and answers with `answer`. */
function stub(answer: () => Response): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];

  const client = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    calls.push({
      url,
      method: init?.method,
      headers,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    return Promise.resolve(answer());
  }) as typeof fetch;

  return { calls, fetch: client };
}

const MESSAGE = {
  from: { name: 'A Site', address: 'site@example.com' },
  to: [{ address: 'ada@example.com' }],
  replyTo: { address: 'hello@example.com' },
  subject: 'A test',
  text: 'Words.',
  html: '<p>Words.</p>',
};

describe('the Brevo provider', () => {
  it('posts the documented fields to the transactional endpoint', async () => {
    const { calls, fetch } = stub(
      () => new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 }),
    );

    const delivery = await createBrevoProvider({ apiKey: 'key-123', fetch }).deliver(MESSAGE);

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call !== undefined);
    assert.equal(call.url, BREVO_ENDPOINT);
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['api-key'], 'key-123');
    assert.equal(call.headers['content-type'], 'application/json');
    assert.deepEqual(call.body, {
      sender: { name: 'A Site', email: 'site@example.com' },
      to: [{ email: 'ada@example.com' }],
      replyTo: { email: 'hello@example.com' },
      subject: 'A test',
      textContent: 'Words.',
      htmlContent: '<p>Words.</p>',
    });
    assert.equal(delivery.messageId, '<abc@brevo>');
  });

  it('names the provider it is', () => {
    assert.equal(createBrevoProvider({ apiKey: 'key-123' }).name, 'brevo');
  });

  it('leaves out the fields the message did not carry', async () => {
    const { calls, fetch } = stub(() => new Response('{}', { status: 201 }));

    await createBrevoProvider({ apiKey: 'key-123', fetch }).deliver({
      from: { address: 'site@example.com' },
      to: [{ address: 'ada@example.com' }],
      subject: 'A test',
      text: 'Words.',
    });

    const body = calls[0]?.body ?? {};
    assert.deepEqual(body['sender'], { email: 'site@example.com' });
    assert.equal('replyTo' in body, false);
    assert.equal('htmlContent' in body, false);
  });

  it('throws what Brevo said when it refuses the message', async () => {
    const { fetch } = stub(
      () =>
        new Response(JSON.stringify({ code: 'invalid_parameter', message: 'sender is missing' }), {
          status: 400,
        }),
    );

    await assert.rejects(
      () => createBrevoProvider({ apiKey: 'key-123', fetch }).deliver(MESSAGE),
      /400.*sender is missing/s,
    );
  });
});
