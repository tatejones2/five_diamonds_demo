import type { ErrorCode } from '@fd/shared';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  CAPACITY_FULL: 409,
  DUPLICATE_REGISTRATION: 409,
  REGISTRATION_CLOSED: 409,
  ROSTER_LOCKED: 409,
  INVALID_TRANSITION: 409,
  SCHEDULE_INVALID: 422,
  DOWNSTREAM_CONFLICT: 409,
  RATE_LIMITED: 429,
  FILE_REJECTED: 422,
  EMAIL_DELIVERY_FAILED: 502,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found.`);
export const forbidden = (msg = 'You do not have permission to do that.') => new ApiError('FORBIDDEN', msg);
export const versionConflict = () =>
  new ApiError('VERSION_CONFLICT', 'Someone else changed this since you loaded it. Reload to see the latest version, then reapply your change.');
