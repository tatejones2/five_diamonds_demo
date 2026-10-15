import type { PublicAnnouncement } from '@fd/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronDown, LayoutDashboard, Menu, Radio, Search, Shield, User, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { AlertBanner } from './alerts';
import { BrandLogo } from './brand';
import { cx } from './ui';

const primary = [
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/game-day', label: 'Game Day' },
  { to: '/facilities', label: 'Facilities' },
  { to: '/news', label: 'News' },
];
const more = [
  { to: '/about', label: 'About' },
  { to: '/staff', label: 'Staff' },
  { to: '/rules', label: 'Rules' },
  { to: '/faq', label: 'FAQ' },
  { to: '/media', label: 'Photos & Video' },
  { to: '/partners', label: 'Partners' },
  { to: '/sponsorship', label: 'Sponsorship' },
  { to: '/get-involved', label: 'Get Involved' },
  { to: '/contact', label: 'Contact' },
];

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[15px] font-medium text-ink-muted hover:bg-surface-sunk hover:text-ink">
        More <ChevronDown className={cx('size-4 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-[var(--shadow-lift)]">
          {more.map((m) => (
            <li key={m.to}>
              <Link to={m.to} className="block px-4 py-2 text-sm text-ink hover:bg-surface-sunk">
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountLink({ mobile }: { mobile?: boolean }) {
  const me = useMe();
  const user = me.data?.user;
  if (!user) {
    return (
      <Link to="/auth/login" className={cx('inline-flex items-center gap-2 rounded-lg font-semibold', mobile ? 'px-3 py-2' : 'h-10 border border-line-strong px-3.5 text-sm text-ink hover:bg-surface-sunk')}>
        <User className="size-4" aria-hidden /> Coach sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {me.data?.isStaff && (
        <Link to="/admin" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-navy hover:bg-brand-sky-soft">
          <Shield className="size-4" aria-hidden /> Admin
        </Link>
      )}
      <Link to="/dashboard" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 text-sm font-semibold text-white hover:bg-brand-navy-deep">
        <LayoutDashboard className="size-4" aria-hidden /> My Teams
      </Link>
    </div>
  );
}

function GlobalAlerts() {
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api<PublicAnnouncement[]>('/alerts'), refetchInterval: 60_000 });
  const orgWide = (q.data ?? []).filter((a) => a.scope === 'organization');
  if (!orgWide.length) return null;
  return (
    <div className="container-page space-y-2 pt-3">
      {orgWide.map((a) => (
        <AlertBanner key={a.id} a={a} />
      ))}
    </div>
  );
}

export function SiteLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded bg-brand-navy px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link to="/" className="shrink-0">
            <BrandLogo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {primary.map((p) => (
              <NavLink key={p.to} to={p.to} className={({ isActive }) => cx('rounded-lg px-3 py-2 text-[15px] font-medium', isActive ? 'bg-brand-sky-soft text-brand-navy' : 'text-ink-muted hover:bg-surface-sunk hover:text-ink')}>
                {p.label === 'Game Day' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Radio className="size-4 text-brand-flame" aria-hidden />
                    {p.label}
                  </span>
                ) : (
                  p.label
                )}
              </NavLink>
            ))}
            <MoreMenu />
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/tournaments" className="inline-flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunk" aria-label="Find a tournament">
              <Search className="size-5" />
            </Link>
            <AccountLink />
          </div>
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-ink lg:hidden" aria-expanded={mobileOpen} aria-controls="mobile-nav" onClick={() => setMobileOpen((o) => !o)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
            {mobileOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
        {mobileOpen && (
          <nav id="mobile-nav" aria-label="Main" className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-surface lg:hidden">
            <ul className="container-page grid grid-cols-2 gap-1 py-3">
              {[...primary, ...more].map((p) => (
                <li key={p.to}>
                  <NavLink to={p.to} className={({ isActive }) => cx('block rounded-lg px-3 py-3 text-[15px] font-medium', isActive ? 'bg-brand-sky-soft text-brand-navy' : 'text-ink')}>
                    {p.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <div className="container-page border-t border-line py-3">
              <AccountLink mobile />
            </div>
          </nav>
        )}
      </header>
      <GlobalAlerts />
      <main id="main" className="flex-1 pb-20 lg:pb-0">
        <Outlet />
      </main>
      <Footer />
      <MobileGameDayBar />
    </div>
  );
}

/** Sticky one-handed shortcut bar on phones (spec §4, §11). */
function MobileGameDayBar() {
  const items: { to: string; label: string; icon: ReactNode }[] = [
    { to: '/game-day', label: 'Game Day', icon: <Radio className="size-5" aria-hidden /> },
    { to: '/tournaments', label: 'Tournaments', icon: <CalendarDays className="size-5" aria-hidden /> },
    { to: '/dashboard', label: 'My Teams', icon: <User className="size-5" aria-hidden /> },
  ];
  return (
    <nav aria-label="Quick links" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-3">
        {items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide', isActive ? 'text-brand-flame' : 'text-ink-muted')}>
              {i.icon}
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="mt-16 bg-brand-navy-deep text-white/80">
      <div className="container-page grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-1">
          <BrandLogo inverted />
          <p className="mt-4 text-sm">Youth tournament baseball in the North Carolina Triad.</p>
          <p className="mt-2 text-xs text-white/55">All game times are Eastern Time.</p>
        </div>
        {[
          { h: 'Play', links: [['/tournaments', 'Find a Tournament'], ['/game-day', 'Game Day'], ['/facilities', 'Facilities'], ['/rules', 'Rules'], ['/faq', 'FAQ']] },
          { h: 'Organization', links: [['/about', 'About'], ['/staff', 'Staff'], ['/news', 'News'], ['/media', 'Photos & Video'], ['/partners', 'Partners'], ['/sponsorship', 'Sponsorship']] },
          { h: 'Help', links: [['/contact', 'Contact'], ['/get-involved', 'Get Involved'], ['/dashboard', 'Coach Portal'], ['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/accessibility', 'Accessibility']] },
        ].map((col) => (
          <div key={col.h}>
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white">{col.h}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map(([to, label]) => (
                <li key={to}>
                  <Link to={to!} className="hover:text-white hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-white/50 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} 5 Diamonds Tournament Baseball</p>
          {import.meta.env.VITE_PRELAUNCH !== 'false' && <p>Pre-launch build: brand assets are temporary pending owner approval.</p>}
        </div>
      </div>
    </footer>
  );
}
