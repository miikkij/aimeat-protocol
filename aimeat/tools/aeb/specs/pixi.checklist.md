# pixi per-pack A/B — domain checklist (protocol v2) — 8 domain + 3 plumbing = 73% domain

The per-pack A/B the AEB-3 gate requires before flipping `pixi` preview → stable.
Same controlled design as round 4/5: build the IDENTICAL pack-neutral FLOOR spec TWICE,
the ONLY variable is the build prompt.
- **Run A (packs hidden):** "Ready-made UI (cortex)" + "Optional capability packs" blocks removed
  from the build prompt. Core SDK libs (auth/data/organism/ai/markdown/live/agentface) stay in both.
- **Run B (packs shown):** unmodified build prompt (pixi + the rest advertised via the registry).
The spec never names a library — it describes the CAPABILITY ("each active order is a moving token…
click a token… pan/zoom… smooth with 150–300 tokens"). A gets no hint the packs exist.

Run each arm as a fresh agentic-coder session, one shot, network to a bench node. Then publish to
the bench, sign in as owner, load demo data (~200 orders), and verify in a real browser
(Playwright MCP). Record tokens + app size for each arm.

## Domain (D1–D8) — the ≥70% weight; pixi does NOT help pass these

- **D1 team-shared persistence:** create an order → reload → order still present (round-trips the shared store).
- **D2 pipeline advance consistency:** advance an order to the next station → its station updates AND the
  from/to station load counts change to match across Floor zones + Pipeline + Orders.
- **D3 throughput aggregate:** mark orders done → the "completed/hr" (throughput) KPI reflects them correctly.
- **D4 SLA-breach rule:** an order past its due time shows as breached in the UI AND the breach-count KPI matches.
- **D5 capacity rule:** push a station's load above its capacity → that station flags over-capacity
  (zone turns red / badge) AND an over-capacity indicator/KPI matches.
- **D6 role gate:** a non-supervisor (2nd account, not a member) cannot edit the pipeline / assign workers /
  seed data (UI blocks OR server rejects with a surfaced error, not silent success).
- **D7 worker→station link:** assign a worker to a station → clicking that worker filters Floor + Orders to
  that station; the worker's load count matches the station's load.
- **D8 agent/live surface:** after a save, the PUBLIC agent-readable summary OR a live re-render reflects the
  change (per-station load, throughput, breaches — best-effort; pass if either present).

## Plumbing (P1–P3, capped at 3) — this is where pixi is load-bearing

- **P1 dense live map renders:** the Floor shows many moving order tokens (≥150 on screen) that animate
  station→station and stays responsive (no visible stutter / no frozen tab).
- **P2 interaction on the visual layer:** clicking a token opens its order detail (hit-testing works) AND
  pan (drag) + zoom (scroll) move/scale the floor.
- **P3 zero app-attributable console errors** on load, signed out AND signed in.

## Verdict (protocol v2)

B beats A when B passes **MORE domain checks (D1–D8)**, OR **equal domain checks at ≥20% fewer tokens**.
Plumbing (P1–P3) is noted qualitatively — the hypothesis is that on a mid-tier model the no-pack arm
burns its budget hand-rolling a smooth, hit-testable, pannable many-sprite renderer (P1/P2) and
therefore drops DOMAIN features (as round 5 showed for three/p5). If BOTH arms nail the domain
(frontier ceiling effect), the honest verdict is "pixi = visual/commodity accelerator only" — flip
to stable ONLY on a recorded B-wins-domain result, per the gate. Run on a mid-tier model (Haiku 4.5)
first, since that is where the discriminator lives and the population packs mostly serve.

## Note on pixi's CSP companion (verify it doesn't leak into the result)

Run B should load BOTH `pixi@8.min.js` and `pixi-unsafe-eval@8.min.js` (the aiDoc says so). If Run B's
app throws "Current environment does not allow unsafe-eval", the pack aiDoc failed to convey the
two-file requirement → that is itself a finding (fix the aiDoc), not a pixi-can't-work result.
