# AEB-3 round 2 — mermaid · three · p5 · pixi · phaser (2026-07-17)

Same protocol as `aeb3-flow-001`: per pack one fixed task, fresh A/B builder sessions
simulating the copy-paste chat path (no network; B carries the pack ai_doc inlined),
both apps published to an isolated bench node and driven with a real browser.
Model: Claude Fable 5 (frontier) in both arms.

| Pack | Task | A checks | B checks | A tokens | B tokens | Verdict |
|---|---|---|---|---|---|---|
| mermaid | diagram notebook (live render, bad-syntax, save/restore, theme) | 4/5 (theme-follow failed) | **5/5** | 74,724 | 76,782 | **B beats A** → `stable` (aeb3-mermaid-001) |
| three | orbitable product viewer (shape selector, theme bg) | 5/5 † | 5/5 | 76,198 | 74,752 | tie (see notes) |
| p5 | seeded art card maker (deterministic seed, PNG export + public link) | 5/5 | 5/5 | 79,995 | 79,851 | tie |
| pixi | 500-particle wall (pointer push, palette) | 5/5 †† | **1/5 → 5/5 after pack fix** | 74,209 | 75,094 (b2) | **pack bug found + fixed** (aeb3-pixi-001); formal tie post-fix |
| phaser | falling-blocks clicker + shared top-10 leaderboard | 5/5 | 5/5 | 76,788 | 78,630 | tie |

† three-A hand-rolled a SOFTWARE 3D renderer on canvas-2D (back-face culling, depth sort) —
passes the checklist but renders on CPU; three-B is 27% less code on real WebGL.
†† pixi-A never used a GPU engine: it solved the task with canvas-2D (legitimate under the rules).

## The big find: pixi pack was broken on the platform (fixed)

Run B's first app failed to boot: **PixiJS v8 refuses to start under the published-app CSP**
(`Current environment does not allow unsafe-eval`) — the pack as shipped was unusable in ANY
published AIMEAT app. Fix (commit follows this file): vendored `pixi-unsafe-eval@8.min.js`
(pixi's official eval-free shader companion, `dist/packages/unsafe-eval.min.js`), added it as
a REQUIRED second include line + ai_doc warning + changelog entry. Re-run with the fixed doc:
5/5, PIXI v8 at 61fps, idiomatic v8 API. No CSP loosening needed.

## Honest reading of the flat token deltas

Round 1 (aimeat-flow) showed −27.5% tokens because a drag-drop node editor is genuinely hard
to hand-roll. Round 2's engines cover ground a frontier model can substitute with compact
vanilla code (canvas-2D particles, software 3D, seeded PRNG art, canvas game loop) — so with
THIS model, A ties B functionally and the pack's value shows up in dimensions the checklist
doesn't price: hardware rendering vs CPU, engine-idiomatic maintainable code vs bespoke
engines, and (pixi) surfacing a platform-level breakage before any user hit it.

**Verdicts applied:** mermaid → stable. three/p5/pixi/phaser stay `preview` per the gate
(B-beats-A not met). **Recommended next discriminator:** re-run the tied pairs on a mid-tier
model (e.g. Haiku/GLM class) where hand-rolling an engine should fail the checklist — that is
the population the packs mostly serve.

## Side notes

- Verification environment: WebGL1/2 + WebGPU all available; three-B WebGL canvases need
  element-screenshot comparison (toDataURL returns blanks without preserveDrawingBuffer).
- All 11 apps: 0 app-attributable JS errors. The recurring console 404s are aimeat-data reads
  of not-yet-existing keys (empty state), not defects.
