/**
 * One gemini:// request for scripts/docker-smoke.sh, run with the image's own
 * node inside the container under test, so the smoke test needs no Gemini
 * client on the machine running it. With a client address, the request opens
 * with a PROXY protocol v1 header naming it, as a layer-4 proxy writes one.
 * Prints the response header line, and exits non-zero when there is none.
 *
 *   node gemini-request.mjs <port> <url> [client address]
 */

import net from 'node:net';
import tls from 'node:tls';

const [port = '1965', url = 'gemini://localhost/', client] = process.argv.slice(2);
const host = new URL(url).hostname;

const raw = net.connect(Number(port), '127.0.0.1');
if (client !== undefined) raw.write(`PROXY TCP4 ${client} 127.0.0.1 51000 ${port}\r\n`);
const socket = tls.connect({ socket: raw, servername: host, rejectUnauthorized: false }, () =>
  socket.write(`${url}\r\n`),
);
const chunks = [];
socket.on('data', (chunk) => chunks.push(chunk));
socket.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
socket.on('close', () => {
  const answer = Buffer.concat(chunks).toString('utf8');
  const end = answer.indexOf('\r\n');
  if (end < 0) process.exit(1);
  console.log(answer.slice(0, end));
});
setTimeout(() => {
  console.error('no answer in 10 seconds');
  process.exit(1);
}, 10_000).unref();
