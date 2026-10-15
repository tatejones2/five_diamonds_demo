# API Reference

Base path `/api`, JSON over HTTPS, same origin as the web app. Request bodies are validated
with the Zod schemas in `packages/shared/src/schemas.ts`. Response types are in
`packages/shared/src/api-types.ts`. Those two files are the typed contract. This document covers
behavior and permissions.

## Conventions

- **Auth:** cookie session (better-auth, `fd.` cookie prefix). `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **CSRF:** every non-GET request must send an `Origin` (or `Referer`) from `APP_ORIGIN`/`TRUSTED_ORIGINS`, or it gets `403`.
  Webhooks are exempt and verified by signature instead.
- **Errors:** `{ "error": { "code": ErrorCode, "message": string, "details"?: any } }`

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `details.fields` maps field → message. Roster errors include `details.roster` (row-level). |
| `UNAUTHENTICATED` | 401 | Not signed in. |
| `EMAIL_NOT_VERIFIED` / `FORBIDDEN` | 403 | `details.reason = "mfa_required"` when staff MFA is enforced. |
| `NOT_FOUND` | 404 | Also returned for **other users' private resources**, so existence never leaks. |
| `VERSION_CONFLICT` | 409 | Optimistic-concurrency failure. Reload and reapply. |
| `CAPACITY_FULL` | 409 | `details.waitlistAvailable`. |
| `DUPLICATE_REGISTRATION`, `REGISTRATION_CLOSED`, `INVALID_TRANSITION`, `CONFLICT` | 409 | |
| `DOWNSTREAM_CONFLICT` | 409 | Bracket correction affects started games. `details.impacted`, `details.options`. |
| `SCHEDULE_INVALID` | 422 | `details.issues: ScheduleIssue[]`. |
| `FILE_REJECTED` | 422 | Bad type, size, encoding, or a zip bomb. |
| `RATE_LIMITED` | 429 | |
| `INTERNAL` | 500 | Never includes internals. |

- **Concurrency:** mutable records carry `version`. Send the version you loaded, and a stale one gets `VERSION_CONFLICT`.
- **Idempotency:** registration uniqueness is enforced by a partial unique index, payment webhooks by
  `(provider, providerEventId)`, emails by `idempotencyKey`, and checkout sessions per registration version.
- **Time:** instants are ISO-8601 UTC. Admin inputs `date` + `time` are Eastern wall-clock time.
- **Caching:** public GETs send `public, max-age=15, stale-while-revalidate=30`. Private ones send `no-store`.

## Permission legend

`public` = anyone · `user` = verified adult account (manager) · `owner` = user who owns the team/registration ·
`director(T)` = super admin, org-wide director, or director assigned to tournament T ·
`org-director` = super admin or org-wide director · `scorer(G)` = director(T) or scorekeeper for T **assigned to game G** ·
`editor` = super admin or content editor · `admin` = super admin. All checks are in `apps/api/src/lib/policy.ts`.

## Public (`public`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB ping. |
| GET | `/me` | Session user + roles, or `user: null`. |
| GET | `/tournaments?when=upcoming\|past\|all&q&ageLabel&venue&availability=open\|full\|any&from&to&page&pageSize` | Published only. Drafts never appear. |
| GET | `/tournaments/:slug` | Detail + divisions (spots shown only while registration is open) + active alerts. |
| GET | `/tournaments/:slug/games?division&date&team&field` | **Published projection only.** |
| GET | `/tournaments/:slug/teams` | Confirmed team names (if `publicTeamNames`). Never rosters. |
| GET | `/tournaments/:slug/standings` | From final pool games. `official` false until tie-breakers are signed off. |
| GET | `/tournaments/:slug/brackets` | Published brackets. Games use the published projection. |
| GET | `/tournaments/:slug/announcements` | `{ active, history }` |
| GET | `/alerts` | All active alerts (org-wide + tournaments). |
| GET | `/game-day` | Events today through +7 days, with alerts. |
| GET | `/facilities`, `/facilities/:slug` | Published venues + active fields. |
| GET | `/content/pages?key=` · `/content/news[?key=slug]` · `/content/sponsors` · `/content/staff` · `/content/faqs` | Published + approved only. Legal pages require `ownerApproved`. Staff contact details require permission. |
| POST | `/contact` | Rate limited to 5 per 10 min per IP. A filled honeypot gets `202` and is discarded. |
| GET | `/sitemap.xml` (root, not `/api`) | Public URLs only. |

## Auth (`/api/auth/*`, better-auth)

`POST sign-up/email`, `sign-in/email`, `sign-out`, `send-verification-email`, `request-password-reset`,
`reset-password`, `change-password`, `two-factor/enable`, `two-factor/verify-totp`, and `GET verify-email`.
Rate limits: sign-in 8/min, sign-up 5/10 min, reset 5/10 min, TOTP 6/min. Passwords must be 10–128 characters, and
a password reset revokes other sessions.

## Manager (`user`, scoped to own records)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST | `/me/teams` | user | Max 25 active teams per account. |
| GET/PATCH/DELETE | `/me/teams/:teamId` | owner | DELETE archives, and is blocked while registrations are active. |
| GET/PUT | `/me/teams/:teamId/roster` | owner | PUT replaces atomically (all rows valid or nothing). Refreshes unlocked event snapshots and returns `frozenRegistrations`. |
| POST | `/me/teams/:teamId/roster/import-preview` | owner | multipart `file` (.csv/.xlsx, ≤256 KB, ≤100 rows). **Persists nothing.** |
| GET | `/me/roster-template.csv` | user | |
| POST | `/registrations` | owner of `teamId` | Locks the division row, so the last spot can't be oversold. Returns `{ registration, outcome }`. |
| GET | `/me/registrations`, `/me/registrations/:id`, `/me/registrations/:id/snapshots` | owner | |
| POST | `/me/registrations/:id/withdraw` | owner | `{ version, reason }` |
| POST | `/me/registrations/:id/checkout` | owner | `409` while no provider is configured. Simulated provider in dev only. |
| GET | `/me/games` | user | Published games for own teams. |
| GET/PUT | `/me/notification-preferences` | user | |

## Staff (`/api/admin/*`, any staff role required, plus the rule shown)

**Tournaments & registrations**

| Method | Path | Permission |
|---|---|---|
| GET | `/tournaments` | staff (filtered to scope) |
| POST | `/tournaments` | org-director |
| GET/PATCH | `/tournaments/:id` | director(T) |
| POST | `/tournaments/:id/transition` `{version,to,reason}` | director(T). Reason required for cancel/reversal. |
| GET | `/tournaments/:id/preview` | director(T). Public projection, drafts included. |
| POST | `/tournaments/:id/roster-lock` `{version,locked,reason?}` | director(T). Unlock requires a reason. |
| POST | `/tournaments/:id/divisions` · PATCH/DELETE `/divisions/:id` | director(T) |
| GET | `/tournaments/:id/registrations[.csv]?status&q&divisionId` | director(T). CSV is formula-safe and the export is audited. |
| GET | `/registrations/:id` | director(T) |
| POST | `/registrations/:id/status` `{version,to,reason,overrideCapacity}` | director(T). Override is audited. |
| POST | `/registrations/:id/payment-status` | director(T). `paid_verified` is rejected (provider only). |
| GET/PUT | `/registrations/:id/roster` | director(T). View is audited. PUT is a logged revision with a reason. |
| GET/PUT | `/teams/:id/roster` | super admin, or director of a tournament the team entered. PUT requires a reason. |
| GET | `/venues` · POST `/venues` · PATCH `/venues/:id` · POST `/venues/:id/fields` · PATCH `/fields/:id` | GET: staff. Writes: org-director. |

**Schedule, games, brackets**

| Method | Path | Permission |
|---|---|---|
| GET | `/tournaments/:id/games` | director(T). Draft state. |
| POST | `/tournaments/:id/schedule/draft` (create/update) · DELETE `/schedule/draft/:gameId?version=` | director(T) |
| POST | `/tournaments/:id/schedule/validate` | director(T). Returns `{token, issues, canPublish, changes}`. |
| POST | `/tournaments/:id/schedule/publish` `{previewToken, note, acknowledgeWarnings}` | director(T). Fails if the draft changed since the preview. |
| GET | `/tournaments/:id/schedule/history` | director(T) |
| GET | `/games/:id` | scorer(G) |
| PATCH | `/games/:id` | scorer(G) for status and score. **Director only** for moves and for correcting a final. |
| GET | `/my-games` | staff (scorekeepers see assigned games only) |
| POST | `/game-assignments` `{email\|userId, gameIds}` | director(T). Assignee must hold the scorekeeper role for T. |
| GET/POST | `/tournaments/:id/brackets` | director(T) |
| POST | `/brackets/:id/seeds` · `/schedule-matchup` · `/override` · `/publish` · DELETE `/brackets/:id` | director(T) |

**Notices, staff, audit**

| Method | Path | Permission |
|---|---|---|
| GET | `/announcements?tournamentId` | director(T), or admin for org-wide |
| POST/PATCH | `/announcements[/:id]` · POST `/announcements/:id/action` `{publish\|all_clear\|withdraw}` | director(T), or admin for org scope |
| GET/POST/DELETE | `/staff[/:id]` | admin |
| GET | `/audit-events?tournamentId&before&limit` | director(T), or admin for the global log |
| GET | `/overview` | staff |

**Content** (`editor`): `/content/pages`, `/content/pages/:key` (PUT draft, POST `/publish`),
`/content/revisions/:type/:id`, `/news`, `/news/:id`, `/news/:id/publish`, `/sponsors[/:id]`,
`/staff-profiles[/:id]`, `/faqs[/:id]`, `/inquiries`, `/inquiries/:id/status`.

## Webhooks & dev

- `POST /webhooks/payments/:provider`: raw body, signature verified, idempotent. Only `simulated` exists today.
- `GET /dev/mailbox?to=` and `POST /dev/simulated-payment`: **not registered when `NODE_ENV=production`.**
