# 5 Diamonds Tournament Baseball

Website and tournament-management platform: public tournament finder and game-day views, coach/manager
portal (multi-team, rosters, native registration), and staff tools (native schedule builder, brackets,
score entry, notices, CMS). Built to `5_diamonds_website_development_spec_v1.md`.

> **Pre-launch.** All tournaments, teams, players, venues and copy in the seed data are fictional and
> labeled **DEMO**. Brand colors and the logo are temporary. Nothing has been deployed.

## Quick start

Requires Node 22+ and Docker Desktop (running). Step-by-step guide: **[LOCAL_SETUP.md](LOCAL_SETUP.md)**.

```bash
npm start              # installs, creates .env, starts Postgres, migrates, seeds DEMO data (first run), runs the site
npm start -- --reset   # same, but reloads fresh DEMO data
```

Opens http://localhost:5173. DEMO accounts (password `demo-password-2026`, all `@demo.5diamonds.invalid`):
`admin`, `director`, `scorekeeper`, `editor`, `coach1`, `coach2`, `coach3`.
Dev emails land in the dev mailbox: `GET /api/dev/mailbox?to=<email>`.

## Tests

```bash
npm test             # domain unit tests (shared) + API integration tests on real Postgres
npm run test:e2e     # Playwright: desktop + phone, axe accessibility (reseeds the dev DB)
npm run typecheck
npm run build
```

## Layout

| Path | What |
|---|---|
| `packages/shared` | Zod API contracts, enums, and pure domain logic (schedule validation, brackets, standings, rosters/CSV, Eastern time) |
| `apps/api` | Fastify API, Drizzle schema + migrations, better-auth, services, policies |
| `apps/web` | React SPA (public site, coach portal, admin) |
| `infra/` | Caddy config, load test, DB init |

## Documents

[LOCAL_SETUP](LOCAL_SETUP.md) · [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) (status) · [DECISIONS](DECISIONS.md) (ADRs + pending owner decisions) ·
[ARCHITECTURE](ARCHITECTURE.md) · [DATA_MODEL](DATA_MODEL.md) · [API](API.md) ·
[CONTENT_INVENTORY](CONTENT_INVENTORY.md) · [DEPLOYMENT](DEPLOYMENT.md) · [ADMIN_GUIDE](ADMIN_GUIDE.md)
