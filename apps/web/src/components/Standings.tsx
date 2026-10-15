import type { PublicStandingsDivision } from '@fd/shared';
import { pct, signed } from '../lib/format';
import { Badge } from './ui';

export function StandingsPool({ pool, divisionName }: { pool: PublicStandingsDivision['pools'][number]; divisionName: string }) {
  const caption = `${divisionName}${pool.poolLabel ? ` — Pool ${pool.poolLabel}` : ''} standings`;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="font-display text-lg font-semibold uppercase">{pool.poolLabel ? `Pool ${pool.poolLabel}` : divisionName}</h3>
        {pool.official ? <Badge tone="ok">Official</Badge> : <Badge tone="warn">Unofficial</Badge>}
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted">
          <tr>
            <th scope="col" className="w-10 px-3 py-2 text-right">#</th>
            <th scope="col" className="px-3 py-2">Team</th>
            <th scope="col" className="px-2 py-2 text-center"><abbr title="Wins-Losses-Ties">W-L-T</abbr></th>
            <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell"><abbr title="Winning percentage">PCT</abbr></th>
            <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell"><abbr title="Runs scored">RS</abbr></th>
            <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell"><abbr title="Runs allowed">RA</abbr></th>
            <th scope="col" className="px-3 py-2 text-right"><abbr title="Run differential">DIFF</abbr></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {pool.rows.map((r) => (
            <tr key={r.team.id}>
              <td className="tabular px-3 py-2.5 text-right font-semibold text-ink-muted">
                {r.gamesPlayed === 0 ? '—' : r.rank}
                {r.unresolvedTie && r.gamesPlayed > 0 && <span title="Tied" aria-label="tied">*</span>}
              </td>
              <th scope="row" className="truncate px-3 py-2.5 text-left font-semibold text-ink">{r.team.name}</th>
              <td className="tabular px-2 py-2.5 text-center">{r.wins}-{r.losses}-{r.ties}</td>
              <td className="tabular hidden px-2 py-2.5 text-right sm:table-cell">{r.gamesPlayed === 0 ? '—' : pct(r.winPct)}</td>
              <td className="tabular hidden px-2 py-2.5 text-right sm:table-cell">{r.runsScored}</td>
              <td className="tabular hidden px-2 py-2.5 text-right sm:table-cell">{r.runsAllowed}</td>
              <td className="tabular px-3 py-2.5 text-right">{signed(r.runDifferential)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="border-t border-line px-4 py-3 text-xs text-ink-muted">
        <summary className="cursor-pointer font-semibold text-ink">How standings are calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {pool.explanation.map((e) => (
            <li key={e}>{e}</li>
          ))}
          {pool.rows.some((r) => r.unresolvedTie && r.gamesPlayed > 0) && <li>* Teams share a rank because the tie is not resolved by the configured tie-breakers.</li>}
        </ul>
      </details>
    </div>
  );
}
