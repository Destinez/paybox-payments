import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export * from './schema';
export { sql, eq, and, or, desc, asc, inArray, isNull, lte, gte, count } from 'drizzle-orm';
export function connectDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 12 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
export type Database = ReturnType<typeof connectDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
