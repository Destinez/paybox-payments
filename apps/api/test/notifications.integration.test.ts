import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq, merchants, outboxJobs } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { decrypt } from '../src/crypto';
import { JobRunner } from '../src/jobs';
import { settlementHandlers, verifyPayment } from '../src/settlement';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('signed merchant notifications retry into the DLQ and replay with a stable event id', async () => {
  const f = await fixture(db);
  let fail = true;
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(Buffer.concat(chunks).toString());
    headers.push(req.headers as Record<string, string>);
    res.writeHead(fail ? 500 : 200).end();
  });
  await new Promise<void>((resolve) => server.listen(4100, '127.0.0.1', resolve));
  try {
    const endpoint = await f.app.request('/v1/webhook-endpoint', {
      method: 'PUT',
      headers: f.headers,
      body: JSON.stringify({ url: 'http://127.0.0.1:4100/webhook' }),
    });
    expect(endpoint.status).toBe(200);
    const configured = JSON.parse(await endpoint.text());
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, f.merchant.id));
    expect(merchant?.webhookSecretEnc).not.toBe(configured.secret);
    expect(decrypt(merchant!.webhookSecretEnc!, f.config.DATA_KEY)).toBe(configured.secret);
    const created = await f.service.create(f.merchant.id, 'pay', {
      amount: 1500000,
      customer: { email: 'ada@example.com' },
    });
    const payment = await f.service.find(String(created.body.id));
    await f.client.settle(payment.reference);
    await verifyPayment(db, f.client, payment.id);
    const runner = new JobRunner(db, settlementHandlers(db, f.client, f.config), true);
    for (let i = 0; i < 8; i++) {
      await db.update(outboxJobs).set({ runAfter: new Date(0) });
      await runner.tick();
    }
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.type, 'notify_merchant'));
    expect(job?.status).toBe('dead');
    fail = false;
    await runner.replay(job!.id, 'ops@example.com');
    await runner.tick();
    expect((await db.select().from(outboxJobs))[0]?.status).toBe('succeeded');
    expect(new Set(bodies).size).toBe(1);
    expect(bodies).toHaveLength(9);
    for (let i = 0; i < headers.length; i++) {
      const signature = headers[i]!['paybox-signature']!;
      const timestamp = signature.split(',')[0]!.slice(2);
      expect(signature).toBe(
        `t=${timestamp},v1=${createHmac('sha512', configured.secret).update(`${timestamp}.${bodies[i]}`).digest('hex')}`,
      );
      expect(headers[i]!['paybox-correlation-id']).toBe(payment.correlationId);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
