import { STATUS_LABELS, type GameStatus, type PaymentStatus, type PublicTournamentSummary, type RegistrationStatus } from '@fd/shared';
import { formatCalendarDate } from '../lib/format';
import { Badge, type Tone } from './ui';

/** Event-level badges (spec §4): text is always present; colour is reinforcement only. */
export function tournamentBadges(t: Pick<PublicTournamentSummary, 'status' | 'registrationState' | 'allDivisionsFull' | 'schedulePublishedAt' | 'registrationOpensAt'>, opts: { waitlist?: boolean } = {}) {
  const out: { label: string; tone: Tone }[] = [];
  if (t.status === 'canceled') return [{ label: 'Canceled', tone: 'danger' as Tone }];
  if (t.status === 'completed') out.push({ label: 'Final', tone: 'neutral' });
  else if (t.status === 'in_progress') out.push({ label: 'In Progress', tone: 'navy' });
  else if (t.registrationState === 'open') {
    if (t.allDivisionsFull) out.push(opts.waitlist ? { label: 'Waitlist', tone: 'warn' } : { label: 'Full', tone: 'danger' });
    else out.push({ label: 'Registration Open', tone: 'ok' });
  } else if (t.registrationState === 'not_yet_open') {
    out.push({ label: t.registrationOpensAt ? `Opens ${formatCalendarDate(t.registrationOpensAt.slice(0, 10), { month: 'short', day: 'numeric' })}` : 'Coming Soon', tone: 'info' });
  } else out.push({ label: 'Registration Closed', tone: 'neutral' });
  if (t.schedulePublishedAt && t.status !== 'completed') out.push({ label: 'Schedule Published', tone: 'info' });
  return out;
}

export function TournamentBadges(props: Parameters<typeof tournamentBadges>[0] & { waitlist?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tournamentBadges(props, { waitlist: props.waitlist }).map((b) => (
        <Badge key={b.label} tone={b.tone} dot>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

const regTone: Record<RegistrationStatus, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  pending_review: 'warn',
  confirmed: 'ok',
  waitlisted: 'warn',
  rejected: 'danger',
  withdrawn: 'neutral',
  canceled: 'neutral',
};
export const RegistrationBadge = ({ status }: { status: RegistrationStatus }) => (
  <Badge tone={regTone[status]} dot>
    {STATUS_LABELS.registration[status]}
  </Badge>
);

const payTone: Record<PaymentStatus, Tone> = {
  not_required: 'neutral',
  not_started: 'neutral',
  pending_external: 'warn',
  paid_verified: 'ok',
  manually_verified: 'ok',
  failed: 'danger',
  refunded: 'neutral',
  disputed: 'danger',
};
export const PaymentBadge = ({ status }: { status: PaymentStatus }) => <Badge tone={payTone[status]}>{STATUS_LABELS.payment[status]}</Badge>;

const gameTone: Record<GameStatus, Tone> = {
  scheduled: 'neutral',
  delayed: 'warn',
  in_progress: 'flame',
  suspended: 'warn',
  postponed: 'warn',
  canceled: 'danger',
  final: 'navy',
};
export function GameStatusBadge({ status, forfeit }: { status: GameStatus; forfeit?: boolean }) {
  return (
    <Badge tone={gameTone[status]} dot={status === 'in_progress'}>
      {status === 'in_progress' ? 'Live' : status === 'final' && forfeit ? 'Final (Forfeit)' : STATUS_LABELS.game[status]}
    </Badge>
  );
}
