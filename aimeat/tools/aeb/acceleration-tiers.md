# AIMEAT capability packs — AI-acceleration tier scheme + how a pack earns one

Companion to `run-task.md` (the AEB-3 measurement protocol) and `results/` (the runs).
This file answers two questions the pack program keeps hitting:

1. **For a given pack, which model strength uses it reliably-and-accelerated, and where do weaker
   models start to trip?** — a *warning label*, not a gate.
2. **How does a pack earn a tier?** — a documented, repeatable procedure.

A tier is **optional**. A pack with no tier still ships: if the best models use it correctly, it
already accelerates — using ONE vendored, self-hosted package everywhere (instead of every app
hand-rolling or CDN-loading its own) is itself the acceleration, plus version-pinning means old apps
never break. The tier just tells a builder (and the prompt pipeline) **how much hand-holding the pack
needs at a given model strength**, so a weak model isn't pointed at a pack that will crash under it.

---

## The one axis that predicts where weaker models break

Across every AEB run, the dominant failure predictor is **API-version drift**: how far the vendored
pin's API is from the version that dominates the model's training data.

- A model codes a library **from memory first**, and only corrects itself if it fetches the ai_doc.
- Frontier models fetch the doc (or already know the current API). **Weaker models skip the doc and
  code the version they "know"** — which is whatever dominated their training corpus.
- So a pack pinned to a version whose API **differs** from that dominant version is a trap for weak
  models; a pack pinned to the **same** (or an old, stable, ubiquitous) API is safe for everyone.

This gives three classes:

### Tier `any` — works from memory, down to mid-tier
Pinned API == the version models assume by default; stable, ubiquitous surface. A weak model writes
correct code without reading the doc. **Highest acceleration-per-effort.**
Signals: old-but-standard build, or a version line unchanged for years, no "CRITICAL/removed" caveats
in the ai_doc.

### Tier `frontier` — reliable on strong models, a version-drift TRAP for weak ones
Pinned API has a **breaking change vs the version most examples show**. Strong models handle it (know
the new API or fetch the doc); weak models code the OLD API from memory and **crash**. The ai_doc
already carries the correct idiom — the failure is that weak models *don't read it*.
Ships fine (frontier-usable = still valuable), but the prompt pipeline should not steer a weak model
here without forcing the ai_doc / inlining the breaking idiom.

### Tier `needs-doc` — no wrong-version trap, but zero priors
AIMEAT-authored or wrapper packs, absent from all training data. No "wrong version" crash — but the
model has **no priors**, so it must fetch the ai_doc to use the pack at all. A weak model that skips
the doc produces *nothing usable* (silent no-op), not a crash. Reliability = "did it fetch the doc?"

---

## First-cut classification (2026-07-17)

Confidence: **[M]** measured in an AEB run · **[I]** inferred from version-drift + ai_doc caveats
(not yet a controlled run). Inferred rows are provisional — run the procedure below to confirm.

| Pack | Pin | Tier | Where weaker models trip (the warning) | Evidence |
|---|---|---|---|---|
| **three** | r128 | `any` | r128 is the last classic-global build — heavily represented, stable `THREE.*`. Low drift. | **[M]** round 5: load-bearing, Haiku rendered it |
| **p5** | @1 | `any` | v1 `setup()/draw()` is ubiquitous and stable. Low drift. | **[M]** round 5: particle band rendered on Haiku |
| **chartjs** / aimeat-charts | @4 | `any` | v4 ≈ v3 surface, well-known. Low drift. | **[I]** + charts used cleanly in round 4/5 |
| **mermaid** | v11 | `any` | text diagram syntax stable; only the init/theme idiom needs care. | **[M]** aeb3-mermaid-001: 5/5 vs 4/5 |
| **aimeat-flow** | 1.0.1 | `needs-doc` | wrapper API — model has no priors; must fetch the 3 includes + preset API. Skipping → can't use it (no crash). | **[M]** aeb3-flow-001: 5/5, −27% tokens |
| **realtime** | v1 | `needs-doc` | AIMEAT-authored (WS/WebRTC/Yjs); no priors, must read the doc. | **[I]** |
| **styling** | tailwind@4 + daisyui@5 | `frontier` *(prov.)* | **tailwind v4 ≠ the v3 models know** (browser-JIT, config moved); daisyUI v5 class renames. Weak models may emit v3 config / stale classes. | **[I]** — needs a run |
| **pixi** | @8 | `frontier` | **v8 breaking vs the v7 "most examples show"**: weak models write `beginFill/drawRect/fillRect/lineStyle` (removed) → `TypeError` crash; and skip the ai_doc that says so. | **[M]** aeb3-pixi-perpack: Haiku crashed on v7 API |
| **phaser** | @3 | `any` *(prov.)* | v3 IS the dominant Phaser in training data (v4 is new) — low drift; risk is API breadth, not version. | **[I]** — needs a run |

Reading it: `any` packs are safe to advertise to any model. `frontier` packs carry a version-drift
landmine for weak models — **pixi is the confirmed example** (v7→v8). `needs-doc` packs never crash
but are useless to a model that won't fetch the doc.

---

## How a pack earns a tier (the procedure)

Same spirit as the `status: preview→stable` gate, but measuring *model strength* rather than pass/fail.

### Step 1 — Pick a pack-neutral task where the pack is load-bearing
Write a build spec that NEEDS the pack's capability but **never names a library** (describe the
capability: "a rotating 3D view", "hundreds of clickable moving tokens"). Keep it domain-heavy
(≥70% of the checklist is domain logic, not the visual/engine layer) so the score reflects
*acceleration of real work*, not an engine demo. See `scratchpad/*-neutral-spec.md` for the shape.

### Step 2 — Controlled A/B, one variable
Build the SAME spec twice, one shot each, network to a bench node:
- **A (control):** build prompt with the pack blocks stripped (core SDK libs stay).
- **B (treatment):** unmodified build prompt (pack advertised).
Record tokens, tool calls, app size, and the exact includes each arm used.

### Step 3 — Run it on the tier you're claiming, weakest-first
- Claiming `any` → it must succeed on a **mid-tier model (e.g. Haiku 4.5)**. That is the bar.
- Claiming `frontier` → succeeds on a **frontier model** but you must ALSO run the mid-tier arm and
  *document the failure mode* (what wrong-version API it wrote, where it crashed) — that failure IS
  the warning label.
- `needs-doc` → verify a doc-fetching run succeeds and note that a no-fetch run produces nothing.

### Step 4 — Verify in a real browser (Playwright MCP), not by inspecting code
Publish each arm to the bench, sign in, load demo data, and check the DOMAIN checklist by driving the
UI. **Data persisted ≠ working** — an app can write a full dataset and still render nothing (both
FLOOR arms did). Score what the user actually sees. Capture console errors (app-attributable only)
and screenshots.

### Step 5 — Verdict (protocol v2) + record
`B` earns the tier when, on the claimed model strength, it passes **more domain checks** than `A`
(or equal at ≥20% fewer tokens) AND renders in the browser. Write it up in `results/aeb3-<pack>-*.md`
with: tokens, the checklist, the browser findings, and — for `frontier`/failed runs — the **exact
weak-model failure mode** (the warning). Update this table's row from `[I]` to `[M]`.

### The honest-negative rule
A run where both arms break, or where the pack crashes, is still a result: record it, keep the pack at
its current tier (or `preview`), and file the failure as the warning + any platform/aiDoc fix it
surfaced. `aeb3-pixi-perpack.md` is the model — it denied pixi a promotion and produced the two most
useful findings (doc-delivery gap; a shared read-key bug).

---

## What the tiers imply for the prompt pipeline (proposal, not yet built)

- `any` packs: advertise freely to every model; the one-line blurb is enough.
- `frontier` packs: when the target model is weak, either **inline the breaking-API idiom** in the
  build-prompt pack list, or hard-require "fetch this pack's ai_doc — the API you know is removed."
  (Candidate: an optional `apiCaveat` field on the registry entry that the prompt inlines for these.)
- `needs-doc` packs: the pipeline should *force* the ai_doc fetch before first use.

Encoding the tier as an optional `modelTier?: 'any' | 'frontier' | 'needs-doc'` field on the
`LibraryPack` registry entry (surfaced in `GET /v1/library-packs`) is the natural next step — a pack
with no `modelTier` simply ships unlabelled, exactly as today. **This schema change is a design
decision — do not add it until the developer signs off.**
