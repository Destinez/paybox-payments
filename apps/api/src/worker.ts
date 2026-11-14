import { connectDatabase } from '@paybox/db';
import { Cron } from 'croner';
import { loadConfig, readEnvironment } from './config';
import { enqueue, JobRunner } from './jobs';
import { FakePaystackClient } from './provider/fake';
import { HttpPaystackClient } from './provider/http';
import { Reconciliation } from './reconciliation';
import { settlementHandlers } from './settlement';
import { log } from './telemetry';

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
const recon = new Reconciliation(db, client);
const schedule = new Cron(config.RECON_CRON, { timezone: 'Africa/Lagos' }, async () => {
  await recon.start('scheduler', new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }));
});
const cleanup = new Cron('0 * * * *', async () => {
  await enqueue(db, 'purge_idempotency_keys', null, {}, `purge:${new Date().toISOString().slice(0, 13)}`);
});
const runner = new JobRunner(
  db,
  {
    ...settlementHandlers(db, client, config),
    reconcile_window: async (job) => {
      await recon.run(String(job.payload.run_id));
    },
  },
  config.DEMO_MODE === 'true',
);
log.info('Worker polling for durable jobs');
try {
  while (!stopping) {
    const count = await runner.tick();
    if (!count) await new Promise((resolve) => setTimeout(resolve, 500));
  }
} finally {
  schedule.stop();
  cleanup.stop();
  await pool.end();
}
