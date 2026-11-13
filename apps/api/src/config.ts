import { randomBytes } from 'node:crypto';
import { type Database, eq, fakeSettings } from '@paybox/db';
import { z } from 'zod';

const environment = z.object({
  PAYSTACK_MODE: z.enum(['fake', 'test']).default('fake'),
  PAYSTACK_SECRET_KEY: z.string().default(''),
  PAYSTACK_WEBHOOK_SECRETS: z.string().default(''),
  PAYSTACK_ACCEPT_LEGACY_SIGNATURE: z.enum(['true', 'false']).default('false'),
  SESSION_SECRET: z.string().default(''),
  DATA_KEY: z.string().default(''),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().default('postgres://paybox:paybox@localhost:5433/paybox'),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  RECON_CRON: z.string().default('0 2 * * *'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});
export function readEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const config = environment.parse(env);
  if (config.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) throw new Error('Live keys are prohibited');
  if (config.PAYSTACK_MODE === 'test') {
    if (!/^sk_test_.+/.test(config.PAYSTACK_SECRET_KEY)) throw new Error('A Paystack test key is required');
    if (
      !config.PAYSTACK_WEBHOOK_SECRETS.split(',').every((s) => /^whsec_.+/.test(s)) ||
      !config.PAYSTACK_WEBHOOK_SECRETS
    )
      throw new Error('Webhook signing secrets are required');
    if (config.SESSION_SECRET.length < 32)
      throw new Error('SESSION_SECRET must contain at least 32 characters');
    if (Buffer.from(config.DATA_KEY, 'base64').length !== 32)
      throw new Error('DATA_KEY must encode exactly 32 bytes');
  }
  return config;
}
export type Config = ReturnType<typeof readEnvironment>;
export async function loadConfig(db: Database, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const config = readEnvironment(env);
  if (config.PAYSTACK_MODE === 'fake') {
    await db
      .insert(fakeSettings)
      .values({
        id: 'development_secrets',
        value: {
          session: randomBytes(32).toString('hex'),
          data: randomBytes(32).toString('base64'),
          webhook: `whsec_${randomBytes(32).toString('hex')}`,
        },
      })
      .onConflictDoNothing();
    const [stored] = await db.select().from(fakeSettings).where(eq(fakeSettings.id, 'development_secrets'));
    config.SESSION_SECRET ||= String(stored!.value.session);
    config.DATA_KEY ||= String(stored!.value.data);
    config.PAYSTACK_WEBHOOK_SECRETS ||= String(stored!.value.webhook);
  }
  if (config.SESSION_SECRET.length < 32 || Buffer.from(config.DATA_KEY, 'base64').length !== 32)
    throw new Error('Invalid session or encryption secret');
  return config;
}
