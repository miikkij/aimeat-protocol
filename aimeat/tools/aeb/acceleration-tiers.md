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

**"Proven on"** lists the specific models a run has actually demonstrated the pack on, with the
evidence file — so a builder can deliberately pick a pack *on a model it's proven with*. `[M]` =
measured in an AEB run · `[I]` = inferred from version-drift + ai_doc caveats (no run yet, provisional
— treat "Proven on" as empty until someone runs it).

| Pack | Pin | Tier | Proven on (model → verdict, evidence) | Where weaker models trip (the warning) |
|---|---|---|---|---|
| **three** | r128 | `any` [M] | Haiku 4.5 → ✅ load-bearing (`results/aeb3-round5-midtier-ab.md`) | r128 stable & ubiquitous — low drift |
| **p5** | @1 | `any` [M] | Haiku 4.5 → ✅ particle band rendered (`aeb3-round5-midtier-ab.md`) | `setup()/draw()` ubiquitous |
| **chartjs**/aimeat-charts | @4 | `any` [I] | *(none yet — charts used cleanly in round 4/5, not isolated)* | v4 ≈ v3 |
| **mermaid** | v11 | `any` [M] | *(model per `aeb3-mermaid-001`: 5/5 vs 4/5)* | text syntax stable; theme-init idiom |
| **aimeat-flow** | 1.0.1 | `needs-doc` [M] | proven idiomatic (`aeb3-flow-001`: 5/5, −27% tokens) | wrapper — no priors; must fetch doc |
| **realtime** | v1 | `needs-doc` [I] | *(none yet)* | AIMEAT-authored; no priors |
| **styling** | tailwind@4+daisyui@5 | `frontier` [I] | *(none yet)* | **tailwind v4 ≠ v3** models know |
| **pixi** | @8 | `frontier` [M] | Haiku 4.5 → ❌ **crashed** on v7 API (`results/aeb3-pixi-perpack.md`); frontier unrun | **v8 breaking vs v7**: `fillRect/drawRect/beginFill` removed → crash; ai_doc skipped |
| **phaser** | @3 | `any` [I] | *(none yet)* | v3 dominates training data — low drift |

Reading it: `any` = safe to advertise to any model. `frontier` = version-drift landmine for weak
models (**pixi is the confirmed example** — proven to *fail* on Haiku, still frontier-usable).
`needs-doc` = never crashes but useless to a model that won't fetch the doc. A blank "Proven on" means
nobody has run it yet — the tier there is inferred, not demonstrated.

## The proof ledger — per pack, per model, append-only

A tier is a *summary*; the truth is the list of **proofs** underneath it. Each proof is one run of a
pack's shared test set on one model:

```
proof = { pack, model, testSet, verdict: pass|fail, tokens?, evidence: results/<file>.md, date }
```

- A pack's **tier = the strongest model-strength it has a `pass` proof for** (so pixi's Haiku `fail`
  keeps it `frontier`, not `any`, until a mid-tier `pass` exists).
- Proofs are **additive**: a new model's run never overwrites another's — it appends a row. Over time
  each pack accrues a matrix of "works on X, fails on Y" that builders can filter by.
- The evidence is always a `results/*.md` file (tokens, checklist, browser findings, screenshots) —
  never just an assertion.

---

## How a pack earns a tier (the procedure)

Same spirit as the `status: preview→stable` gate, but measuring *model strength* rather than pass/fail.

### Step 1 — Use the pack's shared test set (or write one, once)
Each pack has a reusable **test set** under `specs/`: a `<pack>.spec.md` (a build spec that NEEDS the
pack's capability but **never names a library** — "a rotating 3D view", "hundreds of clickable moving
tokens") plus a `<pack>.checklist.md` (the domain + plumbing checks, ≥70% domain so the score reflects
*acceleration of real work*, not an engine demo). Existing sets:
- `specs/pixi.spec.md` + `specs/pixi.checklist.md` — the FLOOR fulfillment-floor task.
- `specs/multi-visual.spec.md` + `.checklist.md` — the PIPELINE command-center task (three/p5/charts/flow).

**The test set is the shared, versioned contract** — everyone who wants to prove the pack on their
model runs the SAME spec + checklist, so proofs are comparable. Only write a new set when a pack has
no suitable one; then commit it under `specs/` so the next person reuses it.

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

## Add your own proof (anyone, any model — the point is it's easy)

The proof ledger grows by contribution. To add a proof for pack `<P>` on model `<M>`:

1. **Fetch the shared test set:** `specs/<P>.spec.md` + `specs/<P>.checklist.md` (if none exists,
   write one and commit it under `specs/` first — then it's reusable by everyone after you).
2. **Run the A/B on `<M>`** (Steps 2–4 above): control (packs stripped) vs treatment (packs shown),
   one shot each, publish both to a bench node, drive them in a browser against the checklist.
3. **Write the evidence file** `results/aeb3-<P>-<M-slug>.md`: the model used, tokens, the filled
   checklist, browser findings, screenshots, and — if it failed — the exact failure mode.
4. **Append the proof row** to this file's "Proven on" cell for `<P>` (model → verdict → evidence
   link) and, if it changes the strongest passing tier, update the `Tier`.

That's the whole loop: same spec + same checklist, one new results file, one appended row. Because the
test set is fixed and shared, a proof from model X and a proof from model Y are directly comparable —
the ledger becomes a "works on / fails on" matrix per pack that builders can pick from.

*(Optional future helper, not built: `pnpm aeb:prove <pack> --model <name>` could scaffold the two
build-prompt variants + the results-file stub and open the checklist — turning the 4 steps into one
command. Propose before building.)*

---

## What the tiers imply for the prompt pipeline (proposal, not yet built)

- `any` packs: advertise freely to every model; the one-line blurb is enough.
- `frontier` packs: when the target model is weak, either **inline the breaking-API idiom** in the
  build-prompt pack list, or hard-require "fetch this pack's ai_doc — the API you know is removed."
  (Candidate: an optional `apiCaveat` field on the registry entry that the prompt inlines for these.)
- `needs-doc` packs: the pipeline should *force* the ai_doc fetch before first use.

Encoding this on the `LibraryPack` registry entry (surfaced in `GET /v1/library-packs`) is the natural
next step. Proposed optional fields — a pack with none simply ships unlabelled, exactly as today:

```ts
modelTier?: 'any' | 'frontier' | 'needs-doc';   // strongest proven strength (derivable from proofs)
proofs?: Array<{
  model: string;            // e.g. 'claude-haiku-4-5', 'claude-opus-4-8'
  verdict: 'pass' | 'fail';
  testSet: string;          // 'pixi' → specs/pixi.spec.md + .checklist.md
  evidence: string;         // 'results/aeb3-pixi-perpack.md'
  tokens?: number;
  date: string;
}>;
```

Then `GET /v1/library-packs` exposes, per pack, **which models it's proven on** — so a client (or the
build pipeline) can filter "packs proven to work on the model I'm about to use". Adding a proof from a
new model = appending one `proofs` entry + committing one `results/*.md`. **This schema change is a
design decision (code + openapi + generate:types + both locale files + registry E2E) — do not
implement until the developer signs off.** The `specs/` + `results/` + this table already deliver the
same ledger in-repo today; the registry field just makes it queryable at runtime.
