import { serve } from '@hono/node-server';
import { connectDatabase } from '@paybox/db';
import { Hono } from 'hono';
import { loadConfig, readEnvironment } from './config';
import { FakePaystackClient } from './provider/fake';
import { fakeRoutes } from './provider/routes';

const { db, pool } = connectDatabase(readEnvironment().DATABASE_URL);
const config = await loadConfig(db);
const app = new Hono();
app.get('/healthz', (c) => c.json({ status: 'ok' }));
if (config.PAYSTACK_MODE === 'fake')
  app.route(
    '/fake',
    fakeRoutes(
      new FakePaystackClient(db, config.API_PUBLIC_URL, config.PAYSTACK_WEBHOOK_SECRETS.split(',')[0]!),
      async () => {},
    ),
  );
const server = serve({ fetch: app.fetch, port: config.PORT });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      void pool.end();
    }),
  );
