import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

let fail = false;
let secret = process.env.MERCHANT_WEBHOOK_SECRET ?? '';
const receipts = new Map();
const server = createServer(async (req, res) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/control' && req.method === 'POST') {
    try {
      const input = JSON.parse(body.toString());
      if (typeof input.fail === 'boolean') fail = input.fail;
      if (typeof input.secret === 'string') secret = input.secret;
      res.end(JSON.stringify({ fail }));
    } catch {
      res.writeHead(400).end('{}');
    }
    return;
  }
  if (req.url === '/status') {
    res.end(JSON.stringify({ fail, received: receipts.size, events: [...receipts.values()] }));
    return;
  }
  if (req.url !== '/webhook' || req.method !== 'POST') {
    res.writeHead(404).end('{}');
    return;
  }
  const signature = req.headers['paybox-signature'];
  const match = typeof signature === 'string' ? /^t=(\d+),v1=([a-f0-9]{128})$/.exec(signature) : null;
  if (!secret || !match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) {
    res.writeHead(401).end('{}');
    return;
  }
  const expected = createHmac('sha512', secret).update(`${match[1]}.`).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(match[2], 'hex'))) {
    res.writeHead(401).end('{}');
    return;
  }
  if (fail) {
    res.writeHead(500).end('{"error":"demo_failure"}');
    return;
  }
  try {
    const event = JSON.parse(body.toString());
    receipts.set(event.id, {
      id: event.id,
      type: event.type,
      correlation_id: req.headers['paybox-correlation-id'],
    });
    res.end('{"received":true}');
  } catch {
    res.writeHead(400).end('{}');
  }
});
server.listen(Number(process.env.PORT ?? 4100), '0.0.0.0', () =>
  console.info('Merchant receiver listening on port 4100'),
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
