import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config';
import * as schema from './schema';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.NODE_ENV === 'test' ? 20 : 10,
  // Fail fast rather than hanging requests during a DB outage.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });
export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; services accept `Db | Tx` so they compose inside transactions. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
export { schema };
