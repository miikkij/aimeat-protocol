# AEB-3 result — aeb3-flow-001 (aimeat-flow)

- **Date:** 2026-07-16 · **Pack:** `aimeat-flow` 1.0.1 · **Task:** order-fulfillment process
  designer (drag steps, connect, rename, save/load) — the fixed task from `../run-task.md`.
- **Runner:** two fresh Claude (Fable 5) agent sessions simulating the copy-paste chat path
  (no network; Run B's prompt carried the pack ai_doc inlined, exactly as the app-catalog
  pack picker composes it). Verification: real-browser Playwright drive against an isolated
  bench node (sqlite, app-origin off), fresh owner account, both apps published via POST /v1/apps.

| Metric | Run A (control — pack hidden) | Run B (treatment — pack + ai_doc) |
|---|---|---|
| Functional checklist | **5/5** | **5/5** |
| — editor renders | ✅ palette + SVG edge layer (hand-rolled) | ✅ wrapper editor + starter template (6 nodes/5 conns) |
| — drag + connect | ✅ (drag Δ140,80 exact; port-drag edge) | ✅ (drag + template connections) |
| — rename | ✅ inline input on dblclick | ✅ dblclick prompt (wrapper) |
| — save→clear→load restores | ✅ (flowdesk.flows record) | ✅ (flow:* keys + index record) |
| — console errors (app-attributable) | 0 | 0 |
| Total tokens | 108,140 | **78,365 (−27.5%)** |
| Wall time | 211 s | **148 s (−30%)** |
| Tool uses | 7 | 2 |
| App size | 28,900 B | **19,847 B (−31%)** |
| Idiomatic pack use | n/a | **yes** — presets, addNode/connect, save/load, onChange; never touched `flow.engine` |
| Nudge needed | n/a | no (doc inlined, catalog path) |

**Verdict: B beats A** (equal checks, ≥20% fewer tokens, no new console errors) →
`aimeat-flow` flipped `preview → stable` (changelog cites this record).

**Honest caveats:** n=1, frontier model. A strong model hand-rolls a *working* editor, so on
this task the acceleration shows as cost/speed/code-size, not success rate; expect the
correctness gap to widen on weaker models and the maintenance gap to widen over app lifetime
(A ships ~9 KB of bespoke editor logic per app; B rides the served wrapper, engine swappable).

**Side findings (filed separately):**
1. Portal LANDING page embeds a stale, hardcoded copy of the build prompt (5th drift copy —
   still lists deprecated aimeat-social, missing organism/markdown/commerce/capability packs).
2. Platform doc gap: on an app-origin (H-2) the pill's async silent login fires neither
   `onLogin` nor resolves a pending `login()` — an app following the documented two-path
   auth pattern stays hidden until reload; the build prompt should teach the
   `login`/`session-updated` event listener as path 3.
3. Localhost dev: *.apps.localhost silent-bridge cannot restore sessions after reload
   (known localhost SSO trap) — bench used an app-origin-off node instead.
