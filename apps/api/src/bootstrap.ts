import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { hash } from '@node-rs/argon2';
import { apiKeys, connectDatabase, dashboardUsers, merchants } from '@paybox/db';
import { z } from 'zod';
import { loadConfig, readEnvironment } from './config';
import { sha256 } from './crypto';

const { db, pool } = connectDatabase(readEnvironment().DATABASE_URL);
try {
  await loadConfig(db);
  const email = z
    .string()
    .email()
    .parse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'obaro@paybox.local');
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? randomBytes(24).toString('base64url');
  z.string().min(12).parse(password);
  const key = `pbx_test_sk_${randomBytes(24).toString('hex')}`;
  const passwordHash = await hash(password);
  await mkdir('.local', { recursive: true });
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(dashboardUsers)
      .values({ email: email.toLowerCase(), passwordHash, role: 'admin' })
      .onConflictDoNothing()
      .returning();
    if (!user) throw new Error('This admin already exists; use its existing credentials');
    const [merchant] = await tx
      .insert(merchants)
      .values({
        name: process.env.BOOTSTRAP_MERCHANT_NAME ?? 'Demo Store',
        slug: process.env.BOOTSTRAP_MERCHANT_SLUG ?? 'demo-store',
      })
      .returning();
    await tx
      .insert(apiKeys)
      .values({ merchantId: merchant!.id, prefix: key.slice(0, 24), keyHash: sha256(key) });
    await writeFile(
      '.local/setup.json',
      `${JSON.stringify({ email, password, api_key: key, merchant_id: merchant!.id }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  });
  console.info('Initial administrator and merchant created. Credentials are in .local/setup.json.');
} finally {
  await pool.end();
}
