// Public read models. Every function returns an explicit safe projection (spec §14):
// no player names, contact details, payment data, or draft/unpublished records.
import {
  computeStandings,
  easternDateKey,
  PUBLIC_TOURNAMENT_STATUSES,
  winnerSide,
  type Paginated,
  type PublicDivision,
  type PublicGame,
  type PublicSchedule,
  type PublicStandingsDivision,
  type PublicTeamRef,
  type PublicTournamentDetail,
  type PublicTournamentSummary,
  type PublicVenueRef,
} from '@fd/shared';
import { and, asc, count, desc, eq, exists, gte, ilike, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  bracketMatchups,
  bracketRounds,
  divisions,
  fields,
  games,
  registrations,
  teams,
  tournaments,
  tournamentVenues,
  venues,
  type PublishedGameProjection,
} from '../db/schema';
import { notFound } from '../lib/errors';
import { activeAlerts } from './announcements';
import { divisionCounts, registrationState } from './tournaments';

type TournamentRow = typeof tournaments.$inferSelect;
const todayEastern = () => easternDateKey(new Date());

async function venuesFor(ids: string[]) {
  if (!ids.length) return new Map<string, PublicVenueRef[]>();
  const rows = await db
    .select({ tournamentId: tournamentVenues.tournamentId, id: venues.id, slug: venues.slug, name: venues.name, city: venues.city, state: venues.state })
    .from(tournamentVenues)
    .innerJoin(venues, eq(venues.id, tournamentVenues.venueId))
    .where(inArray(tournamentVenues.tournamentId, ids));
  const m = new Map<string, PublicVenueRef[]>();
  for (const r of rows) {
    const { tournamentId, ...v } = r;
    m.set(tournamentId, [...(m.get(tournamentId) ?? []), v]);
  }
  return m;
}

async function publicDivisions(t: TournamentRow): Promise<PublicDivision[]> {
  const divs = await db.select().from(divisions).where(eq(divisions.tournamentId, t.id)).orderBy(asc(divisions.sortOrder), asc(divisions.name));
  const counts = await divisionCounts(db, divs.map((d) => d.id));
  const open = registrationState(t) === 'open';
  return divs.map((d) => {
    const held = counts.get(d.id)?.held ?? 0;
    const isFull = held >= d.capacity;
    return {
      id: d.id,
      name: d.name,
      ageLabel: d.ageLabel,
      classification: d.classification,
      capacity: d.capacity,
      // Spots are shown only while registration is open, when the count is authoritative (spec §4).
      spotsRemaining: open ? Math.max(0, d.capacity - held) : null,
      isFull,
      waitlistAvailable: open && isFull && t.waitlistEnabled,
      gameFormat: d.gameFormat,
      rulesText: d.rulesText,
    };
  });
}

function summarize(t: TournamentRow, divs: PublicDivision[], vs: PublicVenueRef[]): PublicTournamentSummary {
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    status: t.status,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    region: t.region,
    summary: t.summary,
    category: t.category,
    feeInfo: t.feeInfo,
    registrationOpensAt: t.registrationOpensAt?.toISOString() ?? null,
    registrationClosesAt: t.registrationClosesAt?.toISOString() ?? null,
    registrationState: registrationState(t),
    venues: vs,
    ageLabels: [...new Set(divs.map((d) => d.ageLabel))],
    allDivisionsFull: divs.length > 0 && divs.every((d) => d.isFull),
    schedulePublishedAt: t.schedulePublishedAt?.toISOString() ?? null,
    isDemo: t.isDemo,
  };
}

export async function listPublicTournaments(q: {
  when: 'upcoming' | 'past' | 'all';
  from?: string;
  to?: string;
  q?: string;
  ageLabel?: string;
  venue?: string;
  availability: 'open' | 'full' | 'any';
  page: number;
  pageSize: number;
}): Promise<Paginated<PublicTournamentSummary>> {
  const today = todayEastern();
  const conds = [inArray(tournaments.status, [...PUBLIC_TOURNAMENT_STATUSES])];
  if (q.when === 'upcoming') conds.push(gte(tournaments.endsOn, today));
  if (q.when === 'past') conds.push(lt(tournaments.endsOn, today));
  if (q.from) conds.push(gte(tournaments.endsOn, q.from));
  if (q.to) conds.push(sql`${tournaments.startsOn} <= ${q.to}`);
  if (q.q) conds.push(ilike(tournaments.title, `%${q.q.replace(/[%_\\]/g, (c) => '\\' + c)}%`));
  if (q.ageLabel) {
    conds.push(exists(db.select({ x: sql`1` }).from(divisions).where(and(eq(divisions.tournamentId, tournaments.id), eq(divisions.ageLabel, q.ageLabel)))));
  }
  if (q.venue) {
    conds.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(tournamentVenues)
          .innerJoin(venues, eq(venues.id, tournamentVenues.venueId))
          .where(and(eq(tournamentVenues.tournamentId, tournaments.id), eq(venues.slug, q.venue))),
      ),
    );
  }
  const where = and(...conds);
  const order = q.when === 'past' ? [desc(tournaments.startsOn)] : [asc(tournaments.startsOn), asc(tournaments.title)];
  // Availability depends on live counts, so filter after computing divisions (bounded page sizes).
  const all = await db.select().from(tournaments).where(where).orderBy(...order);
  const vmap = await venuesFor(all.map((t) => t.id));
  let summaries = await Promise.all(all.map(async (t) => summarize(t, await publicDivisions(t), vmap.get(t.id) ?? [])));
  if (q.availability === 'open') summaries = summaries.filter((s) => s.registrationState === 'open' && !s.allDivisionsFull);
  if (q.availability === 'full') summaries = summaries.filter((s) => s.allDivisionsFull);
  const start = (q.page - 1) * q.pageSize;
  return { items: summaries.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: summaries.length };
}

export async function getPublicTournamentRow(slug: string, opts: { allowDraft?: boolean } = {}) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug));
  // Drafts are invisible publicly, even by exact slug (spec §7).
  if (!t || (!opts.allowDraft && !PUBLIC_TOURNAMENT_STATUSES.includes(t.status))) throw notFound('Tournament');
  return t;
}

export async function getPublicTournament(slug: string, opts: { allowDraft?: boolean } = {}): Promise<PublicTournamentDetail> {
  const t = await getPublicTournamentRow(slug, opts);
  const divs = await publicDivisions(t);
  const vmap = await venuesFor([t.id]);
  return {
    ...summarize(t, divs, vmap.get(t.id) ?? []),
    description: t.description,
    rulesText: t.rulesText,
    refundPolicyUrl: t.refundPolicyUrl,
    operationalContacts: t.operationalContacts,
    divisions: divs,
    rosterLocksAt: t.rosterLocksAt?.toISOString() ?? null,
    activeAlerts: await activeAlerts(t.id),
  };
}

// ---- Games ------------------------------------------------------------------------------------

interface Lookups {
  divisions: Map<string, string>;
  fields: Map<string, NonNullable<PublicGame['field']>>;
  teams: Map<string, PublicTeamRef>;
  rounds: Map<string, string>;
}

async function lookups(t: TournamentRow, projections: PublishedGameProjection[]): Promise<Lookups> {
  const divs = await db.select({ id: divisions.id, name: divisions.name }).from(divisions).where(eq(divisions.tournamentId, t.id));
  const fieldRows = await db
    .select({ id: fields.id, name: fields.name, venueId: venues.id, venueName: venues.name, venueSlug: venues.slug })
    .from(fields)
    .innerJoin(venues, eq(venues.id, fields.venueId))
    .innerJoin(tournamentVenues, and(eq(tournamentVenues.venueId, venues.id), eq(tournamentVenues.tournamentId, t.id)));
  const teamIds = [...new Set(projections.flatMap((p) => [p.homeTeamId, p.awayTeamId]).filter((x): x is string => !!x))];
  const teamRows = teamIds.length ? await db.select({ id: teams.id, name: teams.name, city: teams.city, state: teams.state }).from(teams).where(inArray(teams.id, teamIds)) : [];
  const matchupIds = [...new Set(projections.map((p) => p.bracketMatchupId).filter((x): x is string => !!x))];
  const roundRows = matchupIds.length
    ? await db.select({ id: bracketMatchups.id, name: bracketRounds.name }).from(bracketMatchups).innerJoin(bracketRounds, eq(bracketRounds.id, bracketMatchups.roundId)).where(inArray(bracketMatchups.id, matchupIds))
    : [];
  return {
    divisions: new Map(divs.map((d) => [d.id, d.name])),
    fields: new Map(fieldRows.map((f) => [f.id, f])),
    teams: new Map(
      teamRows.map((r) => [r.id, t.publicTeamNames ? r : { id: r.id, name: 'Team name withheld', city: null, state: null }]),
    ),
    rounds: new Map(roundRows.map((r) => [r.id, r.name])),
  };
}

export function toPublicGame(id: string, p: PublishedGameProjection, updatedAt: Date, l: Lookups): PublicGame {
  return {
    id,
    divisionId: p.divisionId,
    divisionName: l.divisions.get(p.divisionId) ?? '',
    stage: p.stage,
    poolLabel: p.poolLabel,
    label: p.label,
    startsAt: p.startsAt,
    durationMinutes: p.durationMinutes,
    field: p.fieldId ? (l.fields.get(p.fieldId) ?? null) : null,
    home: p.homeTeamId ? (l.teams.get(p.homeTeamId) ?? null) : null,
    away: p.awayTeamId ? (l.teams.get(p.awayTeamId) ?? null) : null,
    homePlaceholder: p.homePlaceholder,
    awayPlaceholder: p.awayPlaceholder,
    status: p.status,
    resultType: p.resultType,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    winner: winnerSide(p),
    updatedAt: updatedAt.toISOString(),
    bracketRoundName: p.bracketMatchupId ? (l.rounds.get(p.bracketMatchupId) ?? null) : null,
  };
}

async function publishedGames(t: TournamentRow) {
  const rows = await db
    .select({ id: games.id, published: games.published, publishedAt: games.publishedAt })
    .from(games)
    .where(and(eq(games.tournamentId, t.id), isNotNull(games.published)));
  return rows as { id: string; published: PublishedGameProjection; publishedAt: Date }[];
}

export async function publicSchedule(slug: string, f: { division?: string; date?: string; team?: string; field?: string }): Promise<PublicSchedule> {
  const t = await getPublicTournamentRow(slug);
  const rows = await publishedGames(t);
  const l = await lookups(t, rows.map((r) => r.published));
  let list = rows.map((r) => toPublicGame(r.id, r.published, r.publishedAt, l));
  if (f.division) list = list.filter((g) => g.divisionId === f.division);
  if (f.team) list = list.filter((g) => g.home?.id === f.team || g.away?.id === f.team);
  if (f.field) list = list.filter((g) => g.field?.id === f.field);
  if (f.date) list = list.filter((g) => g.startsAt && easternDateKey(g.startsAt) === f.date);
  list.sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9') || (a.field?.name ?? '').localeCompare(b.field?.name ?? ''));
  const [v] = await db.execute<{ n: number | null }>(sql`select max(version_number) as n from schedule_versions where tournament_id = ${t.id}`).then((r) => r.rows);
  const lastUpdated = rows.reduce<Date | null>((m, r) => (!m || r.publishedAt > m ? r.publishedAt : m), null);
  return {
    tournamentId: t.id,
    publishedAt: t.schedulePublishedAt?.toISOString() ?? null,
    versionNumber: v?.n ?? null,
    lastUpdatedAt: lastUpdated?.toISOString() ?? null,
    games: list,
  };
}

export async function publicGameLookups(t: TournamentRow, projections: PublishedGameProjection[]) {
  return lookups(t, projections);
}

export async function publicStandings(slug: string): Promise<PublicStandingsDivision[]> {
  const t = await getPublicTournamentRow(slug);
  const rows = await publishedGames(t);
  const divs = await db.select().from(divisions).where(eq(divisions.tournamentId, t.id)).orderBy(asc(divisions.sortOrder));
  const l = await lookups(t, rows.map((r) => r.published));
  const out: PublicStandingsDivision[] = [];
  for (const d of divs) {
    const poolGames = rows.map((r) => r.published).filter((p) => p.divisionId === d.id && p.stage === 'pool');
    if (!poolGames.length) continue;
    const pools = [...new Set(poolGames.map((p) => p.poolLabel ?? null))].sort();
    out.push({
      divisionId: d.id,
      divisionName: d.name,
      pools: pools.map((pool) => {
        const pg = poolGames.filter((p) => (p.poolLabel ?? null) === pool);
        const teamIds = [...new Set(pg.flatMap((p) => [p.homeTeamId, p.awayTeamId]).filter((x): x is string => !!x))];
        const finals = pg.filter((p) => p.status === 'final' && p.homeTeamId && p.awayTeamId);
        const s = computeStandings(
          teamIds.map((id) => ({ id, name: l.teams.get(id)?.name ?? 'Team' })),
          finals.map((p) => ({ homeTeamId: p.homeTeamId!, awayTeamId: p.awayTeamId!, homeScore: p.homeScore, awayScore: p.awayScore, resultType: p.resultType, forfeitWinner: p.forfeitWinner })),
          { tiebreakers: d.tiebreakers, runDifferentialCap: d.runDifferentialCap, signedOff: d.standingsSignedOff },
        );
        return {
          poolLabel: pool,
          official: s.official,
          explanation: s.explanation,
          rows: s.rows.map((r) => ({
            rank: r.rank,
            team: l.teams.get(r.teamId) ?? { id: r.teamId, name: r.teamName, city: null, state: null },
            gamesPlayed: r.gamesPlayed,
            wins: r.wins,
            losses: r.losses,
            ties: r.ties,
            runsScored: r.runsScored,
            runsAllowed: r.runsAllowed,
            runDifferential: r.runDifferential,
            winPct: r.winPct,
            unresolvedTie: r.unresolvedTie,
          })),
        };
      }),
    });
  }
  return out;
}

export async function publicTeams(slug: string) {
  const t = await getPublicTournamentRow(slug);
  const divs = await db.select().from(divisions).where(eq(divisions.tournamentId, t.id)).orderBy(asc(divisions.sortOrder));
  if (!t.publicTeamNames) return { visible: false, divisions: divs.map((d) => ({ id: d.id, name: d.name, teams: [] as PublicTeamRef[], confirmedCount: 0 })) };
  const rows = await db
    .select({ divisionId: registrations.divisionId, id: teams.id, name: teams.name, city: teams.city, state: teams.state })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.tournamentId, t.id), eq(registrations.status, 'confirmed')))
    .orderBy(asc(teams.name));
  return {
    visible: true,
    divisions: divs.map((d) => {
      const list = rows.filter((r) => r.divisionId === d.id).map(({ divisionId: _d, ...team }) => team);
      return { id: d.id, name: d.name, teams: list, confirmedCount: list.length };
    }),
  };
}

export async function gameDay() {
  const today = todayEastern();
  const weekOut = easternDateKey(new Date(Date.now() + 7 * 86400_000));
  const rows = await db
    .select()
    .from(tournaments)
    .where(and(inArray(tournaments.status, ['published_open', 'registration_closed', 'in_progress']), gte(tournaments.endsOn, today), sql`${tournaments.startsOn} <= ${weekOut}`))
    .orderBy(asc(tournaments.startsOn));
  const vmap = await venuesFor(rows.map((t) => t.id));
  return Promise.all(
    rows.map(async (t) => {
      const [c] = await db
        .select({ n: count() })
        .from(games)
        .where(and(eq(games.tournamentId, t.id), isNotNull(games.published), sql`(${games.published}->>'startsAt') is not null`));
      return {
        ...summarize(t, await publicDivisions(t), vmap.get(t.id) ?? []),
        isToday: t.startsOn <= today && t.endsOn >= today,
        publishedGameCount: Number(c?.n ?? 0),
        activeAlerts: await activeAlerts(t.id),
      };
    }),
  );
}

export async function publicVenues() {
  return db.select().from(venues).where(eq(venues.isPublished, true)).orderBy(asc(venues.name));
}

export async function publicVenue(slug: string) {
  const [v] = await db.select().from(venues).where(and(eq(venues.slug, slug), eq(venues.isPublished, true)));
  if (!v) throw notFound('Facility');
  const fs = await db.select({ id: fields.id, name: fields.name, hasLights: fields.hasLights, notes: fields.notes }).from(fields).where(and(eq(fields.venueId, v.id), eq(fields.isActive, true))).orderBy(asc(fields.name));
  return { ...v, fields: fs };
}
