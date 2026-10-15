import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

// Works from source (src/db/) and from the bundled build (dist/); MIGRATIONS_DIR overrides.
const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((p) => existsSync(path.join(p, 'meta')))!;

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => console.log('Migrations applied.'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
