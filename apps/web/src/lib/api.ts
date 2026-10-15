import type { ApiErrorBody, ErrorCode } from '@fd/shared';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | 'NETWORK',
    message: string,
    public details?: any,
  ) {
    super(message);
  }
  /** Field-level messages from VALIDATION_FAILED responses. */
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) ?? {};
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(path: string, opts: { method?: Method; body?: unknown; signal?: AbortSignal; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: opts.form ? undefined : opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiRequestError(0, 'NETWORK', "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    // better-auth errors use { code, message } at the top level.
    const ba = data as { code?: string; message?: string } | null;
    throw new ApiRequestError(res.status, (err?.code ?? mapAuthCode(res.status, ba?.code)) as ErrorCode, err?.message ?? ba?.message ?? 'Something went wrong. Please try again.', err?.details);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function mapAuthCode(status: number, code?: string): ErrorCode {
  if (code === 'EMAIL_NOT_VERIFIED') return 'EMAIL_NOT_VERIFIED';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 422) return 'VALIDATION_FAILED';
  return 'INTERNAL';
}

export const errorMessage = (e: unknown) => (e instanceof ApiRequestError ? e.message : 'Something went wrong. Please try again.');
