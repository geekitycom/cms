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
