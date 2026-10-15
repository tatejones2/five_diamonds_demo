import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, RefreshCw, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { ApiRequestError } from '../lib/api';

export const cx = clsx;

// ---- Buttons --------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'flame';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-navy text-white hover:bg-brand-navy-deep shadow-sm',
  flame: 'bg-brand-flame text-white hover:brightness-95 shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-sunk',
  ghost: 'text-brand-navy hover:bg-brand-sky-soft',
  danger: 'bg-danger text-white hover:brightness-95',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[15px] gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};
export const buttonClass = (v: Variant = 'primary', s: Size = 'md', extra?: string) =>
  cx('inline-flex items-center justify-center rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 select-none', variants[v], sizes[s], extra);

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }>(
  ({ variant, size, loading, className, children, disabled, type = 'button', ...rest }, ref) => (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);

export function LinkButton({ variant, size, className, ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

// ---- Status badges ------------------------------------------------------------------------------

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'navy' | 'flame';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-sunk text-ink-muted ring-line',
  ok: 'bg-ok-soft text-ok ring-ok/25',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
  info: 'bg-info-soft text-info ring-info/25',
  navy: 'bg-brand-navy text-white ring-white/50',
  flame: 'bg-brand-flame-soft text-brand-flame-ink ring-brand-flame/25',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded border border-dashed border-brand-flame px-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-flame', className)} title="Fictional demonstration data">
      Demo
    </span>
  );
}

// ---- Layout pieces -------------------------------------------------------------------------------

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-3xl font-semibold uppercase leading-tight text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-ink-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={cx('card', className)}>{children}</As>;
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 id={id} className="text-xl font-semibold uppercase text-ink sm:text-2xl">
        {children}
      </h2>
      {action}
    </div>
  );
}

// ---- Feedback -------------------------------------------------------------------------------------

const alertStyle = {
  info: { cls: 'border-info/30 bg-info-soft text-info', Icon: Info },
  ok: { cls: 'border-ok/30 bg-ok-soft text-ok', Icon: CheckCircle2 },
  warn: { cls: 'border-warn/30 bg-warn-soft text-warn', Icon: AlertTriangle },
  danger: { cls: 'border-danger/30 bg-danger-soft text-danger', Icon: OctagonAlert },
};

export function Alert({ tone = 'info', title, children, className, onDismiss, role }: { tone?: keyof typeof alertStyle; title?: ReactNode; children?: ReactNode; className?: string; onDismiss?: () => void; role?: 'alert' | 'status' }) {
  const { cls, Icon } = alertStyle[tone];
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={cx('flex gap-3 rounded-xl border p-4 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-ink">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx('text-ink-muted', title && 'mt-1')}>{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="self-start rounded p-1 text-ink-subtle hover:bg-black/5" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-ink-subtle">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-surface-sunk', className)} aria-hidden />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-brand-sky-soft text-brand-navy">{icon}</div>}
      <p className="font-display text-lg font-semibold uppercase text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const offline = error instanceof ApiRequestError && error.code === 'NETWORK';
  const notFound = error instanceof ApiRequestError && error.status === 404;
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-danger/25 bg-danger-soft/60 px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold uppercase text-ink">{notFound ? 'Not found' : offline ? "You're offline" : "Couldn't load this"}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        {notFound ? "This page doesn't exist or isn't public yet." : offline ? 'Check your connection. Information shown elsewhere may be out of date.' : error instanceof ApiRequestError ? error.message : 'Please try again.'}
      </p>
      {retry && !notFound && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={retry}>
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

// ---- Forms -----------------------------------------------------------------------------------------

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
}

function FieldShell({ id, label, hint, error, required, className, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}*
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls = (error?: string) =>
  cx(
    'h-11 w-full rounded-lg border bg-surface px-3 text-[15px] text-ink placeholder:text-ink-subtle/70 transition focus:border-brand-sky focus:outline-none focus:ring-4 focus:ring-brand-sky/15 disabled:bg-surface-sunk',
    error ? 'border-danger' : 'border-line-strong',
  );

export const TextField = forwardRef<HTMLInputElement, FieldProps & InputHTMLAttributes<HTMLInputElement>>(({ label, hint, error, required, className, id, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={className}>
      <input ref={ref} id={fid} required={required} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} className={inputCls(error)} {...rest} />
    </FieldShell>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>>(({ label, hint, error, required, className, id, rows = 4, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea ref={ref} id={fid} rows={rows} required={required} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} className={cx(inputCls(error), 'h-auto py-2.5 leading-relaxed')} {...rest} />
    </FieldShell>
  );
});

export const SelectField = forwardRef<HTMLSelectElement, FieldProps & SelectHTMLAttributes<HTMLSelectElement>>(({ label, hint, error, required, className, id, children, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={className}>
      <select ref={ref} id={fid} required={required} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined} className={cx(inputCls(error), 'pr-8')} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
});

export function Checkbox({ label, hint, className, ...rest }: { label: ReactNode; hint?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line-strong accent-brand-navy" aria-describedby={hint ? `${id}-hint` : undefined} {...rest} />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-ink-subtle">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/** Summary of server validation errors at the top of a form (focusable for screen readers). */
export function FormError({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  const msg = error instanceof ApiRequestError ? error.message : 'Something went wrong. Please try again.';
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <Alert tone="danger" title={msg} />
    </div>
  );
}

// ---- Dialog (native <dialog>: focus trap + Esc handled by the browser) ------------------------

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/50 backdrop:backdrop-blur-[2px]', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold uppercase">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-sunk" aria-label="Close dialog">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-alt px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Visually hidden live region for status announcements (spec §4 screen-reader updates). */
export function LiveRegion({ message }: { message: string }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
