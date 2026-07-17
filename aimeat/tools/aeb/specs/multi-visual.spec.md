# PIPELINE — a team Sales & Marketing Command Center (build spec)

Build ONE self-contained single-file HTML app that runs on AIMEAT. A small sales team uses it
together to run their pipeline. Implement the WHOLE spec — this is a real tool, not a toy.

## The data (this is the spine — everything hangs off it)

Store the team's data so ALL members share it and it survives reloads (team-shared, not just
per-user private). Three linked record types:

- **process** — the ordered list of sales STAGES (e.g. Lead in → Qualified → Proposal →
  Negotiation → Closing). One shared definition for the team.
- **campaign** — { name, channel (email|social|event|ads|outbound), budget, status
  (active|done), notes }.
- **deal** — { title, company, value, which stage it's in, which campaign it belongs to,
  owner, notes, created date, won/lost date }.

Relationships that MUST be reflected live in the UI:
- A campaign FUNDS deals. **Campaign ROI = total value of WON deals linked to it ÷ its budget.**
- A deal MOVES through the process stages.
- **Weighted forecast** = sum over open deals of (value × stage probability), where a stage's
  probability rises with its position in the process (stage i of n → (i+1)/(n+1); won = 1, lost = 0).
- Everything aggregates into the overview.

## Team + user levels (roles)

The team works in a shared space. Derive roles from who owns/administers that space:
- **manager** (the space creator/admin): can edit the process definition, create/edit campaigns,
  and delete records.
- **member**: can create/move/edit deals and add notes, but not edit the process or delete others' data.
- **visitor** (signed in but not a team member): sees a "this team's pipeline exists — ask for an
  invite" state, read-only.
- **signed out**: a short marketing splash + the sign-in bar.
Enforce the level in the UI; the server is the real boundary (a forbidden write should surface as
a clear error, not a silent success). Invites happen in the AIMEAT portal — link to it, don't
reimplement invites.

## Views (tabs)

1. **Overview / situational snapshot** — make it feel like a command center:
   - A **rotating 3D view** of the pipeline: one upright bar per stage, its height proportional to
     the total open deal value in that stage, with the stage's name labelled; the user can drag to
     orbit; its background follows the app's light/dark theme.
   - A **live particle / flow band** conveying "leads coming in": particle spawn rate proportional
     to the number of ACTIVE campaigns, particle colour by campaign channel, with a small legend.
   - **Charts**: "Won value per week (last 8 weeks) + weighted-forecast line" and a "pipeline by
     stage" breakdown chart.
   - **KPI tiles**: open pipeline €, weighted forecast €, won this month €, best campaign ROI, deal count.
2. **Pipeline** — the process stages shown as an **editable left-to-right node diagram**: each node
   labelled "Stage — N deals / €X". MANAGER can add/rename/reconnect stages and SAVE, which updates
   the shared process definition. Non-managers see it read-only. The app's stage list comes from the
   saved process record (source of truth); the diagram is its editor/view.
3. **Deals** — a kanban board, columns = the process stages. Deal cards (title, company, value,
   campaign chip, owner). Move a deal to another stage (click→pick or drag). Add/edit a deal in a
   modal dialog. Mark WON / LOST. Deal notes render as (safe) markdown.
4. **Campaigns** — list/cards: name, channel, budget, active/done, linked-deals count, WON value,
   ROI bar. Create/edit (manager). Clicking a campaign filters the Deals board to that campaign.
5. **Team** — who's in the space and what each role can do; a link to the AIMEAT portal team page
   for invites; and expose the app's read surface for AI agents.

## Live + agents

- When a teammate changes the shared data, re-fetch and re-render (no manual refresh / no polling).
- After each successful data-changing save, update a public agent-readable summary of the app's
  current state (stage totals, top open deals, campaign ROI — public-safe numbers only) so an AI
  agent can act on it.

## Non-negotiables

- Single self-contained HTML file. Load only what you use, from THIS node (never an external CDN).
- Handle ALL sign-in paths: fresh sign-in click, already-signed-in-on-load, AND async logins
  (an app that only reacts to the click callback will show nothing to a returning user).
- ZERO console errors on load, signed out and signed in. Error handling + loading states on every
  fetch. Theme: light AND dark, following the user's AIMEAT theme choice.
- A "Load demo data" action for a manager on an empty space (≈5 stages, 3 campaigns, ~12 deals with
  a few won/lost) so the app is immediately explorable.
- After you hand over the file, tell me (briefly) how to publish it on AIMEAT.

App name: PIPELINE. Look: sleek dark-friendly "command center". Build it now — the spec is complete,
don't interview me.
