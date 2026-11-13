import { randomBytes } from 'node:crypto';
import { apiKeys, type Database, merchants } from '@paybox/db';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { sha256 } from '../src/crypto';
import { FakePaystackClient } from '../src/provider/fake';
export async function fixture(db: Database) {
  const [merchant] = await db.insert(merchants).values({ name: 'Ada Studio' }).returning();
  const key = `pbx_test_sk_${randomBytes(24).toString('hex')}`;
  await db
    .insert(apiKeys)
    .values({ merchantId: merchant!.id, prefix: key.slice(0, 24), keyHash: sha256(key) });
  const config = await loadConfig(db, { PAYSTACK_MODE: 'fake', DEMO_MODE: 'true' });
  const client = new FakePaystackClient(
    db,
    config.API_PUBLIC_URL,
    config.PAYSTACK_WEBHOOK_SECRETS.split(',')[0]!,
  );
  return {
    ...createApp(db, client, config),
    client,
    config,
    merchant: merchant!,
    key,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}
