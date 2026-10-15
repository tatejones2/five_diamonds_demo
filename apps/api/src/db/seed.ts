// DEMO fixtures (spec §20.3). Everything here is fictional and labeled DEMO.
// Emails use the reserved .invalid TLD so nothing can ever be delivered to a real person.
// Runs through the real service layer so seeding exercises production code paths.
import { easternDateKey } from '@fd/shared';
import { eq } from 'drizzle-orm';
import { auth } from '../auth';
import { isProd } from '../config';
import type { AuthedContext } from '../lib/context';
import { actOnAnnouncement, createAnnouncement } from '../services/announcements';
import { createBracket, publishBracket, scheduleMatchup, setSeeds } from '../services/brackets';
import { publishPage, savePage, saveNews, setNewsPublished, upsertFaq } from '../services/content';
import { updateGame } from '../services/games';
import { createRegistration } from '../services/registrations';
import { previewSchedule, publishSchedule, saveDraftGame } from '../services/schedule';
import { createTeam, replaceRoster } from '../services/teams';
import { createDivision, createTournament, getAdminTournament, transitionTournament } from '../services/tournaments';
import { db, pool } from './client';
import { bracketMatchups, brackets, fields, gameAssignments, games, roleAssignments, tournaments, user, venues } from './schema';
import { resetDatabase } from './reset';

export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'demo-password-2026';

const dayOffset = (n: number) => easternDateKey(new Date(Date.now() + n * 86400_000));

async function makeUser(email: string, name: string) {
  await auth.api.signUpEmail({ body: { email, password: DEMO_PASSWORD, name } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u!;
}

const ctxFor = (u: typeof user.$inferSelect, roles: AuthedContext['roles'] = []): AuthedContext => ({
  user: { id: u.id, name: u.name, email: u.email, emailVerified: true, twoFactorEnabled: false },
  roles,
  ip: 'seed',
});

const PLAYER_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];

export async function seed() {
  if (isProd) throw new Error('Refusing to seed production.');
  await resetDatabase();

  // ---- People (DEMO)
  const admin = await makeUser('admin@demo.5diamonds.invalid', 'DEMO Super Admin');
  const director = await makeUser('director@demo.5diamonds.invalid', 'DEMO Tournament Director');
  const scorekeeper = await makeUser('scorekeeper@demo.5diamonds.invalid', 'DEMO Scorekeeper');
  const editor = await makeUser('editor@demo.5diamonds.invalid', 'DEMO Content Editor');
  const coach1 = await makeUser('coach1@demo.5diamonds.invalid', 'DEMO Coach One');
  const coach2 = await makeUser('coach2@demo.5diamonds.invalid', 'DEMO Coach Two');
  const coach3 = await makeUser('coach3@demo.5diamonds.invalid', 'DEMO Coach Three');
  await db.insert(roleAssignments).values([
    { userId: admin.id, role: 'super_admin', tournamentId: null },
    { userId: director.id, role: 'tournament_director', tournamentId: null },
    { userId: editor.id, role: 'content_editor', tournamentId: null },
  ]);
  const adminCtx = ctxFor(admin, [{ role: 'super_admin', tournamentId: null }]);

  // ---- Venues (fictional)
  const [v1] = await db
    .insert(venues)
    .values({ slug: 'demo-riverside-park', name: 'DEMO Riverside Park', addressLine1: '100 Example Way', city: 'Greensboro', state: 'NC', postalCode: '27400', directions: 'DEMO directions — replace with verified directions.', parking: 'DEMO parking notes.', policies: 'DEMO facility policies.', isPublished: true, isDemo: true })
    .returning();
  const [v2] = await db
    .insert(venues)
    .values({ slug: 'demo-oak-hollow-complex', name: 'DEMO Oak Hollow Complex', addressLine1: '200 Sample Road', city: 'High Point', state: 'NC', postalCode: '27260', directions: 'DEMO directions.', parking: 'DEMO parking notes.', isPublished: true, isDemo: true })
    .returning();
  const f = await db
    .insert(fields)
    .values([
      { venueId: v1!.id, name: 'Field 1', hasLights: true },
      { venueId: v1!.id, name: 'Field 2', hasLights: true },
      { venueId: v1!.id, name: 'Field 3' },
      { venueId: v2!.id, name: 'Field A', hasLights: true },
      { venueId: v2!.id, name: 'Field B' },
    ])
    .returning();

  // ---- Teams (DEMO) with synthetic rosters
  const teamSpecs = [
    ['DEMO Thunder', '10U', coach1], ['DEMO Lightning', '10U', coach1], ['DEMO Storm', '10U', coach2], ['DEMO Cyclones', '10U', coach2],
    ['DEMO Comets', '10U', coach3], ['DEMO Rockets', '10U', coach3],
    ['DEMO Bulldogs', '12U', coach1], ['DEMO Hornets', '12U', coach2], ['DEMO Mustangs', '12U', coach3], ['DEMO Falcons', '12U', coach3],
  ] as const;
  const teamsBy: Record<string, { id: string; owner: typeof coach1 }> = {};
  for (const [name, age, owner] of teamSpecs) {
    const t = await createTeam(ctxFor(owner), { name, ageGroup: age, organizationName: 'DEMO Baseball Club', city: 'Greensboro', state: 'NC', coachContactName: owner.name, coachContactPhone: null, coachContactEmail: owner.email });
    const initials = name.replace('DEMO ', '').slice(0, 3);
    await replaceRoster(
      ctxFor(owner),
      t.id,
      0,
      PLAYER_NAMES.slice(0, 11).map((p, i) => ({ playerName: `${p} ${initials}demo`, jerseyNumber: String(i === 0 ? '00' : i * 3) })),
      { staff: false, reason: null },
    );
    teamsBy[name] = { id: t.id, owner };
  }

  // ---- Tournament A: in progress today (game-day demo)
  const tA = await createTournament(adminCtx, {
    title: 'DEMO Fall Classic',
    slug: 'demo-fall-classic',
    startsOn: dayOffset(0),
    endsOn: dayOffset(1),
    region: 'Triad, NC (DEMO)',
    category: 'Weekend tournament',
    summary: 'Fictional demonstration event. Not a real tournament.',
    description: '**DEMO EVENT.** This tournament, its teams and results are fictional sample data for testing the platform.',
    registrationOpensAt: null,
    registrationClosesAt: null,
    rosterLocksAt: null,
    feeInfo: 'DEMO — no fees confirmed.',
    refundPolicyUrl: null,
    rulesText: 'DEMO rules placeholder. Owner-approved rules required before real events.',
    operationalContacts: 'DEMO contact — replace with approved event contact.',
    reviewMode: 'auto_confirm',
    waitlistEnabled: true,
    paymentRequired: false,
    publicTeamNames: true,
    fieldBufferMinutes: 15,
    minTeamRestMinutes: 30,
    venueIds: [v1!.id],
  });
  await db.update(tournaments).set({ isDemo: true }).where(eq(tournaments.id, tA.id));
  await createDivision(adminCtx, tA.id, { name: '10U', ageLabel: '10U', classification: null, capacity: 6, rosterMin: 9, rosterMax: 15, allowDuplicateJersey: false, rulesText: null, gameFormat: 'DEMO: pool play then single elimination', defaultGameMinutes: 90, tiesAllowedInPool: true, tiebreakers: [], runDifferentialCap: null, standingsSignedOff: false, sortOrder: 0 });
  let full = await getAdminTournament(tA.id);
  await transitionTournament(adminCtx, tA.id, full.version, 'published_open', null);
  const div10 = full.divisions[0]!;
  const tenU = ['DEMO Thunder', 'DEMO Lightning', 'DEMO Storm', 'DEMO Cyclones', 'DEMO Comets', 'DEMO Rockets'];
  for (const n of tenU) await createRegistration(ctxFor(teamsBy[n]!.owner), { divisionId: div10.id, teamId: teamsBy[n]!.id, joinWaitlistIfFull: true });
  full = await getAdminTournament(tA.id);
  await transitionTournament(adminCtx, tA.id, full.version, 'registration_closed', null);
  full = await getAdminTournament(tA.id);
  await transitionTournament(adminCtx, tA.id, full.version, 'in_progress', null);

  // Pool play: two pools of three on Fields 1–3, today.
  const T = (n: string) => teamsBy[n]!.id;
  const pool = [
    ['A', 'DEMO Thunder', 'DEMO Lightning', 0, '08:00'], ['B', 'DEMO Storm', 'DEMO Cyclones', 1, '08:00'],
    ['A', 'DEMO Comets', 'DEMO Thunder', 0, '10:00'], ['B', 'DEMO Rockets', 'DEMO Storm', 1, '10:00'],
    ['A', 'DEMO Lightning', 'DEMO Comets', 0, '12:00'], ['B', 'DEMO Cyclones', 'DEMO Rockets', 1, '12:00'],
  ] as const;
  const created: string[] = [];
  for (const [p, h, a, fi, time] of pool) {
    const g = await saveDraftGame(adminCtx, tA.id, { divisionId: div10.id, stage: 'pool', poolLabel: p, label: null, fieldId: f[fi]!.id, date: dayOffset(0), time, durationMinutes: 90, homeTeamId: T(h), awayTeamId: T(a), homePlaceholder: null, awayPlaceholder: null });
    created.push(g.id);
  }
  // Bracket: top 4 → semis + final tomorrow (seeds set manually; standings are unofficial).
  const b = await createBracket(adminCtx, tA.id, { divisionId: div10.id, name: '10U Championship Bracket', size: 4, entrants: 4 });
  const bv = async () => (await db.select().from(brackets).where(eq(brackets.id, b.id)))[0]!;
  await setSeeds(adminCtx, b.id, { version: (await bv()).version, seeds: [{ seed: 1, teamId: T('DEMO Thunder') }, { seed: 2, teamId: T('DEMO Storm') }, { seed: 3, teamId: T('DEMO Lightning') }, { seed: 4, teamId: T('DEMO Cyclones') }], reason: null });
  const ms = await db.select().from(bracketMatchups).where(eq(bracketMatchups.bracketId, b.id));
  const byKey = (k: string) => ms.find((m) => m.key === k)!.id;
  await scheduleMatchup(adminCtx, b.id, { version: (await bv()).version, matchupId: byKey('R1M1'), fieldId: f[0]!.id, date: dayOffset(1), time: '09:00', durationMinutes: 90 });
  await scheduleMatchup(adminCtx, b.id, { version: (await bv()).version, matchupId: byKey('R1M2'), fieldId: f[1]!.id, date: dayOffset(1), time: '09:00', durationMinutes: 90 });
  await scheduleMatchup(adminCtx, b.id, { version: (await bv()).version, matchupId: byKey('R2M1'), fieldId: f[0]!.id, date: dayOffset(1), time: '12:00', durationMinutes: 120 });
  await publishBracket(adminCtx, b.id, (await bv()).version);

  const preview = await previewSchedule(tA.id);
  await publishSchedule(adminCtx, tA.id, { previewToken: preview.token, note: 'DEMO initial schedule', acknowledgeWarnings: true });

  // Two pool games final (live results).
  for (const [id, hs, as] of [[created[0]!, 7, 4], [created[1]!, 3, 3]] as const) {
    const [g] = await db.select().from(games).where(eq(games.id, id));
    await updateGame(adminCtx, id, { version: g!.version, status: 'final', resultType: 'played', homeScore: hs, awayScore: as, forfeitWinner: null, reason: null });
  }
  // Assign the scorekeeper to the next pool game only.
  await db.insert(roleAssignments).values({ userId: scorekeeper.id, role: 'scorekeeper', tournamentId: tA.id });
  await db.insert(gameAssignments).values({ userId: scorekeeper.id, gameId: created[2]!, assignedBy: admin.id });

  const notice = await createAnnouncement(adminCtx, {
    tournamentId: tA.id, scope: 'tournament', scopeId: tA.id, severity: 'advisory', category: 'weather_delay',
    title: 'DEMO: Lightning watch this afternoon',
    body: 'DEMO NOTICE — fictional. Staff are monitoring weather. If play is suspended, check this page for updated start times.',
    effectiveAt: null, expiresAt: null, affectedGameIds: [], source: 'DEMO', linkUrl: null,
  });
  await actOnAnnouncement(adminCtx, notice.id, { version: notice.version, action: 'publish', message: null });

  // ---- Tournament B: upcoming, registration open
  const tB = await createTournament(adminCtx, {
    title: 'DEMO Spring Opener', slug: 'demo-spring-opener', startsOn: dayOffset(21), endsOn: dayOffset(22), region: 'Triad, NC (DEMO)', category: 'Weekend tournament',
    summary: 'Fictional upcoming event for testing registration.', description: '**DEMO EVENT.** Fictional data.', registrationOpensAt: null, registrationClosesAt: new Date(Date.now() + 14 * 86400_000).toISOString(), rosterLocksAt: new Date(Date.now() + 18 * 86400_000).toISOString(),
    feeInfo: 'DEMO — no fees confirmed.', refundPolicyUrl: null, rulesText: null, operationalContacts: null, reviewMode: 'manual_review', waitlistEnabled: true, paymentRequired: false, publicTeamNames: true, fieldBufferMinutes: 15, minTeamRestMinutes: 30, venueIds: [v1!.id, v2!.id],
  });
  await db.update(tournaments).set({ isDemo: true }).where(eq(tournaments.id, tB.id));
  for (const [name, age, cap] of [['10U', '10U', 8], ['12U', '12U', 2]] as const) {
    await createDivision(adminCtx, tB.id, { name, ageLabel: age, classification: null, capacity: cap, rosterMin: 9, rosterMax: 15, allowDuplicateJersey: false, rulesText: null, gameFormat: null, defaultGameMinutes: 90, tiesAllowedInPool: true, tiebreakers: [], runDifferentialCap: null, standingsSignedOff: false, sortOrder: name === '10U' ? 0 : 1 });
  }
  const fb = await getAdminTournament(tB.id);
  await transitionTournament(adminCtx, tB.id, fb.version, 'published_open', null);
  await createRegistration(ctxFor(coach2), { divisionId: fb.divisions[1]!.id, teamId: T('DEMO Hornets'), joinWaitlistIfFull: false });

  // ---- Tournament C: draft (staff-only)
  await createTournament(adminCtx, {
    title: 'DEMO Winter Showcase (draft)', slug: 'demo-winter-showcase', startsOn: dayOffset(60), endsOn: dayOffset(61), region: null, category: null, summary: 'Draft — not public.', description: null,
    registrationOpensAt: null, registrationClosesAt: null, rosterLocksAt: null, feeInfo: null, refundPolicyUrl: null, rulesText: null, operationalContacts: null, reviewMode: 'manual_review', waitlistEnabled: false, paymentRequired: false, publicTeamNames: true, fieldBufferMinutes: 0, minTeamRestMinutes: 0, venueIds: [],
  });

  // ---- Content (DEMO copy, clearly marked)
  const editorCtx = ctxFor(editor, [{ role: 'content_editor', tournamentId: null }]);
  const pages: [string, string, string][] = [
    ['home_intro', 'Tournament baseball in the Triad', '[DEMO COPY — replace with owner-approved introduction.] Weekend youth baseball tournaments across the North Carolina Triad.'],
    ['about', 'About 5 Diamonds', '[DEMO COPY — owner-approved history required.]\n\nThe legacy site did not include a published history, so this page awaits approved copy.'],
    ['rules', 'Rules', '[DEMO COPY — owner-approved rules required.]\n\nEvent-specific rules appear on each tournament page.'],
    ['get_involved', 'Get Involved', '[DEMO COPY] Interested in bringing your team or helping run events? Contact us.'],
  ];
  for (const [key, title, body] of pages) {
    await savePage(editorCtx, key, { version: 0, title, body, seoDescription: null });
    await publishPage(editorCtx, key, { version: 1 });
  }
  const faqSeed: [string, string][] = [
    ['How do I register a team?', 'Create a free team manager account, add your team, then choose a division on the tournament page. [DEMO FAQ]'],
    ['Are player rosters public?', 'No. Rosters are visible only to the team manager and authorized tournament staff.'],
    ['Where do I find game times on game day?', 'Use Game Day in the top menu, or open the tournament and choose Schedule. Times are Eastern.'],
  ];
  for (const [i, [q, a]] of faqSeed.entries()) {
    await upsertFaq(editorCtx, null, { question: q, answer: a, isPublished: true, sortOrder: i });
  }
  const n = await saveNews(editorCtx, null, null, { title: 'DEMO: Welcome to the new site', slug: 'demo-welcome', excerpt: 'Sample news post for testing.', body: '[DEMO POST] This is placeholder news content.', tournamentId: null });
  await setNewsPublished(editorCtx, n.id, n.version, true);

  return { password: DEMO_PASSWORD };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(({ password }) => {
      console.log('\nDEMO data seeded. Accounts (password: %s):', password);
      for (const r of ['admin', 'director', 'scorekeeper', 'editor', 'coach1', 'coach2', 'coach3']) console.log(`  ${r}@demo.5diamonds.invalid`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
