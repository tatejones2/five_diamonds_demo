import type { z } from 'zod';
import { ApiError } from './errors';

/** Parse untrusted input; on failure return a 400 with field-level messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new ApiError('VALIDATION_FAILED', 'Some fields need attention.', { fields });
}
