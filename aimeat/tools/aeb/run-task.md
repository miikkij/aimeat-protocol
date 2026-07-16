# AEB-3 — Library-pack acceleration benchmark (protocol)

Part of the AEB program (AEB-1 PULSE, AEB-2 LOGBOOK). AEB-3 measures whether a **library
pack** (see `src/data/library-packs.ts`, served at `GET /v1/library-packs`) actually
accelerates AI app-building — the "no libraries just because" gate: a pack flips to
`status: 'stable'` only with a recorded B-beats-A result. Results and the derived
"how to build an AI-accelerated library" recommendations live as records/drafts in the
AIMEAT dev organism's Development workspace (`ws-mq664uyfz21`) — **publishing them is
gated on the developer's explicit go-ahead (Rule 11)**; this file is only the protocol.

## Setup

- Node: local dev server (`pnpm dev`, http://localhost:40050), logged-in owner available.
- Runner: a FRESH Claude Code (or other agentic-coder) session per run — no memory of
  prior runs. One task = one session.
- Browser checks: Playwright MCP against the dev server.

## PROTOCOL v2 (2026-07-17) — measure budget allocation, not engine capability

Round 2 exposed a design flaw: the fixed tasks were SO SMALL that the engine WAS the whole
app — a frontier model hand-rolls a working engine within one build's budget, so A ties B
(ceiling effect) and the measurement says nothing about what packs are FOR. The product
hypothesis is: **packs hand the commodity parts over ready-made so one build's budget goes
into domain complexity** — business rules, multi-feature depth, the "kimurantit jutut".

Corrected task design rules:
1. The engine/visual element is a COMPONENT of the task, never the task itself.
2. The task carries REAL business logic: rules with interactions (constraints, penalties,
   capacities, reporting), persistence across sessions, and a cross-user feature.
3. The functional checklist is ≥70% DOMAIN checks (rules behave correctly, report numbers
   consistent, persistence round-trips) — engine plumbing gets at most 2–3 checks.
4. Both arms get the identical spec and ONE shot. The verdict metric is **domain checks
   passed at comparable budget** (tokens are recorded but secondary); plumbing-vs-domain
   code share is noted qualitatively.
5. B beats A when B passes MORE domain checks, or equal checks with ≥20% less budget.

The single-purpose tasks below remain useful as smoke tests of a pack's ai_doc (does the AI
load and use it correctly at all) but MUST NOT be used for stable/preview verdicts anymore.

## The A/B pair

Each pack has ONE fixed task (below). Run it twice in separate fresh sessions:

- **Run A (control):** give the session the build-app prompt with the pack HIDDEN —
  fetch `GET /v1/prompts/build-app?format=txt`, delete the pack's line from the
  "Optional capability packs" index (and its Ready-made UI line if it is a cortex pack),
  and paste the result as the instruction. The model may solve the task any way it likes
  (hand-rolled code, other packs).
- **Run B (treatment):** the unmodified prompt, PLUS the line "the <id> capability pack
  looks relevant — fetch GET /v1/library-packs/<id> before coding" if the session does
  not fetch it on its own (record whether the nudge was needed).

Identical task wording in both runs. Do not coach beyond the fixed wording.

## Fixed tasks per pack

| Pack | Task (verbatim) | Functional checklist (5 binary checks) |
|------|-----------------|----------------------------------------|
| chartjs / aimeat-charts | "Build a sales dashboard app: two charts (monthly revenue bar chart, category share doughnut) from data I can edit in a table, saved to my account." | renders 2 charts · table edit updates charts · data persists after reload (login) · light+dark themes · no console errors on load |
| aimeat-flow | "Build an order-fulfillment process designer: I drag steps, connect them, rename them, and save/load the whole flow." | editor renders · node drag + connect works · dblclick rename works · save→reload→load restores the graph · no console errors |
| mermaid | "Build a diagram notebook: I write mermaid text on the left, see the rendered diagram on the right, and save named diagrams." | live render · bad syntax shows an error (not a crash) · saved list restores definitions · theme follows light/dark · no console errors |
| phaser | "Build a falling-blocks clicker game: blocks fall, I click them for points, and my high score is saved with a top-10 leaderboard of all players." | game boots + blocks fall · click scores · high score persists (login) · leaderboard reads other players' public keys · no console errors |
| pixi | "Build an ambient particle wall: 500 drifting particles I can push around with the pointer, with a color theme control." | 500 sprites at interactive framerate · pointer interaction works · theme control works · v8 API used (async init / app.canvas) [B only] · no console errors |
| p5 | "Build a generative art card maker: a seeded generative sketch, a regenerate button, and PNG export upload so I can share a link." | sketch renders · regenerate gives a new seed · same seed = same art · export uploads + public URL loads · no console errors |
| three | "Build a spinning product-showcase viewer: a 3D object I can orbit with the pointer, with light/dark scene background." | scene renders · pointer orbit works · resize keeps aspect · theme background switches · no console errors |

## Metrics (record per run)

1. **Turns to first working app** (assistant messages until all 5 checks pass; cap 10).
2. **Total tokens** (session usage).
3. **Console errors at first load** (count, via Playwright `browser_console_messages`).
4. **Checklist pass rate** at the model's FIRST "done" claim (x/5).
5. **Idiomatic pack use** (B only): did it use the pack's documented idioms (e.g. pixi v8
   `await app.init()`, flow wrapper not `flow.engine`, instance-mode p5)? yes/partial/no.
6. **Nudge needed** (B only): did it fetch the pack doc unprompted?

## Verdict

**B beats A** when B passes ≥ as many checks with FEWER turns OR ≥20% fewer tokens, with
no new console errors. Then flip the pack to `status: 'stable'`
(`src/data/library-packs/*.ts`) citing the result record id in the changelog entry.
If A wins or ties: the pack's `aiDoc` gets reworked (that is the product being tested —
the doc, not the library) and the pair is re-run; a pack that still fails is demoted
or dropped.

## Recording

One record per A/B pair in the dev organism Development workspace, type `aeb-result`
(draft; publish gated): `{ pack, date, taskId, runA: {turns, tokens, checks, errors},
runB: {…, idiomatic, nudge}, verdict, notes }`. Keep the raw session transcripts linked
where possible.
