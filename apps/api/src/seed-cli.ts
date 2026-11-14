import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectDatabase } from '@paybox/db';
import { loadConfig, readEnvironment } from './config';
import { seedDemo } from './seed';

const { db, pool } = connectDatabase(readEnvironment().DATABASE_URL);
try {
  const config = await loadConfig(db);
  const credentials = await seedDemo(db, config);
  const folder = resolve(process.cwd(), '.local');
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, 'demo.json'), JSON.stringify(credentials, null, 2), { mode: 0o600 });
  console.info('Demo fixtures ready. Local credentials are in .local/demo.json.');
} finally {
  await pool.end();
}
