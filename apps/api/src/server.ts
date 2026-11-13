import { serve } from '@hono/node-server';
import { connectDatabase } from '@paybox/db';
import { createApp } from './app';
import { loadConfig, readEnvironment } from './config';
import { FakePaystackClient } from './provider/fake';
import { HttpPaystackClient } from './provider/http';

const { db, pool } = connectDatabase(readEnvironment().DATABASE_URL);
const config = await loadConfig(db);
const client =
  config.PAYSTACK_MODE === 'fake'
    ? new FakePaystackClient(db, config.API_PUBLIC_URL, config.PAYSTACK_WEBHOOK_SECRETS.split(',')[0]!)
    : new HttpPaystackClient(config.PAYSTACK_SECRET_KEY);
const { app } = createApp(db, client, config);
const server = serve({ fetch: app.fetch, port: config.PORT });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      void pool.end();
    }),
  );
