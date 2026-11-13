import { connectDatabase, migrate, sql } from '@paybox/db';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://paybox:paybox@localhost:55432/paybox_test';
if (!new URL(url).pathname.endsWith('_test')) throw new Error('Integration database name must end in _test');
export const { db, pool } = connectDatabase(url);
export async function setupDatabase() {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
}
export async function resetDatabase() {
  const result = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`,
  );
  const names = result.rows.map((row) => `"${row.tablename.replaceAll('"', '""')}"`).join(',');
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} CASCADE`));
}
