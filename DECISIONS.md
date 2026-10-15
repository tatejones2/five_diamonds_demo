# Decisions Log

Each entry: decision, rationale, and whether it's **Confirmed** (by owner, per spec §1),
an **Assumption** (implementation default, replaceable), or **Pending** (owner must decide).

## Confirmed (spec §1 — authoritative)

| ID | Decision |
|---|---|
| C1 | Native on-site registration; no third-party registration dependency. |
| C2 | One manager account can own multiple teams/registrations. |
| C3 | Managers edit rosters (name + jersey #) and import files with preview/errors. |
| C4 | Staff author schedules natively in admin; file import is optional convenience. |
| C5 | Staff build, seed, edit, publish and operate brackets natively in admin. |
| C6 | Authorized staff enter/correct scores manually. |
| C7 | Keep approved logo/brand colors; modernize layout. No rebrand. |
| C8 | Launch the complete platform; all P0 flows required for public launch. |
| C9 | No Perfect Game build-around, sync, or API. Affiliate refs are editable content. |
| C10 | Hosting portable; DigitalOcean is a candidate, not a mandate. |
| C11 | Checkout will redirect to an external provider (TBD). No real charges in dev. |

## Architecture decisions (ADRs)

### ADR-001 Monorepo with npm workspaces — Assumption
`apps/web`, `apps/api`, `packages/shared`. npm is already installed; pnpm is not, and
workspaces cover our needs. Shared Zod schemas give one contract for client + server.

### ADR-002 Fastify over NestJS — Assumption
Fastify 5: small surface, first-class schema/hooks, fast, easy to test with `inject()`.
NestJS's DI/decorator layer adds ceremony without solving a problem we have. Policy
guards are implemented as explicit functions called inside handlers (greppable, testable).

### ADR-003 Drizzle ORM + SQL migrations — Assumption
Drizzle keeps SQL visible (needed for `SELECT … FOR UPDATE`, partial unique indexes,
check constraints) and generates plain SQL migration files that are reviewed and committed.

### ADR-004 better-auth for authentication — Assumption
Maintained library providing email/password, email verification, password reset,
cookie sessions, session revocation, rate limiting, and a TOTP two-factor plugin (staff MFA).
We do not implement password hashing or session crypto ourselves.

### ADR-005 Dependency majors — Assumption
React 19, React Router 7, TypeScript 5.9, Tailwind 4, Zod 4, Fastify 5, Drizzle 0.45, better-auth 1.7,
**Vite 8 + Vitest 4** (Vitest 3 had open advisories; Vitest 4 requires Vite 8, so the web app moved to
Vite 8 too and the tree has a single Vite). React Router 8 and TypeScript 7 exist; upgrading is a tracked
follow-up. Versions are locked in `package-lock.json`. `npm audit --omit=dev` is clean. The remaining
moderate advisories are esbuild's *dev server* (pulled in by drizzle-kit/tsup), which this project never runs.

### ADR-015 Spreadsheet parsing: read-excel-file, files never stored — Assumption
`exceljs` depends on several unmaintained packages, so XLSX import uses the maintained `read-excel-file`.
Uploads are limited to 256 KB / 100 rows. XLSX files are checked for a ZIP signature and their
uncompressed size is read from the central directory (zip-bomb guard) before parsing. CSV must be NUL-free UTF-8.
Roster files are parsed in memory and **discarded**. Nothing is stored or served back, which removes
the need for malware scanning of roster uploads. (Media uploads, when built, will need scanning.)

### ADR-016 Roster lock semantics — Assumption
A team roster is shared across tournaments. Locking (deadline or "Lock rosters now") freezes that
event's **snapshot**. The manager can keep editing the team roster for other events, and the UI says
plainly that changes no longer apply to the locked event. Staff can revise a locked snapshot with a reason (audited).

### ADR-017 Final-result corrections are director-only — Assumption
Scorekeepers can enter and finalize scores on assigned games but can't change a final or move a game.
Pending the owner's "final-results approval policy" (spec §19).

### ADR-018 Standings computed on read — Assumption
No `standings_snapshots`. Standings come from final pool games every time, so corrections can never
leave stale standings. Teams without a final game rank after teams that have played (no win % yet).

### ADR-019 Rate limiting — Assumption
Auth endpoints use better-auth's DB-backed limiter (works across instances). The general API limiter and
the contact-form limiter are in-memory per instance. Add a shared store (Redis) if exact global limits are
needed with several API instances.

### ADR-006 Same-origin API + cookie sessions + CSRF guard — Assumption
Web is served with `/api` on the same origin (Vite proxy in dev; reverse proxy in prod).
Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production. All state-changing requests
must carry an allowed `Origin` and a JSON content type (or multipart for uploads); better-auth
applies its own origin checks to `/api/auth/*`.

### ADR-007 Draft vs published schedule — Assumption
`games` holds the working (draft) state. Publishing a schedule validates all games in the
tournament inside a transaction (with row locks), then copies each game's public projection
into `games.published` (JSONB) and writes `schedule_versions` + `game_versions` rows.
Public endpoints read **only** the published projection. Score/status updates on an already
published game are operational and go live on save (spec §1 "public pages update after
save/publish"), also versioned in `game_versions`.

### ADR-008 No separate `players` identity table — Assumption (privacy)
Spec §14 lists `players`. Roster entries store the player's name + jersey directly on
`team_roster_entries`; we deliberately do **not** create a cross-team player identity, which
would build longitudinal profiles of minors. Revisit only with an approved data policy.

### ADR-009 Roles as enum + scoped assignments — Assumption
Spec lists `roles` and `role_assignments`. Roles are a fixed Postgres enum
(`super_admin`, `tournament_director`, `scorekeeper`, `content_editor`); `role_assignments`
optionally scopes a role to one tournament. Scorekeepers are additionally assigned to
specific games via `game_assignments`. "Manager" is implicit for any verified adult account.

### ADR-010 Rich text as Markdown — Assumption
CMS bodies are stored as Markdown and rendered with `react-markdown` without raw HTML,
which makes stored XSS impossible by construction (no HTML passthrough).

### ADR-011 Time handling — Confirmed by spec §4/§9
Store `timestamptz` (UTC). Display in `America/New_York` via `Intl.DateTimeFormat`
(DST-aware). Admin inputs are interpreted as Eastern wall-clock time and converted server-side.

### ADR-012 Email via outbox — Assumption
Mail is written to `notification_deliveries` and sent by a worker with retry/backoff.
In development the adapter is `dev-mailbox` (stores messages; dev-only endpoint lets tests read
verification links). Failures are surfaced to the user/staff, never reported as success.

### ADR-013 Payments — Confirmed boundary, provider Pending
`registrations.payment_status` is separate from registration status. A
`PaymentProviderAdapter` interface exists with a **`simulated`** implementation only, which is
rejected at startup when `NODE_ENV=production`. Browser return URLs never mark anything paid.

### ADR-014 Tie-breakers and formats are not assumed — Confirmed by spec §10
Standings show W/L/T, runs scored/allowed and differential, labeled **Unofficial** until a
director configures and signs off tie-breakers. Seeds are always manually settable. Only
single-elimination brackets are implemented; other formats are listed as unsupported.

## Content/brand assumptions

| ID | Assumption | Replace when |
|---|---|---|
| B1 | Temporary wordmark "5 Diamonds" + diamond glyph, marked `TEMP` in code | Owner supplies SVG logo |
| B2 | Temporary palette tokens (navy/red/cream) in `apps/web/src/styles/tokens.css` | Owner supplies brand values |
| B3 | Fonts: Oswald (display) + Inter (UI), both SIL OFL — license-safe | Owner prefers others |
| B4 | No Perfect Game branding/partnership claims on new site | Owner confirms relationship |
| B5 | Legacy staff names/phones/emails are **not** seeded; staff page is CMS-driven | Owner confirms staff list |
| B6 | All tournaments, venues, teams and players in seed data are fictional and labeled `DEMO` | — |
| B7 | Text uses darker variants of brand colors (`brand-sky-ink`, `brand-flame-ink`) to meet WCAG AA | Owner supplies palette (re-check contrast) |
| B8 | Registered **team names are public by default** (per-tournament `publicTeamNames` switch). Rosters are never public | Owner decides display policy |
| B9 | A registration under review **holds a capacity slot** (no oversubscription in review mode) | Owner confirms waitlist/review policy |

## Pending owner decisions (copied from spec §19 — launch blockers marked ⛔)

- ⛔ Official logo files, brand colors, photography + usage rights
- ⛔ Rules per age group, classifications, eligibility, roster cutoffs, time limits
- ⛔ Scheduling pattern: fields, game lengths, pool games, rest; a real anonymized example event
- ⛔ Bracket formats in use (double-elim, consolation, guarantees), tie-breaker order, byes
- ⛔ Staff roles and final-results approval policy
- ⛔ Auto-confirm vs review; waitlist; payment-confirmation policy
- ⛔ Official copy: venues, staff, partners, history, sponsors, privacy/terms (legal review)
- ⛔ Public display policy for registered team names (default: names public only when approved)
- ⛔ Contact channels; email at launch; mail provider
- ⛔ Peak volume + uptime expectations; final hosting
- ⛔ Historical data migration; domain ownership/access
- Deferred: payment provider, hosting vendor, Perfect Game/3rd-party integration, SMS/push,
  automatic schedule optimization
