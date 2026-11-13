import { connectDatabase } from '@paybox/db';
import { loadConfig, readEnvironment } from './config';
import { JobRunner } from './jobs';
import { FakePaystackClient } from './provider/fake';
import { HttpPaystackClient } from './provider/http';
import { settlementHandlers } from './settlement';

const { db, pool } = connectDatabase(readEnvironment().DATABASE_URL);
const config = await loadConfig(db);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
  });
const client =
  config.PAYSTACK_MODE === 'fake'
    ? new FakePaystackClient(db, config.API_PUBLIC_URL, config.PAYSTACK_WEBHOOK_SECRETS.split(',')[0]!)
    : new HttpPaystackClient(config.PAYSTACK_SECRET_KEY);
const runner = new JobRunner(db, settlementHandlers(db, client, config), config.DEMO_MODE === 'true');
try {
  while (!stopping) {
    const count = await runner.tick();
    if (!count) await new Promise((resolve) => setTimeout(resolve, 500));
  }
} finally {
  await pool.end();
}
