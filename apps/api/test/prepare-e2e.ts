import { pool, resetDatabase, setupDatabase } from './database';

try {
  await setupDatabase();
  await resetDatabase();
} finally {
  await pool.end();
}
