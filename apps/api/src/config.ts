import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    API_PORT: z.coerce.number().int().default(4000),
    TRUSTED_ORIGINS: z.string().default(''),
    MAIL_DRIVER: z.enum(['dev-mailbox', 'smtp']).default('dev-mailbox'),
    MAIL_FROM: z.string().default('5 Diamonds Tournament Baseball <no-reply@example.invalid>'),
    SMTP_URL: z.string().default(''),
    PAYMENT_PROVIDER: z.enum(['disabled', 'simulated']).default('disabled'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.uploads'),
    STAFF_MFA_REQUIRED: bool,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Guardrails: refuse to boot production with development-only adapters (spec §7, §16).
    if (env.PAYMENT_PROVIDER === 'simulated') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Simulated payments are not allowed in production.' });
    }
    if (env.MAIL_DRIVER === 'dev-mailbox') {
      ctx.addIssue({ code: 'custom', path: ['MAIL_DRIVER'], message: 'dev-mailbox is not allowed in production.' });
    }
    if (!env.APP_ORIGIN.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'Production APP_ORIGIN must be https.' });
    }
    if (env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'Use S3-compatible storage in production.' });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  return parsed.data;
}

export const config = loadConfig();
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const trustedOrigins = [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)];
