import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import {
  apiKeys,
  type Database,
  dashboardUsers,
  eq,
  fakeSettings,
  fakeTransactions,
  merchants,
  payments,
  x402Routes,
} from '@paybox/db';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Config } from './config';
import { sha256 } from './crypto';
import { Payments } from './payments';
import { FakePaystackClient } from './provider/fake';
import { Reconciliation } from './reconciliation';
import { verifyPayment } from './settlement';
import { USDC_ADDRESS, X402_NETWORK } from './x402/protocol';

export async function seedDemo(db: Database, config: Config) {
  if (config.PAYSTACK_MODE !== 'fake') throw new Error('Demo fixtures require fake mode');
  const [existing] = await db.select().from(fakeSettings).where(eq(fakeSettings.id, 'demo_credentials'));
  let credentials: {
    email: string;
    password: string;
    viewer_email: string;
    viewer_password: string;
    api_key: string;
    merchant_id: string;
  };
  if (existing) credentials = existing.value as typeof credentials;
  else {
    const [merchant] = await db
      .insert(merchants)
      .values({ name: 'Ada Studio · Lagos', slug: 'demo-store' })
      .returning();
    const password = randomBytes(18).toString('base64url'),
      viewerPassword = randomBytes(18).toString('base64url'),
      key = `pbx_test_sk_${randomBytes(24).toString('hex')}`;
    await db.insert(dashboardUsers).values([
      { email: 'obaro@paybox.local', passwordHash: await hash(password), role: 'admin' },
      { email: 'finance@paybox.local', passwordHash: await hash(viewerPassword), role: 'viewer' },
    ]);
    await db
      .insert(apiKeys)
      .values({ merchantId: merchant!.id, prefix: key.slice(0, 24), keyHash: sha256(key) });
    credentials = {
      email: 'obaro@paybox.local',
      password,
      viewer_email: 'finance@paybox.local',
      viewer_password: viewerPassword,
      api_key: key,
      merchant_id: merchant!.id,
    };
    await db.insert(fakeSettings).values({ id: 'demo_credentials', value: credentials });
  }
  await db.update(merchants).set({ slug: 'demo-store' }).where(eq(merchants.id, credentials.merchant_id));
  await db
    .insert(x402Routes)
    .values({
      merchantId: credentials.merchant_id,
      method: 'GET',
      path: '/v1/stock',
      upstreamUrl: `${process.env.DEMO_RECEIVER_URL ?? 'http://127.0.0.1:4100'}/stock`,
      price: 10000,
      asset: USDC_ADDRESS,
      network: X402_NETWORK,
      payTo: privateKeyToAccount(generatePrivateKey()).address,
      description: 'Stock availability',
    })
    .onConflictDoNothing();
  const client = new FakePaystackClient(
    db,
    config.API_PUBLIC_URL,
    config.PAYSTACK_WEBHOOK_SECRETS.split(',')[0]!,
  );
  const service = new Payments(db, client, config);
  const names = ['ada', 'tunde', 'chioma', 'emeka', 'zainab', 'bisi', 'toyin', 'chidi'];
  for (let day = 13; day >= 0; day--)
    for (let index = 0; index < 3 + (day % 3); index++) {
      const reference = `PBX-${String(1040 + (13 - day) * 5 + index)}`;
      const [exists] = await db.select().from(payments).where(eq(payments.reference, reference));
      if (exists) continue;
      const amount = [1500000, 4850000, 2500000, 875000, 1220000, 3250000][(day + index) % 6]!;
      const result = await service.create(credentials.merchant_id, `seed:${reference}`, {
        amount,
        currency: 'NGN',
        reference,
        customer: { email: `${names[(day + index) % names.length]}@example.com` },
        metadata: { description: 'Demo order' },
      });
      const payment = await service.find(String(result.body.id));
      const created = new Date(Date.now() - day * 86400000 - index * 600000);
      await db.update(payments).set({ createdAt: created }).where(eq(payments.id, payment.id));
      if (day === 0 && index === 1) continue;
      await client.settle(reference, day % 5 === 2 && index === 0 ? 'failed' : 'success');
      await db
        .update(fakeTransactions)
        .set({ fees: Math.min(200000, Number((BigInt(amount) * 15n) / 1000n + 10000n)) })
        .where(eq(fakeTransactions.reference, reference));
      await verifyPayment(db, client, payment.id);
    }
  const recon = new Reconciliation(db, client);
  const run = await recon.start('demo_seed', 'initial-demo');
  await recon.run(run.id);
  return credentials;
}
