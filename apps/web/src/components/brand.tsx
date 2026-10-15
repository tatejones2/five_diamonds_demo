/**
 * TEMPORARY wordmark (DECISIONS B1). Swap this one component for the owner-approved SVG logo;
 * nothing else in the app references brand artwork directly.
 */
export function BrandLogo({ inverted, compact }: { inverted?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" data-temp-brand>
      <svg viewBox="0 0 40 40" className="size-9 shrink-0" aria-hidden>
        <rect x="6" y="6" width="28" height="28" rx="4" transform="rotate(45 20 20)" fill={inverted ? '#fff' : 'var(--color-brand-navy)'} />
        <rect x="11" y="11" width="18" height="18" rx="2" transform="rotate(45 20 20)" fill="none" stroke={inverted ? 'var(--color-brand-navy)' : '#fff'} strokeWidth="2" />
        <text x="20" y="25.5" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="15" fill="var(--color-brand-flame)">
          5
        </text>
      </svg>
      <span className={inverted ? 'text-white' : 'text-brand-navy'}>
        <span className="block font-display text-[19px] font-bold uppercase leading-none tracking-wide">5 Diamonds</span>
        {!compact && <span className={`block text-[10.5px] font-semibold uppercase leading-tight tracking-[0.2em] ${inverted ? 'text-white/75' : 'text-brand-sky-ink'}`}>Tournament Baseball</span>}
      </span>
    </span>
  );
}
