import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
export * from './schema';
export function connectDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 12 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
export type Database = ReturnType<typeof connectDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export { migrate } from 'drizzle-orm/node-postgres/migrator';
export * from './ledger';
