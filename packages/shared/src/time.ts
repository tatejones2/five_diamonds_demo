// All instants are stored in UTC; all human-facing times are America/New_York (spec §4, §9).
// Implemented with Intl so DST transitions come from the platform's tz database.

export const EVENT_TIME_ZONE = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function zonedParts(instant: Date) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (minutes) of Eastern time from UTC at the given instant, e.g. -240 during EDT. */
export function easternOffsetMinutes(instant: Date): number {
  const p = zonedParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Convert an Eastern wall-clock date + time ("2026-04-18", "09:30") to a UTC Date.
 * Nonexistent spring-forward times resolve forward (02:30 → 03:30 EDT); ambiguous
 * fall-back times resolve to the first (EDT) occurrence.
 */
export function easternWallTimeToUtc(date: string, time: string): Date {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) throw new Error(`Invalid Eastern date/time: ${date} ${time}`);
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // Try both candidate offsets (EST/EDT) and keep the one that round-trips.
  const candidates = [-240, -300].map((off) => new Date(wall - off * 60000));
  for (const c of candidates) {
    if (easternOffsetMinutes(c) * 60000 + c.getTime() === wall) return c;
  }
  // Nonexistent local time (DST gap): shift by the gap, landing after the transition.
  return new Date(wall + 300 * 60000);
}

/** Eastern calendar date (YYYY-MM-DD) of a UTC instant. */
export function easternDateKey(instant: Date | string): string {
  const p = zonedParts(new Date(instant));
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Eastern wall-clock time (HH:mm, 24h) of a UTC instant. */
export function easternTimeKey(instant: Date | string): string {
  const p = zonedParts(new Date(instant));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: EVENT_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const longDayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TIME_ZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const stampFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export const formatEasternTime = (i: Date | string) => timeFmt.format(new Date(i));
export const formatEasternDay = (i: Date | string) => dayFmt.format(new Date(i));
export const formatEasternLongDay = (i: Date | string) => longDayFmt.format(new Date(i));
export const formatEasternStamp = (i: Date | string) => stampFmt.format(new Date(i));

/** Format a calendar date string (YYYY-MM-DD, no time) without timezone drift. */
export function formatCalendarDate(date: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
  );
}

export function formatDateRange(start: string, end: string) {
  if (start === end) return formatCalendarDate(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const [sy, sm] = start.split('-');
  const [ey, em] = end.split('-');
  if (sy === ey && sm === em) {
    return `${formatCalendarDate(start, { month: 'short', day: 'numeric' })}–${Number(end.slice(8))}, ${ey}`;
  }
  if (sy === ey) {
    return `${formatCalendarDate(start, { month: 'short', day: 'numeric' })} – ${formatCalendarDate(end, { month: 'short', day: 'numeric' })}, ${ey}`;
  }
  return `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
}
