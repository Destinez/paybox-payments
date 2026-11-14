import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  eq,
  fakeSettings,
  fakeSettlements,
  journalEntries,
  ledgerAccounts,
  ledgerLines,
  merchants,
  newId,
  outboxJobs,
  sql,
  x402Payments,
} from '@paybox/db';
import { x402Client } from '@x402/core/client';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { PaymentRequiredV2Schema } from '@x402/core/schemas';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { JobRunner } from '../src/jobs';
import { settlementHandlers } from '../src/settlement';
import { finalizeX402 } from '../src/x402/accounting';
import { USDC_ADDRESS, X402_NETWORK } from '../src/x402/protocol';
import { verifyUpstream } from '../src/x402/upstream';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture, operatorFixture } from './fixtures';

const json = async (response: Response) => JSON.parse(await response.text());
let server: Server;
let upstreamStatus = 200,
  upstreamCalls = 0,
  secret = '';
let verifiedHeader: Record<string, unknown> | null = null;
const notifications: { body: string; signature: string }[] = [];
beforeAll(async () => {
  await setupDatabase();
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/webhook') {
      notifications.push({
        body: Buffer.concat(chunks).toString(),
        signature: String(req.headers['paybox-signature']),
      });
      res.writeHead(200).end('{}');
      return;
    }
    upstreamCalls++;
    verifiedHeader = verifyUpstream(String(req.headers['paybox-x402-payment']), secret);
    res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' }).end('{"stock":42}');
  });
  await new Promise<void>((resolve) => server.listen(4100, '127.0.0.1', resolve));
});
beforeEach(async () => {
  await resetDatabase();
  upstreamStatus = 200;
  upstreamCalls = 0;
  verifiedHeader = null;
  notifications.length = 0;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
async function setup() {
  const f = await fixture(db);
  const destination = privateKeyToAccount(generatePrivateKey());
  const input = {
    method: 'GET',
    path: '/v1/stock',
    upstream_url: 'http://127.0.0.1:4100/stock',
    price: '10000',
    pay_to: destination.address,
    description: 'Stock availability',
  };
  const response = await f.app.request('/v1/x402/routes', {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  const route = await json(response);
  secret = route.signing_secret;
  const url = route.gateway_path;
  const challengeResponse = await f.app.request(url);
  const challenge = decodePaymentRequiredHeader(challengeResponse.headers.get('PAYMENT-REQUIRED')!);
  const payer = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client().register(X402_NETWORK, new ExactEvmScheme(payer));
  const payload = await client.createPaymentPayload(challenge);
  const header = encodePaymentSignatureHeader(payload);
  const pay = () => f.app.request(url, { headers: { 'PAYMENT-SIGNATURE': header } });
  return { ...f, input, route, url, challenge, challengeResponse, payer, payload, header, pay };
}
it('unpaid request returns a valid v2 PAYMENT-REQUIRED challenge', async () => {
  const f = await setup();
  expect(f.challengeResponse.status).toBe(402);
  expect(PaymentRequiredV2Schema.safeParse(f.challenge).success).toBe(true);
  expect(f.challenge.accepts[0]).toMatchObject({
    amount: '10000',
    network: X402_NETWORK,
    asset: USDC_ADDRESS,
    scheme: 'exact',
  });
  expect(await db.select().from(x402Payments)).toHaveLength(0);
});
it('paid request signs the upstream, returns a receipt, and books balanced USDC independently from NGN', async () => {
  const f = await setup();
  const response = await f.pay();
  expect(response.status).toBe(200);
  expect(await json(response)).toEqual({ stock: 42 });
  expect(verifiedHeader).toMatchObject({
    amount: '10000',
    payer: f.payer.address,
    status: 'verified',
    asset: 'USDC',
  });
  expect(decodePaymentResponseHeader(response.headers.get('PAYMENT-RESPONSE')!)).toMatchObject({
    success: true,
    network: X402_NETWORK,
  });
  const rows = await db
    .select({
      currency: ledgerAccounts.currency,
      direction: ledgerLines.direction,
      amount: ledgerLines.amount,
    })
    .from(ledgerLines)
    .innerJoin(ledgerAccounts, eq(ledgerLines.accountId, ledgerAccounts.id));
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.currency === 'USDC')).toBe(true);
  expect(rows.reduce((sum, row) => sum + (row.direction === 'debit' ? row.amount : -row.amount), 0)).toBe(0);
  const books = await json(await f.app.request('/v1/x402/payments', { headers: f.headers }));
  expect(books.books).toEqual({ NGN: '0', USDC: '10000' });
});
it('reused payment returns payment_already_used and concurrent double-submit settles once', async () => {
  const f = await setup();
  await db.insert(fakeSettings).values({ id: 'x402_controls', value: { settle_delay_ms: 100 } });
  const responses = await Promise.all(Array.from({ length: 12 }, f.pay));
  expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 402)).toHaveLength(11);
  for (const response of responses.filter((r) => r.status === 402))
    expect((await json(response)).code).toBe('payment_already_used');
  expect((await json(await f.pay())).code).toBe('payment_already_used');
  expect(upstreamCalls).toBe(1);
  expect(await db.select().from(fakeSettlements)).toHaveLength(1);
  expect(await db.select().from(journalEntries)).toHaveLength(1);
});
it('upstream 5xx does not settle or post a ledger entry', async () => {
  const f = await setup();
  upstreamStatus = 503;
  expect((await f.pay()).status).toBe(503);
  expect(await db.select().from(fakeSettlements)).toHaveLength(0);
  expect(await db.select().from(journalEntries)).toHaveLength(0);
  expect((await db.select().from(x402Payments))[0]?.status).toBe('upstream_failed');
});
it('settlement failure returns 502 and settlement_failed with no ledger entry', async () => {
  const f = await setup();
  await db.insert(fakeSettings).values({ id: 'x402_controls', value: { settle_fail: true } });
  const response = await f.pay();
  expect(response.status).toBe(502);
  expect((await json(response)).code).toBe('settlement_failed');
  expect((await db.select().from(x402Payments))[0]?.status).toBe('settlement_failed');
  expect(await db.select().from(journalEntries)).toHaveLength(0);
});
it('invalid signatures and facilitator verification failures never call the upstream', async () => {
  const f = await setup();
  const response = await f.app.request(f.url, {
    headers: {
      'PAYMENT-SIGNATURE': encodePaymentSignatureHeader({
        ...f.payload,
        payload: { ...f.payload.payload, signature: `0x${'ab'.repeat(65)}` },
      }),
    },
  });
  expect((await json(response)).code).toBe('payment_invalid');
  await db.insert(fakeSettings).values({ id: 'x402_controls', value: { verify_fail: true } });
  expect((await f.pay()).status).toBe(402);
  expect(upstreamCalls).toBe(0);
  expect(await db.select().from(x402Payments)).toHaveLength(0);
});
it('x402.payment.settled is delivered through the existing outbox with a valid merchant signature', async () => {
  const f = await setup();
  await db
    .update(merchants)
    .set({ webhookUrl: 'http://127.0.0.1:4100/webhook' })
    .where(eq(merchants.id, f.merchant.id));
  expect((await f.pay()).status).toBe(200);
  const runner = new JobRunner(db, settlementHandlers(db, f.client, f.config));
  await runner.tick();
  expect(notifications).toHaveLength(1);
  const { body, signature } = notifications[0]!;
  const t = signature.split(',')[0]!.slice(2);
  expect(signature).toBe(`t=${t},v1=${createHmac('sha512', secret).update(`${t}.${body}`).digest('hex')}`);
  expect(JSON.parse(body)).toMatchObject({
    type: 'x402.payment.settled',
    data: { asset: 'USDC', amount: '10000' },
  });
  expect((await db.select().from(outboxJobs)).every((j) => j.status === 'succeeded')).toBe(true);
});
it('persisted settlement receipts recover accounting after a database posting failure without repeating settlement', async () => {
  const f = await setup();
  await db.execute(
    sql`CREATE FUNCTION fail_x402_posting() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='x402_settlement' THEN RAISE EXCEPTION 'simulated posting failure'; END IF; RETURN NEW; END; $$`,
  );
  await db.execute(
    sql`CREATE TRIGGER fail_x402_posting BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION fail_x402_posting()`,
  );
  try {
    expect((await f.pay()).status).toBe(500);
    expect((await db.select().from(x402Payments))[0]?.status).toBe('confirmed');
    expect(await db.select().from(journalEntries)).toHaveLength(0);
  } finally {
    await db.execute(sql`DROP TRIGGER fail_x402_posting ON journal_entries`);
    await db.execute(sql`DROP FUNCTION fail_x402_posting()`);
  }
  const runner = new JobRunner(db, settlementHandlers(db, f.client, f.config));
  await runner.tick();
  const [payment] = await db.select().from(x402Payments);
  expect(payment?.status).toBe('settled');
  await Promise.all([finalizeX402(db, payment!.id), finalizeX402(db, payment!.id)]);
  expect(await db.select().from(journalEntries)).toHaveLength(1);
  expect(await db.select().from(fakeSettlements)).toHaveLength(1);
});
it('database rejects mixed currency entries and account relabeling', async () => {
  const f = await setup();
  await f.pay();
  await expect(db.update(ledgerAccounts).set({ currency: 'NGN' })).rejects.toThrow();
  await expect(
    db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(journalEntries)
        .values({ kind: 'invalid', currency: 'NGN', idempotencyRef: newId() })
        .returning();
      const [account] = await tx.select().from(ledgerAccounts);
      await tx
        .insert(ledgerLines)
        .values({ entryId: entry!.id, accountId: account!.id, direction: 'debit', amount: 1 });
    }),
  ).rejects.toThrow();
});
it('route CRUD is merchant-scoped, audited, and protected by dashboard roles', async () => {
  const f = await setup(),
    other = await fixture(db);
  expect(
    (
      await other.app.request(`/v1/x402/routes/${f.route.id}`, {
        method: 'PUT',
        headers: other.headers,
        body: JSON.stringify(f.input),
      })
    ).status,
  ).toBe(404);
  const viewer = await operatorFixture(db, f.config, 'viewer');
  expect(
    (
      await f.app.request(`/v1/admin/x402/routes/${f.route.id}`, {
        method: 'DELETE',
        headers: viewer.headers,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.app.request(`/v1/x402/routes/${f.route.id}`, {
        method: 'PUT',
        headers: f.headers,
        body: JSON.stringify({ ...f.input, price: '20000' }),
      })
    ).status,
  ).toBe(200);
  expect(
    (await f.app.request(`/v1/x402/routes/${f.route.id}`, { method: 'DELETE', headers: f.headers })).status,
  ).toBe(200);
  expect((await f.app.request(f.url)).status).toBe(404);
  const audit = await db.execute(sql`SELECT * FROM audit_log WHERE target_type='x402_route'`);
  expect(audit.rows).toHaveLength(3);
});
