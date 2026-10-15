# syntax=docker/dockerfile:1.7
# Multi-stage build: one image for the API, one for the static web + reverse proxy.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
ARG VITE_PRELAUNCH=true
ENV VITE_PRELAUNCH=$VITE_PRELAUNCH
RUN npm run build -w @fd/api && npx --workspace @fd/web vite build

# ---- API runtime ---------------------------------------------------------------------------------
FROM node:22-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @fd/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
# Run migrations as a separate release step: `docker compose run --rm api node dist/migrate.js`
CMD ["node", "dist/server.js"]

# ---- Web (static files + reverse proxy) ----------------------------------------------------------
FROM caddy:2.10-alpine AS web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
