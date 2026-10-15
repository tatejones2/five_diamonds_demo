# Staff Guide

How to run a tournament in the 5 Diamonds admin. Sign in at **/auth/login**, then open **Admin** in the
top bar. All times you enter are **Eastern Time**. Everything you change is recorded in the audit log
with your name.

## Before you start

- **Turn on two-factor authentication:** Account → Two-factor authentication. Required for staff at launch.
- **Roles:** a *super admin* grants roles under **Staff & roles**. People must create and verify an account first.
  - *Tournament director:* everything for their assigned tournaments (or all tournaments if org-wide).
  - *Scorekeeper:* can enter scores only for games they're assigned to. Can't move games or change final results.
  - *Content editor:* pages, news, partners, staff directory, FAQs, inquiries.

## 1. Set up a tournament

1. **Venues & fields:** add each ballpark and its fields once. Tick "Show on public Facilities page" only
   when the address and directions are verified.
2. **Tournaments → New tournament:** title, dates, venues, registration window, roster deadline.
   - **Review mode** (pick before opening): *Manual review* holds each team's spot until you confirm it.
     *Auto-confirm* confirms instantly when there's room. This can't change after teams register.
   - Only enter **fees** and **rules** the owner has confirmed.
3. **Divisions:** add each age group with its capacity and roster limits. Leave tie-breakers empty until the
   owner signs off. Standings show "Unofficial" until then.
4. **Setup → Publish & open registration.** The event becomes public and teams can register.

## 2. Manage registrations

**Registrations** tab: search by team, reference number or manager email. **Status** changes need a reason,
which the coach sees. Confirming a waitlisted team into a full division requires the **capacity override**
box (logged). **Export CSV** is logged too. **Payment:** until online payment is set up, record offline payments
as "Paid (Verified by Staff)". "Paid (Verified)" is reserved for confirmed online payments.

**Roster deadline:** at the deadline (or when you press **Lock rosters now**), each team's submitted roster is
frozen for this event. Coaches can still edit their team, but changes don't apply to this event. To make an
approved change after the lock, open the registration's roster and save with a reason.

## 3. Build the schedule

**Schedule** tab:
- **Board** view: pick a day, then click **+** in a field/time cell to add a game there. Adjust the time slot
  settings to match your game length + turnaround.
- **List** view: edit, duplicate or delete games, and see problems per game.
- Games stay in **draft**. Families see nothing until you publish.
- **Errors** (red) block publishing: field double-booked, team in two games at once, missing time/field/team,
  team not confirmed in the division. **Warnings** (yellow), such as short field turnaround or short team rest,
  can be acknowledged.
- **Preview & publish:** review the added/changed/removed counts, acknowledge any warnings, and publish.
  If someone else edited the draft after your preview, you'll be asked to review again.

## 4. Brackets

**Brackets → New bracket:** choose the division and number of teams. Byes go to the top seeds automatically.
Assign seeds (your call while standings are unofficial), then **Schedule game** for each matchup and
**Publish bracket**. Bracket games appear in the Schedule tab and go public with the next schedule publish.
Only **single elimination** is supported. Double elimination and consolation aren't available yet.

## 5. Game day

- **Score entry** (sidebar) lists games you can score. Use the +/− buttons and set the status. **Finalize game**
  publishes the result right away and, in brackets, advances the winner.
- **Moving a game** (directors): open the game → "Move or delay this game", give a reason. Conflicts are
  checked before the change goes live.
- **Correcting a final** (directors only) requires a reason. If later bracket games already have results,
  you must choose **Reset later games** (clears them; they must be re-entered) or **Keep later results** (logged override).
- **Assign a scorekeeper** at the bottom of the game page (they need the Scorekeeper role first).

## 6. Weather and notices

**Notices → New notice:** choose severity (*Critical* shows a red alert banner), what it applies to (whole
tournament, a division, venue, field or game), headline and details, and tick affected games so they're
highlighted on schedules. Publishing is immediate. Opted-in coaches also get an email, but **the website is
the source of truth** if email is delayed. When the situation ends, press **All clear** with a short message. The
notice moves to the Updates history.

## 7. Content (editors)

**Pages:** edit in Markdown, preview, save a draft, then publish. Privacy, Terms and Accessibility stay hidden
until "Owner and counsel have approved this text" is ticked. **Partners** appear only when *Published* and
*Owner approved*. **Staff directory** contact details appear only with that person's permission.
Don't reference affiliate organizations (including Perfect Game) without owner confirmation.

## Privacy reminders

Rosters are never public. Collect only player names and jersey numbers. Don't paste players' personal
details into notices, news or inquiries. Viewing a roster as staff is logged.
