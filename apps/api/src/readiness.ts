import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Database, sql } from '@paybox/db';

export async function checkReadiness(db: Database) {
  const folder = ['packages/db/migrations', '../../packages/db/migrations']
    .map((path) => resolve(path))
    .find((path) => existsSync(resolve(path, 'meta/_journal.json')));
  if (!folder) throw new Error('Migration files unavailable');
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const expected = journal.entries.map((entry) => ({
    hash: createHash('sha256')
      .update(readFileSync(resolve(folder, `${entry.tag}.sql`)))
      .digest('hex'),
    when: String(entry.when),
  }));
  const result = await db.execute<{ hash: string; created_at: string }>(
    sql`SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`,
  );
  if (
    result.rows.length !== expected.length ||
    expected.some(
      (entry, i) => entry.hash !== result.rows[i]?.hash || entry.when !== result.rows[i]?.created_at,
    )
  )
    throw new Error('Database migrations are not at the expected version');
}
