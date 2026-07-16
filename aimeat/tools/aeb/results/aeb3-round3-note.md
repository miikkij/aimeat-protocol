# AEB-3 round 3 — protocol v2 correction + PIPELINE flagship (2026-07-17)

## Why round 2's verdicts don't count for stable/preview

Round 2 measured engine capability, not the product hypothesis. The fixed single-purpose
tasks were small enough that the ENGINE was the whole app, so a frontier model hand-rolls a
working engine within one build's budget and A ties B (ceiling effect). Packs exist to hand
the commodity parts over ready-made so a build's budget goes into DOMAIN complexity — see
`../run-task.md` PROTOCOL v2.

## DispatchBoard A/B (first v2-style attempt — warehouse dispatch with real rules)

Task: a game where the ENGINE is incidental but the BUSINESS RULES are the point (express
20s SLA + penalty, fragile-can't-go-to-dock-3, dock capacity 5, end-of-shift report with
SLA %, persistent career stats, shared leaderboard). Both fresh sessions, phaser offered to B.

Outcome: **both A and B skipped the phaser pack entirely** and built a DOM/canvas app — the
rule engine (timers, penalties, capacity, reporting) genuinely needs no game engine, so the
pack was the wrong tool and neither arm used it. Correct AI judgment, but it means this task
still doesn't isolate pack value. Lesson folded into the flagship approach below: pick a task
where the pack's domain (editable process flow, 3D situational view, particle system) is
load-bearing AND wrapped in business logic.

## PIPELINE flagship — the real demonstration

Built ONE large app that uses the whole pack stack around a single domain problem, everything
hanging off one workspace data chain (process → campaigns → deals), with teams + user roles
(manager/member/visitor), served on aimeat.io (public):
https://aimeat.io/v1/apps/happydude500001/pipeline.html?mode=inline

Packs, each load-bearing: three.js (3D pipeline-by-stage overview) · pixi v8 (lead-flow
particles, rate ∝ active campaigns) · aimeat-flow (editable sales process, manager-only) ·
aimeat-charts (won/week + forecast + stage doughnut) · styling · aimeat-ui-dialogs ·
aimeat-markdown · aimeat-live · agent face. Data in a schema-locked organism workspace.

Browser-verified in production: workspace provisioned, demo data (5 stages / 3 campaigns /
12 deals), €248k pipeline, per-stage flow badges, 4.6× ROI, 4 canvases, ZERO console errors.

**Bug this flagship caught:** `AIMEAT.organism.create()` returned the raw `{ organism }` route
envelope instead of the documented `{ id, name }`, so `createWorkspace(org.id, …)` got
`orgId=undefined` and 404'd — any multi-tenant app that provisions its own workspace hit it.
Fixed in the served lib (commit 81b0a2db); the app also carries a defensive unwrap so it runs
against both old and new nodes.

**Next:** a formal A/B on this task class (build the same command center with vs without the
packs advertised) will quantify the budget-allocation win the flagship demonstrates.
