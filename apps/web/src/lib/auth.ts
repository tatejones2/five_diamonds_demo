import type { MeResponse } from '@fd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => api<MeResponse>('/me'), staleTime: 60_000 });
}

export function useAuthActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const origin = window.location.origin;
  return {
    signUp: (b: { name: string; email: string; password: string }) =>
      api('/auth/sign-up/email', { body: { ...b, callbackURL: `${origin}/auth/verify-email?verified=1` } }),
    signIn: async (b: { email: string; password: string }) => {
      const r = await api<{ twoFactorRedirect?: boolean }>('/auth/sign-in/email', { body: b });
      await refresh();
      return r;
    },
    verifyTotp: async (code: string) => {
      await api('/auth/two-factor/verify-totp', { body: { code } });
      await refresh();
    },
    signOut: async () => {
      await api('/auth/sign-out', { body: {} });
      qc.clear();
    },
    resendVerification: (email: string) => api('/auth/send-verification-email', { body: { email, callbackURL: `${origin}/auth/verify-email?verified=1` } }),
    requestReset: (email: string) => api('/auth/request-password-reset', { body: { email, redirectTo: `${origin}/auth/reset-password` } }),
    resetPassword: (token: string, newPassword: string) => api('/auth/reset-password', { body: { token, newPassword } }),
  };
}
