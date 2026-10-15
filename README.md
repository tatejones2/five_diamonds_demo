# 5 Diamonds Tournament Baseball

Website and tournament-management platform: public tournament finder and game-day views, coach/manager
portal (multi-team, rosters, native registration), and staff tools (native schedule builder, brackets,
score entry, notices, CMS). Built to `5_diamonds_website_development_spec_v1.md`.

> **Pre-launch.** All tournaments, teams, players, venues and copy in the seed data are fictional and
> labeled **DEMO**. Brand colors and the logo are temporary. Nothing has been deployed.

## Quick start

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env        # set AUTH_SECRET: openssl rand -base64 32
npm run db:up               # Postgres 16 on localhost:5442 (dev + test databases)
npm run db:migrate
npm run db:seed             # RESETS the dev DB and loads DEMO data
npm run dev                 # http://localhost:5173
```

DEMO accounts (password `demo-password-2026`, all `@demo.5diamonds.invalid`):
`admin`, `director`, `scorekeeper`, `editor`, `coach1`, `coach2`, `coach3`.
Dev emails (verification, reset) land in the dev mailbox: `GET /api/dev/mailbox?to=<email>`.

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

[IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) (status) · [DECISIONS](DECISIONS.md) (ADRs + pending owner decisions) ·
[ARCHITECTURE](ARCHITECTURE.md) · [DATA_MODEL](DATA_MODEL.md) · [API](API.md) ·
[CONTENT_INVENTORY](CONTENT_INVENTORY.md) · [DEPLOYMENT](DEPLOYMENT.md) · [ADMIN_GUIDE](ADMIN_GUIDE.md)
