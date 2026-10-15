# Deployment

**Nothing has been deployed.** DNS, production hosting and the payment provider all need explicit owner
approval (spec §20.8). This guide describes a portable container deployment. DigitalOcean is the leading
candidate, but nothing here depends on it.

## Components

| Component | Image / service | Notes |
|---|---|---|
| API | `Dockerfile` target `api` (Node 22, non-root, healthcheck `/api/health`) | Stateless. Run 2+ instances for availability. Includes the email outbox worker. |
| Web + proxy | `Dockerfile` target `web` (Caddy) | Serves the SPA, proxies `/api` and `/sitemap.xml`, sets CSP/HSTS, 301 legacy redirects, automatic TLS. |
| Database | **Managed PostgreSQL 16** | Daily automated backups + point-in-time recovery. Not a container in production. |
| Mail | SMTP provider (TBD) | `MAIL_DRIVER=smtp`, `SMTP_URL`. Set up SPF/DKIM/DMARC on the sending domain. |
| Object storage | S3-compatible (e.g. DO Spaces) | Needed once media uploads ship. Roster imports are never stored. |

### Hosting candidates

- **A. DigitalOcean:** App Platform (2 API containers + 1 web) or 2 Droplets behind a load balancer,
  Managed PostgreSQL (with standby for HA), Spaces. A 1 GB droplet is **not** assumed to be enough. Size from load-test results.
- **B. Any container host** (Render, Fly.io, AWS ECS/Lightsail, Azure Container Apps): same images, managed Postgres.

## Environment (production)

Copy `.env.example` into the host's secret manager. The API **refuses to start** in production if:
`PAYMENT_PROVIDER=simulated`, `MAIL_DRIVER=dev-mailbox`, `APP_ORIGIN` isn't `https://`, or `STORAGE_DRIVER=local`.
Also set `STAFF_MFA_REQUIRED=true` and a 32+ character random `AUTH_SECRET` (`openssl rand -base64 32`).
Dev-only routes (`/api/dev/*`) are not registered in production.

## Release procedure

```bash
docker build --target api -t registry/fd-api:$SHA .
docker build --target web -t registry/fd-web:$SHA --build-arg VITE_PRELAUNCH=false .
# 1. Back up / snapshot the database
# 2. Run migrations once (forward-only, reviewed SQL in apps/api/drizzle/)
docker run --rm --env-file .env.production registry/fd-api:$SHA node dist/migrate.js
# 3. Roll API instances (healthcheck gates traffic), then web
```

**Rollback:** redeploy the previous image tags. Migrations are additive by policy. If a migration has to
be reversed, restore from the pre-release snapshot. **Never run `db:seed` or `db:reset` against production**
(both refuse when `NODE_ENV=production`).

## Staging

A separate environment with its own database, secrets and domain (e.g. `staging.`), seeded with `DEMO` data
only. Run the E2E suite and the k6 load test (`infra/load/game-day.k6.js`) here before every launch.

## Pre-launch gates (spec §16 nonfunctional)

- [ ] Hosting selected and sized from **measured** load-test results (p95, error rate, CPU/memory)
- [ ] Managed DB backups enabled; **restore drill performed** and timed
- [ ] Error monitoring (e.g. Sentry; scrub PII) and uptime checks on `/api/health` and `/`
- [ ] TLS live; security headers verified (`curl -I`); `npm audit --omit=dev` clean
- [ ] Email deliverability test from the production sender (verification, reset, notice)
- [ ] All staff accounts have 2FA; `STAFF_MFA_REQUIRED=true`
- [ ] Legal pages approved and published (Privacy, Terms, Accessibility); COPPA/state-law review by counsel
- [ ] Redirect regression: every legacy URL returns 200 or a 301 (see CONTENT_INVENTORY.md)
- [ ] Rollback rehearsed
- [ ] DNS cutover approved in writing; keep the legacy site reachable until verified

## Local development

```bash
npm install
cp .env.example .env            # then set AUTH_SECRET
npm run db:up                   # Postgres on localhost:5442 (dev + test DBs)
npm run db:migrate && npm run db:seed
npm run dev                     # web http://localhost:5173, API :4000 (proxied)
```
