import type { PublicAnnouncement } from '@fd/shared';
import { CloudLightning, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { formatEasternStamp } from '../lib/format';
import { cx } from './ui';

const sev = {
  critical: { cls: 'border-danger bg-danger text-white', Icon: OctagonAlert, label: 'Alert' },
  advisory: { cls: 'border-warn/40 bg-warn-soft text-ink', Icon: TriangleAlert, label: 'Advisory' },
  info: { cls: 'border-info/30 bg-info-soft text-ink', Icon: Info, label: 'Notice' },
};

/** Prominent operational notice (spec §11). Critical notices use role="alert". */
export function AlertBanner({ a, compact }: { a: PublicAnnouncement; compact?: boolean }) {
  const s = sev[a.severity];
  const Icon = a.category === 'weather_delay' ? CloudLightning : s.Icon;
  return (
    <div role={a.severity === 'critical' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border px-4 py-3', s.cls)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          <span className="mr-2 text-[11px] font-bold uppercase tracking-wider opacity-80">{s.label}</span>
          {a.title}
        </p>
        {!compact && <p className={cx('mt-0.5 text-sm', a.severity === 'critical' ? 'text-white/90' : 'text-ink-muted')}>{a.body}</p>}
        <p className={cx('mt-1 text-xs', a.severity === 'critical' ? 'text-white' : 'text-ink-subtle')}>
          {a.scopeLabel && <>{a.scopeLabel} · </>}
          Updated {formatEasternStamp(a.updatedAt)}
          {a.authorName && <> · Issued by {a.authorName}</>}
        </p>
      </div>
    </div>
  );
}
