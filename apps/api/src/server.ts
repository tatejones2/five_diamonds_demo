import { buildApp } from './app';
import { config } from './config';
import { pool } from './db/client';
import { logger } from './lib/logger';
import { startOutboxWorker } from './services/mailer';

const app = await buildApp();
const stopWorker = startOutboxWorker();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stopWorker();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
