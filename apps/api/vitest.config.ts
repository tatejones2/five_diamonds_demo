import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one Postgres database: run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://fivediamonds:fivediamonds_dev_only@localhost:5442/fivediamonds_test',
      AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      APP_ORIGIN: 'http://localhost:5173',
      MAIL_DRIVER: 'dev-mailbox',
      PAYMENT_PROVIDER: 'simulated',
    },
  },
});
