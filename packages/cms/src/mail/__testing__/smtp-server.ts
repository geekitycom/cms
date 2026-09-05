import net from 'node:net';

/**
 * Just enough SMTP to accept a message, on a loopback port of the operating
 * system's choosing.
 *
 * The SMTP provider is the one that cannot be proved against a stubbed
 * function: what is under test is that nodemailer, a real socket and a real
 * conversation put the message somewhere, and a stub of nodemailer would prove
 * only that this package can call it. So a test opens one of these instead —
 * offline, on an ephemeral port, gone at the end of the file — and reads back
 * the envelope and the bytes the server was actually given.
 *
 * It speaks the subset nodemailer uses over a plain connection: `EHLO`, `AUTH
 * PLAIN` and `AUTH LOGIN`, `MAIL FROM`, `RCPT TO`, `DATA` and `QUIT`. It never
 * advertises `STARTTLS`, so nodemailer stays on the plain socket rather than
 * trying to upgrade one that has no certificate behind it.
 */

/** One message the server accepted. */
export interface ReceivedMail {
  /** The address in `MAIL FROM`. */
  readonly from: string;
  /** Every address in a `RCPT TO`. */
  readonly to: readonly string[];
  /** The `DATA` block, headers and body, with the dot-stuffing undone. */
  readonly data: string;
  /** The credentials the client authenticated with, when it authenticated. */
  readonly auth?: { user: string; password: string } | undefined;
}

/** A running test server. */
export interface TestSmtpServer {
  /** The loopback port it is listening on. */
  readonly port: number;
  /** Every message it has accepted, in the order they arrived. */
  readonly received: readonly ReceivedMail[];
  /** The queue id it answers `DATA` with, which is what nodemailer reports back. */
  readonly queueId: string;
  /** Stop listening and drop every connection. */
  close(): Promise<void>;
}

/** What {@link startTestSmtpServer} may be told. */
export interface TestSmtpServerOptions {
  /**
   * Require the client to authenticate. On by default, since a test that does
   * not send credentials should find out here rather than against a stranger's
   * server.
   */
  requireAuth?: boolean | undefined;
  /**
   * Refuse the first `n` messages with a 451, so a test can watch the retry.
   * The refusal is at `DATA`, which is where a real server refuses a message
   * it has already agreed to take the envelope for.
   */
  failFirst?: number | undefined;
}

/** Start one. `await server.close()` when the file is done with it. */
export async function startTestSmtpServer(
  options: TestSmtpServerOptions = {},
): Promise<TestSmtpServer> {
  const received: ReceivedMail[] = [];
  const sockets = new Set<net.Socket>();
  const queueId = 'ABCDEF0123';
  let remainingFailures = options.failFirst ?? 0;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setEncoding('utf8');

    let buffer = '';
    let inData = false;
    let data = '';
    let from = '';
    let to: string[] = [];
    let auth: { user: string; password: string } | undefined;
    // The half-finished `AUTH LOGIN` exchange, which is three round trips.
    let pendingLogin: { stage: 'user' | 'password'; user: string } | undefined;

    const say = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    say('220 test.invalid ESMTP ready');

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            if (remainingFailures > 0) {
              remainingFailures -= 1;
              say('451 4.3.0 Try again later');
            } else {
              received.push({ from, to, data, auth });
              say(`250 2.0.0 Ok: queued as ${queueId}`);
            }
            data = '';
            from = '';
            to = [];
            continue;
          }
          // Undo the dot-stuffing RFC 5321 requires of a body line that
          // begins with one, so the test reads what was sent.
          data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          continue;
        }

        if (pendingLogin !== undefined) {
          const decoded = Buffer.from(line, 'base64').toString('utf8');
          if (pendingLogin.stage === 'user') {
            pendingLogin = { stage: 'password', user: decoded };
            say(`334 ${Buffer.from('Password:', 'utf8').toString('base64')}`);
          } else {
            auth = { user: pendingLogin.user, password: decoded };
            pendingLogin = undefined;
            say('235 2.7.0 Authentication successful');
          }
          continue;
        }

        const verb = (line.split(' ')[0] ?? '').toUpperCase();

        if (verb === 'EHLO' || verb === 'HELO') {
          // No STARTTLS: there is no certificate here, and nodemailer upgrades
          // a plain connection the moment a server says it could.
          say('250-test.invalid');
          say('250 AUTH PLAIN LOGIN');
        } else if (verb === 'AUTH') {
          const parts = line.split(' ');
          const mechanism = (parts[1] ?? '').toUpperCase();
          if (mechanism === 'PLAIN') {
            const payload = parts[2];
            if (payload === undefined) {
              say('334 ');
            } else {
              // `\0user\0password`, base64.
              const [, user = '', password = ''] = Buffer.from(payload, 'base64')
                .toString('utf8')
                .split('\0');
              auth = { user, password };
              say('235 2.7.0 Authentication successful');
            }
          } else if (mechanism === 'LOGIN') {
            pendingLogin = { stage: 'user', user: '' };
            say(`334 ${Buffer.from('Username:', 'utf8').toString('base64')}`);
          } else {
            say('504 5.5.4 Unrecognized authentication type');
          }
        } else if (verb === 'MAIL') {
          if (options.requireAuth !== false && auth === undefined) {
            say('530 5.7.0 Authentication required');
            continue;
          }
          from = addressIn(line);
          say('250 2.1.0 Ok');
        } else if (verb === 'RCPT') {
          to.push(addressIn(line));
          say('250 2.1.5 Ok');
        } else if (verb === 'DATA') {
          inData = true;
          say('354 End data with <CR><LF>.<CR><LF>');
        } else if (verb === 'QUIT') {
          say('221 2.0.0 Bye');
          socket.end();
        } else {
          // RSET, NOOP and anything else nodemailer decides to say. Agreeing
          // is closer to a real server than refusing, and none of them change
          // what this is proving.
          say('250 2.0.0 Ok');
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    port,
    received,
    queueId,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/** The address inside the angle brackets of a `MAIL FROM` or `RCPT TO`. */
function addressIn(line: string): string {
  const open = line.indexOf('<');
  const close = line.indexOf('>', open + 1);
  return open === -1 || close === -1 ? '' : line.slice(open + 1, close);
}
