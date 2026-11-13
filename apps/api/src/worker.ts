import { connectDatabase, idempotencyKeys, sql } from '@paybox/db';
import { loadConfig, readEnvironment } from './config';
import { JobRunner } from './jobs';

const { db, pool } = connectDatabase(readEnvironment().DATABASE_URL);
const config = await loadConfig(db);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
  });
const runner = new JobRunner(
  db,
  {
    purge_idempotency_keys: async () => {
      await db
        .delete(idempotencyKeys)
        .where(sql`${idempotencyKeys.expiresAt}<now() AND ${idempotencyKeys.lockedUntil}<now()`);
    },
  },
  config.DEMO_MODE === 'true',
);
try {
  while (!stopping) {
    const count = await runner.tick();
    if (!count) await new Promise((resolve) => setTimeout(resolve, 500));
  }
} finally {
  await pool.end();
}
