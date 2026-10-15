# Content Inventory & Redirect Map

**Source:** crawl of `https://www.5diamondstournamentbaseball.com/` on 2026-10-15 (homepage, all nav pages,
`sitemap.xml` with 46 URLs, `robots.txt`, `news.rss`). The legacy site is a hosted **BaseballShift/DigitalShift**
platform site. Its stats pages are client-side hash routes (`/stats#/…`) served by that platform.

**This is not a complete audit.** The crawl got rendered HTML only. Individual legacy `/events/*` pages,
photo albums and videos were listed but not opened, and nothing behind the platform's admin was reviewed.
Every "migrate" item still needs owner verification of accuracy and publication rights.

Legend: **Migrate** = carry forward after verification · **Replace** = new content needed · **Retire** = drop.
Redirect status: ✅ in `infra/caddy/Caddyfile` · ⬜ pending.

## Pages

| Legacy URL | Observed content | New destination | Action | Rights / verification needed | Redirect |
|---|---|---|---|---|---|
| `/`, `/home` | Header "Triad Area, North Carolina", tagline **"A Proud Affiliate Of Perfect Game SEC Baseball"**, news slider, "Join the league", "Become a partner", Facebook link | `/` | Replace | Approved homepage copy. **Affiliate tagline not carried over** (spec §1, §12) | ✅ `/home → /` |
| `/news` | 5 posts (2026), most Perfect Game–branded | `/news` | Migrate selectively | Confirm each post is still accurate and approved to publish. Affiliate branding needs owner approval | (same path) |
| `/news/perfect-game-triad-spring-state-championships-set` (2026-04-11) | Event announcement | `/news/…` or retire | Owner decision | PG branding; event is past | ⬜ |
| `/news/perfect-game-triad-super-regional-nit-set-for-apri` (2026-04-03) | Event at "New Market Civitan Park" | Owner decision | Owner decision | PG branding; past | ⬜ |
| `/news/perfect-game/body-armor-state-games-triad-qualifie` (2026-03-25) | Event announcement | Owner decision | Owner decision | PG + third-party brand; past | ⬜ |
| `/news/bombs-for-moms-1-day-mother-s-day-tournament-may-9` (2026-03-23) | 1-day tournament post | `/news/…` | Migrate if approved | Past event | ⬜ |
| `/news/perfect-game-baseball-returns-to-the-triad-with-15` (2026-03-22) | "$150 Tournament Series" | Owner decision | Owner decision | **Contains a price; do not republish without confirmation** | ⬜ |
| `/events`, `/calendar` | "No events found." | `/tournaments` | Replace | Real events entered natively | ✅ |
| `/events/*` (≈21 in sitemap: e.g. `11u-friday-night-lights-new-market-civitan-park`, `12u-friday-night-lights-level-cross-ballfields`, `opening-weekend-tournament`, `5-diamonds-baseball-tournament1…15`) | Not opened | `/tournaments` (or specific `/tournaments/:slug` once recreated) | Owner decision | Historical records need verification before migration | ✅ (all → `/tournaments`; refine per event later) |
| `/history` | **"No info added yet."** (placeholder) | `/about` | Replace | Approved history copy | ✅ |
| `/staff` | 3 entries: two "Site Director", one "Tournament Director", each with a phone and email (some personal Gmail) | `/staff` | Migrate after consent | **Names, titles, phone and email NOT copied into this codebase.** Each person must confirm what may be published (`contact_publishing_approved`) | (same path) |
| `/rules` | **"No info added yet."** | `/rules` + per-event rules | Replace | Owner-approved rules per age group | (same path) |
| `/expansion` | "Want your team in our league?" form (name, email, phone, team name/city, reason) | `/get-involved` + `/contact` (topic "Get involved") | Replace | Clarify program meaning ("league" vs tournaments) | ✅ |
| `/contact` | Contact form (name, email, phone, subject, message) | `/contact` | Replace | Confirm the destination inbox and response policy | (same path) |
| `/partners` | Intro text, no partner listings rendered | `/partners`, `/sponsorship` | Replace | Logo files + written approval per partner | (same path) |
| `/photos`, `/photos/collections`, `/photos/april-10th-friday-night-lights-champions` | Album(s) | `/media` | Owner decision | **Photo releases for identifiable minors** before any reuse | ✅ |
| `/videos`, `/videos/collections`, `/videos/search` | Video pages | `/media` | Owner decision | Same as photos | ✅ |
| `/stats` (+ `#/schedule`, `#/scores`, `#/standings`, `#/brackets`, `#/teams`, `#/players`, `#/leaders`, `#/stars`, `#/special-teams`, `#/suspensions`) | Platform stats app | Native `/tournaments/:slug/{schedule,scores,standings,brackets}`; `/game-day` | Replace | **Player stats, leaders, stars and suspensions are not carried forward.** They are player-level youth data, out of scope and against privacy defaults | ✅ `/stats → /game-day` (fragments can't be redirected server-side) |
| `/register` | Platform registration | `/tournaments` → native registration | Replace | — | ✅ |
| `news.rss` | RSS feed of news | `/news` | Retire feed (or add later) | — | ✅ `/news.rss → /news` |
| `admin.baseballshift.com`, `baseballshift.com` links | Platform admin/marketing | — | Retire | — | n/a |
| Facebook `facebook.com/5diamondstopgunbaseball/` | Social link | Footer/social (CMS) | Owner decision | Confirm the account is current | n/a |

## Brand assets observed (not copied)

| Asset | Observation | Status |
|---|---|---|
| Logo PNG (183×145) on the DigitalShift CDN | Home-plate/diamond shape: sky blue, navy lettering, orange-red outline, baseball | **Not hotlinked or copied.** Need the official SVG from the owner. A temporary wordmark is in `apps/web/src/components/brand.tsx` |
| Colors | Navy `#213a83` (inline on the legacy page), sky `≈#3a92c9` (sampled from the logo), flame `≈#c93c1f` (legacy CSS and logo) | Used as **temporary** tokens in `apps/web/src/styles/tokens.css`, labeled legacy-derived. Text uses darker variants for WCAG AA |
| Fonts | Legacy uses Roboto, Roboto Condensed and Playwrite IS (Google Fonts) | New site self-hosts Oswald + Inter (OFL). No third-party font requests |

## Venues referenced (names only; details unverified)

New Market Civitan Park and Level Cross Ballfields appear in legacy event slugs and news. **Neither is seeded.**
Addresses, fields, parking and policies must come from the owner.

## Before cutover

- [ ] Owner reviews every row above and marks migrate/replace/retire
- [ ] Full crawl of `/events/*`, photo and video pages; add specific redirects for any event recreated natively
- [ ] Export any historical data the owner wants (spec §19), with written approval for anything involving minors
- [ ] Regression check: request every legacy sitemap URL against staging and confirm a 200 or a 301 to a live page
- [ ] Submit the new `/sitemap.xml` to search engines after DNS cutover
