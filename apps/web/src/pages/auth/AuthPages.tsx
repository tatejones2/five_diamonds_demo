import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { BrandLogo } from '../../components/brand';
import { Alert, Button, Card, Checkbox, FormError, LinkButton, Spinner, TextField } from '../../components/ui';
import { ApiRequestError } from '../../lib/api';
import { useAuthActions, useMe } from '../../lib/auth';
import { useSeo } from '../../lib/seo';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  useSeo({ title, noindex: true });
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo />
        </div>
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold uppercase">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </div>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

export function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const nav = useNavigate();
  const { signIn, verifyTotp, resendVerification } = useAuthActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: () => signIn({ email, password }),
    onSuccess: (r) => (r?.twoFactorRedirect ? setTotp('') : nav(next, { replace: true })),
  });
  const verify = useMutation({ mutationFn: () => verifyTotp(totp ?? ''), onSuccess: () => nav(next, { replace: true }) });
  const resend = useMutation({ mutationFn: () => resendVerification(email) });
  const unverified = login.error instanceof ApiRequestError && login.error.code === 'EMAIL_NOT_VERIFIED';

  if (totp !== null) {
    return (
      <AuthShell title="Two-factor check" subtitle="Enter the 6-digit code from your authenticator app.">
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), verify.mutate())}>
          <FormError error={verify.error} />
          <TextField label="Authentication code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={totp} onChange={(e) => setTotp(e.target.value)} />
          <Button type="submit" className="w-full" loading={verify.isPending}>
            Verify
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Coach & staff sign in" subtitle="Manage your teams, registrations and rosters.">
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), login.mutate())}>
        {unverified ? (
          <Alert tone="warn" title="Verify your email first">
            We sent a link to {email}.{' '}
            <button type="button" className="font-semibold text-brand-navy underline" onClick={() => resend.mutate()} disabled={resend.isPending}>
              {resend.isSuccess ? 'Sent again' : 'Resend link'}
            </button>
          </Alert>
        ) : (
          <FormError error={login.error} />
        )}
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end">
          <Link to="/auth/reset-password" className="text-sm font-semibold text-brand-navy hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        New team manager?{' '}
        <Link to={`/auth/sign-up${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-brand-navy hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function SignUp() {
  const { signUp } = useAuthActions();
  const [f, setF] = useState({ name: '', email: '', password: '', adult: false });
  const m = useMutation({ mutationFn: () => signUp({ name: f.name.trim(), email: f.email.trim(), password: f.password }) });
  if (m.isSuccess) return <Navigate to={`/auth/verify-email?email=${encodeURIComponent(f.email.trim())}`} replace />;
  const tooShort = f.password.length > 0 && f.password.length < 10;
  return (
    <AuthShell title="Create a manager account" subtitle="For adult coaches and team managers. One account can manage several teams.">
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <FormError error={m.error} />
        <TextField label="Full name" autoComplete="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextField label="Password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." error={tooShort ? 'Use at least 10 characters.' : undefined} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Checkbox label="I am 18 or older and manage a team." hint="Players do not create accounts; managers add rosters." checked={f.adult} onChange={(e) => setF({ ...f, adult: e.target.checked })} required />
        <Button type="submit" className="w-full" loading={m.isPending} disabled={!f.adult || tooShort}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/auth/login" className="font-semibold text-brand-navy hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const verified = params.get('verified') === '1';
  const error = params.get('error');
  const email = params.get('email') ?? '';
  const { resendVerification } = useAuthActions();
  const resend = useMutation({ mutationFn: () => resendVerification(email) });
  if (verified && !error) {
    return (
      <AuthShell title="Email verified">
        <Alert tone="ok" title="You're all set.">Your account is active. Add your first team to start registering.</Alert>
        <LinkButton to="/dashboard/teams/new" className="mt-5 w-full">
          Add a team
        </LinkButton>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Check your email">
      {error ? (
        <Alert tone="danger" title="That link didn't work">It may have expired or already been used. Sign in to request a new one.</Alert>
      ) : (
        <div className="flex gap-4">
          <MailCheck className="size-10 shrink-0 text-brand-sky-ink" aria-hidden />
          <p className="text-sm text-ink-muted">
            We sent a verification link{email && <> to <strong className="text-ink">{email}</strong></>}. Open it to activate your account. The link expires in 24 hours.
          </p>
        </div>
      )}
      {email && (
        <div className="mt-5">
          {resend.isSuccess ? (
            <Alert tone="ok" title="Sent again" />
          ) : (
            <>
              <FormError error={resend.error} />
              <Button variant="secondary" className="mt-2 w-full" onClick={() => resend.mutate()} loading={resend.isPending}>
                Resend link
              </Button>
            </>
          )}
        </div>
      )}
      <p className="mt-5 text-center text-sm">
        <Link to="/auth/login" className="font-semibold text-brand-navy hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { requestReset, resetPassword } = useAuthActions();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const req = useMutation({ mutationFn: () => requestReset(email) });
  const reset = useMutation({ mutationFn: () => resetPassword(token!, pw) });

  if (params.get('error')) {
    return (
      <AuthShell title="Link expired">
        <Alert tone="danger" title="That reset link is invalid or expired." />
        <LinkButton to="/auth/reset-password" variant="secondary" className="mt-4 w-full">
          Request a new link
        </LinkButton>
      </AuthShell>
    );
  }
  if (token) {
    return (
      <AuthShell title="Choose a new password">
        {reset.isSuccess ? (
          <>
            <Alert tone="ok" title="Password updated">Other signed-in devices were signed out for safety.</Alert>
            <LinkButton to="/auth/login" className="mt-4 w-full">
              Sign in
            </LinkButton>
          </>
        ) : (
          <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), reset.mutate())}>
            <FormError error={reset.error} />
            <TextField label="New password" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters." value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button type="submit" className="w-full" loading={reset.isPending}>
              Update password
            </Button>
          </form>
        )}
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to set a new password.">
      {req.isSuccess ? (
        <Alert tone="ok" title="Check your email">If an account exists for {email}, a reset link is on its way. It expires in 1 hour.</Alert>
      ) : (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), req.mutate())}>
          <FormError error={req.error} />
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" loading={req.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

/** Client-side guard for UX only; every API call is authorized on the server. */
export function RequireAuth({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isPending) return <Spinner />;
  if (!me.data?.user) return <Navigate to={`/auth/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (staff && !me.data.isStaff) {
    return (
      <div className="container-page py-16">
        <Alert tone="warn" title="Staff access required">Your account doesn't have tournament staff permissions.</Alert>
      </div>
    );
  }
  return <>{children}</>;
}
