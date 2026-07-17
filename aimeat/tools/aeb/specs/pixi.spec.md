# FLOOR — a live fulfillment-floor monitor (build spec)

Build ONE self-contained single-file HTML app that runs on AIMEAT. A small operations team uses it
together to run a fulfillment floor in real time. Implement the WHOLE spec — this is a real tool,
not a toy. Load only what you use, from THIS node (never an external CDN).

## The data (this is the spine — everything hangs off it)

Store the team's data so ALL members share it and it survives reloads (team-shared, not just
per-user private). Linked record types:

- **station** — an ordered step on the floor pipeline (e.g. Intake → Pick → Pack → QA → Ship).
  { name, position in the pipeline, capacity (max concurrent orders), assigned worker }.
  One shared pipeline definition for the team.
- **worker** — { name, which station they're assigned to, active|off }.
- **order** — { code, customer, item count, priority (low|normal|rush), which station it's
  currently at, created time, due time, done time }.

Relationships that MUST be reflected live in the UI:
- An order MOVES through the stations in pipeline order.
- **Station load** = number of orders currently at that station; a station is OVER CAPACITY when
  load > its capacity.
- **Throughput** = orders completed (reached the last station / marked done) per hour.
- **SLA breach** = an order whose due time has passed and is not yet done.
- Everything aggregates into the overview.

## Team + user levels (roles)

The team works in a shared space. Derive roles from who owns/administers that space:
- **supervisor** (space creator/admin): edit the pipeline (add/rename/reorder stations, set
  capacity), assign workers, seed demo data, delete records.
- **worker** (member): advance/edit orders, mark done, add notes — but not edit the pipeline,
  reassign others, or delete others' data.
- **visitor** (signed in, not a member): read-only "this floor exists — ask for an invite" state.
- **signed out**: a short splash + the sign-in bar.
Enforce the level in the UI; the server is the real boundary (a forbidden write must surface as a
clear error, not a silent success). Invites happen in the AIMEAT portal — link to it, don't
reimplement invites.

## Views (tabs)

1. **Floor (live map)** — the centrepiece. A live 2D map of the floor where **each active order is a
   moving token** that travels from its current station toward the next as it advances; token colour
   encodes priority (rush/normal/low), and a subtle badge/size encodes item count. The map must stay
   smooth and responsive with **many tokens on screen at once (aim for 150–300 without stutter)**.
   The user can **click a token to open that order's detail**, and **pan (drag) / zoom (scroll)** the
   floor. Stations are drawn as labelled zones showing "Station — load / capacity" and turn red when
   over capacity. A small legend maps colour → priority.
2. **Pipeline** — the stations as an editable left-to-right list/diagram: each shows
   "Station — N orders / cap C". SUPERVISOR can add/rename/reorder stations and set capacity, then
   SAVE (updates the shared pipeline definition). Non-supervisors see it read-only. The floor's
   station list comes from this saved record (source of truth).
3. **Orders** — a table/board of orders (code, customer, items, priority chip, current station,
   due/overdue). Advance an order to the next station, edit it in a modal, mark DONE. Overdue orders
   are visibly flagged. Order notes render as (safe) markdown.
4. **Workers** — list workers, which station each is assigned to, and their current load (orders at
   their station). SUPERVISOR assigns a worker to a station. Clicking a worker filters the Floor map
   and Orders board to that worker's station.
5. **Team** — who's in the space and what each role can do; a link to the AIMEAT portal team page
   for invites; and expose the app's read surface for AI agents.

## Live + agents

- When a teammate changes the shared data, re-fetch and re-render (no manual refresh / no polling).
- After each successful data-changing save, update a PUBLIC agent-readable summary of the floor's
  current state (per-station load vs capacity, throughput/hr, SLA-breach count, rush-order count —
  public-safe numbers only) so an AI agent can act on it.

## Non-negotiables

- Single self-contained HTML file. Load only what you use, from THIS node (never an external CDN).
- Handle ALL sign-in paths: fresh sign-in click, already-signed-in-on-load, AND async logins.
- ZERO console errors on load, signed out and signed in. Error handling + loading states on every
  fetch. Theme: light AND dark, following the user's AIMEAT theme choice.
- A "Load demo data" action for a supervisor on an empty space: ~5 stations, ~6 workers, and
  **~200 orders** spread across the pipeline with a mix of priorities and a few overdue, so the
  live floor is immediately busy and explorable.
- After you hand over the file, tell me (briefly) how to publish it on AIMEAT.

App name: FLOOR. Look: sleek dark-friendly operations "control room". Build it now — the spec is
complete, don't interview me.
