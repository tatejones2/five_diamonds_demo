// Drops and recreates the public schema, then migrates. Refuses to run in production.
import { sql } from 'drizzle-orm';
import { isProd } from '../config';
import { db, pool } from './client';
import { runMigrations } from './migrate';

export async function resetDatabase() {
  if (isProd) throw new Error('Refusing to reset a production database.');
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await runMigrations();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase()
    .then(() => console.log('Database reset.'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
