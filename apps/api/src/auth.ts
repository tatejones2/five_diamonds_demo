import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { config, isProd, trustedOrigins } from './config';
import { db } from './db/client';
import * as schema from './db/schema';
import { enqueueEmail } from './services/mailer';

export const auth = betterAuth({
  appName: '5 Diamonds Tournament Baseball',
  baseURL: config.APP_ORIGIN,
  basePath: '/api/auth',
  secret: config.AUTH_SECRET,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  advanced: {
    database: { generateId: 'uuid' },
    useSecureCookies: isProd,
    cookiePrefix: 'fd',
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: isProd },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await enqueueEmail({
        to: user.email,
        userId: user.id,
        template: 'password_reset',
        idempotencyKey: `password_reset:${user.id}:${url}`,
        subject: 'Reset your 5 Diamonds password',
        text: `Someone (hopefully you) asked to reset the password for this account.\n\nReset it here (link expires in 1 hour):\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
        sendNow: true,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await enqueueEmail({
        to: user.email,
        userId: user.id,
        template: 'verify_email',
        idempotencyKey: `verify_email:${user.id}:${url}`,
        subject: 'Verify your email for 5 Diamonds Tournament Baseball',
        text: `Welcome! Confirm this email address to finish setting up your team manager account:\n\n${url}\n\nThis link expires in 24 hours.`,
        sendNow: true,
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  rateLimit: {
    enabled: config.NODE_ENV !== 'test',
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 8 },
      '/sign-up/email': { window: 60 * 10, max: 5 },
      '/request-password-reset': { window: 60 * 10, max: 5 },
      '/send-verification-email': { window: 60 * 10, max: 5 },
      '/two-factor/verify-totp': { window: 60, max: 6 },
    },
  },
  plugins: [twoFactor({ issuer: '5 Diamonds Tournament Baseball' })],
});

export type Auth = typeof auth;
