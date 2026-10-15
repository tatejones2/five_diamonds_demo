export {
  formatCalendarDate,
  formatDateRange,
  formatEasternDay,
  formatEasternLongDay,
  formatEasternStamp,
  formatEasternTime,
  easternDateKey,
} from '@fd/shared';

export const pct = (n: number) => (n === 1 ? '1.000' : n.toFixed(3).replace(/^0/, ''));
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
export function relativeTime(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}
