import { eq, fakeTransactions } from '@paybox/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { FakePaystackClient } from './fake';

export function fakeRoutes(
  client: FakePaystackClient,
  webhook: (body: string, signature: string) => Promise<void>,
  receiverUrl = 'http://127.0.0.1:4100',
) {
  const app = new Hono();
  app.get('/info', (c) => c.json({ mode: 'fake', receiver_url: receiverUrl }));
  app.get('/checkout/:reference', async (c) => {
    const payment = await client.verify(c.req.param('reference'));
    const reference = encodeURIComponent(payment.reference);
    return c.html(
      `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Paybox test checkout</title><style>body{font:16px system-ui;background:#f6f7f9;color:#172b29;max-width:440px;margin:12vh auto;padding:30px}section{background:white;padding:32px;border:1px solid #dce3e0;border-radius:16px}button{background:#176750;color:white;border:0;border-radius:8px;padding:14px 24px;font:inherit;cursor:pointer}a{color:#176750}</style><section><p>PAYBOX / TEST CHECKOUT</p><h1>Complete your payment</h1><p>NGN ${(BigInt(payment.amount) / 100n).toLocaleString('en-NG')}.${String(BigInt(payment.amount) % 100n).padStart(2, '0')}</p><p>This processor is local. No card details are collected.</p><form method="post" action="/fake/checkout/${reference}/succeed"><button>Succeed</button></form><p><a href="/fake/checkout/${reference}/fail">Decline payment</a></p></section></html>`,
    );
  });
  app.post('/checkout/:reference/succeed', async (c) => {
    const body = JSON.stringify(await client.settle(c.req.param('reference')));
    await webhook(body, client.sign(body));
    return c.html(
      '<!doctype html><html lang="en"><title>Payment complete</title><h1>Payment complete</h1><p>You can return to the dashboard. Verification is being processed.</p><a href="http://localhost:3000">Return to Paybox</a></html>',
    );
  });
  app.get('/checkout/:reference/fail', async (c) => {
    await client.settle(c.req.param('reference'), 'failed');
    return c.json({ status: 'failed' });
  });
  app.post('/control', async (c) => {
    const input = z
      .object({
        reference: z.string(),
        drift: z.number().int().optional(),
        delay_ms: z.number().int().min(0).max(10100).optional(),
        failures: z.number().int().min(0).max(100).optional(),
        duplicate: z.number().int().min(0).max(10).optional(),
        settle: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const [row] = await client.db
      .update(fakeTransactions)
      .set({
        reference: input.reference,
        drift: input.drift,
        delayMs: input.delay_ms,
        failuresRemaining: input.failures,
        ...(input.settle ? { status: 'success' } : {}),
      })
      .where(eq(fakeTransactions.reference, input.reference))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (input.duplicate) {
      const body = JSON.stringify({
        event: 'charge.success',
        data: {
          id: BigInt(`0x${row.id.replaceAll('-', '').slice(-15)}`).toString(),
          reference: row.reference,
          status: 'success',
          amount: row.amount,
          currency: row.currency,
        },
      });
      for (let i = 0; i < input.duplicate; i++) await webhook(body, client.sign(body));
    }
    return c.json({ updated: true });
  });
  return app;
}
