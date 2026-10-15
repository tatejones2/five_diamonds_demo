import pino from 'pino';
import { config } from '../config';

// Structured logs. Redact anything that could carry minors' or families' PII (spec §13).
export const loggerOptions = {
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.email',
      '*.playerName',
      '*.entries',
      '*.phone',
      '*.toAddress',
    ],
    censor: '[redacted]',
  },
};
export const logger = pino(loggerOptions);
