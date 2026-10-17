# Run the 5 Diamonds site on your computer

This runs a private copy of the website on your own machine, filled with **fictional DEMO data**
(made-up tournaments, teams and players). Nothing you do here affects any real website, sends real
email, or charges money.

## 1. One-time installs

You need three free programs. If you already have them, skip ahead.

| Program | Why | Get it |
|---|---|---|
| **Node.js 22 or newer** (choose "LTS") | Runs the website | https://nodejs.org |
| **Docker Desktop** | Runs the database | https://www.docker.com/products/docker-desktop/ |
| **Git** | Downloads the code | https://git-scm.com/downloads (already on most Macs) |

After installing Docker Desktop, **open it once** and wait until it says it's running.

## 2. Download the code (first time only)

Open **Terminal** (Mac: press ⌘+Space and type "Terminal") or **PowerShell** (Windows), then paste:

```bash
git clone https://github.com/tatejones2/five_diamonds_demo.git
cd five_diamonds_demo
```

## 3. Start it: one command

```bash
npm start
```

The first run takes a minute or two. It installs everything, sets up the database, loads the DEMO data,
and opens **http://localhost:5173** in your browser. Leave the Terminal window open while you use the site.

**To stop:** click the Terminal window and press **Ctrl+C**.
**To start again later:** open Terminal, `cd five_diamonds_demo`, and run `npm start`. Make sure Docker
Desktop is open first. Your data is kept between runs.

## 4. Sign in and try it

Click **Coach sign in** (top right). Every DEMO account uses the password **`demo-password-2026`**.

| Email | Role | Things to try |
|---|---|---|
| `director@demo.5diamonds.invalid` | Tournament director | **Admin → Tournaments → DEMO Fall Classic**: build the schedule, enter scores, seed the bracket, post a weather notice |
| `coach1@demo.5diamonds.invalid` | Team manager | **My Teams**: edit a roster or import a spreadsheet; register a team for **DEMO Spring Opener** |
| `scorekeeper@demo.5diamonds.invalid` | Scorekeeper | **Admin → Score entry**: can score only the one game it's assigned |
| `editor@demo.5diamonds.invalid` | Content editor | **Admin → Pages / News / FAQs** |
| `admin@demo.5diamonds.invalid` | Super admin | Everything, including **Staff & roles** and the **Audit log** |

You can also just browse as a parent, with no sign-in: try **Game Day** and the **DEMO Fall Classic** schedule,
brackets and standings. To see the phone layout, make your browser window narrow.

**Creating your own account:** no real email is sent. To get the verification link, open
`http://localhost:5173/api/dev/mailbox?to=YOUR-EMAIL` in your browser and copy the link from the message.

## 5. Start over with fresh DEMO data

```bash
npm start -- --reset
```

This erases everything in your local copy and reloads the original DEMO data.

## Troubleshooting

| Message | Fix |
|---|---|
| `Docker is installed but not running` | Open Docker Desktop, wait for "running", try again. |
| `Port 5173 (web) is already in use` | The site is probably already running in another Terminal window. Use that one, or press Ctrl+C there first. |
| `Node … found; Node 22 or newer is required` | Install the current LTS from nodejs.org, then open a new Terminal window. |
| `npm: command not found` | Node.js isn't installed (or Terminal was open during install; open a new one). |
| Page shows errors after you download newer code | Run `npm install`, then `npm start`. |
| Something else is stuck | Run `npm run db:down`, then `npm start -- --reset`. |

The database runs in Docker on port 5442. To shut it down fully when you're finished: `npm run db:down`.

---

*For developers:* `npm start` is a wrapper (`scripts/local.mjs`) around `npm install`, `.env` creation,
`npm run db:up`, `db:migrate`, a first-run `db:seed`, and `npm run dev`. Tests: `npm test` and
`npm run test:e2e` (the E2E suite reseeds the DEMO data). Set `NO_BROWSER=1` to skip opening a browser.
