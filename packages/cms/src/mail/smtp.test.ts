import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startTestSmtpServer } from './__testing__/smtp-server.ts';
import type { TestSmtpServer } from './__testing__/smtp-server.ts';
import { createSmtpProvider } from './smtp.ts';

/**
 * The SMTP provider against a server that really answers.
 *
 * Loopback, on a port the operating system picks, and gone at the end of the
 * file: nothing here reaches the network, and nothing here is slow.
 */

let server: TestSmtpServer;

before(async () => {
  server = await startTestSmtpServer();
});

after(async () => {
  await server.close();
});

describe('the SMTP provider', () => {
  it('delivers the message to the configured server', async () => {
    const provider = createSmtpProvider({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      user: 'postmaster',
      password: 'hunter2',
    });

    const delivery = await provider.deliver({
      from: { name: 'A Site', address: 'site@example.com' },
      to: [{ address: 'ada@example.com' }],
      replyTo: { address: 'hello@example.com' },
      subject: 'A test',
      text: 'Words.',
      html: '<p>Words.</p>',
    });

    assert.equal(provider.name, 'smtp');
    assert.equal(server.received.length, 1);

    const message = server.received[0];
    assert.ok(message !== undefined);
    assert.equal(message.from, 'site@example.com');
    assert.deepEqual(message.to, ['ada@example.com']);
    assert.deepEqual(message.auth, { user: 'postmaster', password: 'hunter2' });
    assert.match(message.data, /^From: "?A Site"? <site@example\.com>/m);
    assert.match(message.data, /^To: ada@example\.com/m);
    assert.match(message.data, /^Reply-To: hello@example\.com/m);
    assert.match(message.data, /^Subject: A test/m);
    assert.match(message.data, /Words\./);
    assert.match(message.data, /<p>Words\.<\/p>/);

    assert.ok(delivery.messageId !== undefined && delivery.messageId !== '');
  });

  it('throws when the server refuses the message', async () => {
    const refusing = await startTestSmtpServer({ failFirst: 1 });
    try {
      await assert.rejects(
        () =>
          createSmtpProvider({
            host: '127.0.0.1',
            port: refusing.port,
            secure: false,
            user: 'postmaster',
            password: 'hunter2',
          }).deliver({
            from: { address: 'site@example.com' },
            to: [{ address: 'ada@example.com' }],
            subject: 'A test',
            text: 'Words.',
          }),
        /451/,
      );
    } finally {
      await refusing.close();
    }
  });
});
