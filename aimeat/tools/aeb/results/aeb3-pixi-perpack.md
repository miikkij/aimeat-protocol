# AEB-3 pixi per-pack A/B — the gate run for `pixi` preview→stable (2026-07-17)

The per-pack A/B the AEB-3 gate requires before flipping `pixi` from preview to stable.
Task: the pack-neutral **FLOOR** spec (a live fulfillment-floor monitor — see
`scratchpad/pixi-neutral-spec.md`), built TWICE on **Claude Haiku 4.5** (the mid-tier model where
the discriminator lives), one shot each, network to a local bench node. Only variable = the build
prompt: **A** = pack blocks stripped (SDK core libs only), **B** = unmodified (pixi + packs shown).
Both apps published to the bench and driven in a real browser (Playwright MCP), signed in as owner,
demo data loaded (~200 orders).

## Verdict: **pixi STAYS preview — gate NOT met.**

B did **not** beat A on domain. **Both arms shipped apps that are broken in the browser** (neither
renders its own data), and B's pixi integration specifically **crashed**. There is no recorded
B-wins-domain result, so per the gate `pixi` does not flip. `phaser` was not exercised and also stays
preview.

## What each arm built (Haiku 4.5)

| | Run A (packs hidden) | Run B (packs shown) |
|---|---|---|
| Tokens (subagent) | 69,936 | 71,955 |
| App size | 47.6 KB | 44 KB |
| Visual layer | hand-rolled `<canvas>` (never sized past 300×150 default) | **pixi@8 + pixi-unsafe-eval@8** (both files, CSP companion correct) + styling pack |
| Scopes requested | memory:read/write | memory + storage + **organism:write** |
| ai_docs fetched | 1 curl (health) | **0 pack ai_docs** ("None needed — self-documenting from the prompt") |
| Data persisted | ✅ floor.orders(200) / pipeline(5) / workers(6) / agentface | ✅ floor.orders(200) / stations(5) / workers(6) / summary |
| Role on load | ✅ SUPERVISOR (correct) | ⚠ SUPERVISOR → **flipped to Worker** after the demo write |
| In-browser render | ❌ views empty | ❌ floor crashes on init |

## Browser verification (bench node, real interactions)

**Both arms:** write path works — a full domain dataset (200 orders, 5 stations, 6 workers, a
computed agent summary) persisted to storage in each. The **domain logic was built** in both. But
neither shows it:

- **Run A:** every view renders empty. Console: 404 on `…/floor.pipeline:0`, `…/floor.workers:0`,
  `…/floor.orders:0` — the app READS keys with a spurious `:0` suffix while it WROTE the clean keys
  (`floor.orders` etc.), so every read 404s and the UI has nothing to show. The hand-rolled canvas
  stayed at its 300×150 default, unrendered. Role gate correct (SUPERVISOR). Agent summary ✅.
- **Run B:** floor never initializes. Console: `TypeError: g.fillRect is not a function` at
  `initFloor` and `this._cancelResize is not a function` in `PIXI…destroy`. B wrote **PixiJS v7
  Graphics code** — `g.fillStyle.color=…; g.fillRect(); g.lineStyle(); g.drawRect()` — against
  **pixi v8**, where those are removed (v8 chains `new PIXI.Graphics().rect(x,y,w,h).fill(color)`).
  The crash aborts `loadData` ("Error loading data"), the role re-derives as **Worker**, and the
  floor shows "No stations yet." B ALSO carries the same `:0` read-key 404s as A.

Screenshots: `scratchpad/floor-A-02-floor.png` (A empty), `scratchpad/floor-B-broken.png` (B empty).

## Why this is a useful negative (the real ROI — cf. round 4)

1. **Pack-doc DELIVERY gap (highest value).** The pixi ai_doc is *excellent* — it leads with
   "CRITICAL — v8 API, NOT the v7 idioms you likely know" and shows exactly the `.rect().fill()`
   idiom B got wrong. But **B never fetched it.** The build prompt says "before using a pack, fetch
   its ai_doc", yet a mid-tier model skipped that step and coded pixi from stale v7 memory → crash.
   The one-line pack blurb in the prompt ("sprites, particles… 60fps") carries no API contract, so a
   doc-skipping model has nothing to correct its priors. **The doc content is right; the delivery is
   skippable, and weaker models skip it.** This is a design fix, not an aiDoc edit (see below).

2. **Shared `:0` read-key bug.** Both independent builders emitted `key:0` on a read path (the clean
   `data.get('floor.orders')` lines are fine — the `:0` comes from a secondary read, likely a
   live-refresh/versioned re-read). It's pack-independent (hits A and B equally, so it doesn't bias
   the comparison) but it broke both UIs and deserves root-causing in the build-prompt Data Storage
   guidance or a shared live-update pattern.

3. **Role-derivation fragility resurfaced** (B: SUPERVISOR→Worker after a write) — same class as
   round 4's role bug. A generated role from space-ownership correctly and kept it; B's re-derivation
   after the organism/write path regressed it.

## Confounds / honesty

This single run is **not a clean measure of "does pixi accelerate domain"**: the `:0` bug broke both
UIs, so domain checks D1–D7 fail for both at the UI layer regardless of packs. What IS robust and
independently sufficient to deny the flip: **B's pixi usage crashed** (v7→v8 API misuse) while A's
no-pixi path did not — i.e. on a mid-tier model, reaching for pixi *without fetching its doc* added a
failure rather than removing one. A cleaner re-run would need both arms to render; the pixi-specific
finding stands on its own.

## Actions (gated — for the developer, not auto-applied)

- **Do NOT flip pixi/phaser to stable.** Both remain preview.
- **Proposed design fix (Rule 11 / pipeline design — needs go-ahead):** for packs with a
  breaking-API-version history (pixi v7→v8 especially), surface the critical idiom *inline* in the
  build-prompt pack list (or hard-gate: "you MUST fetch this pack's ai_doc — the API you know is
  removed"), so a doc-skipping model still gets corrected. Candidate: add a `apiCaveat` field to the
  registry that the prompt inlines for high-risk packs.
- **Root-cause the `:0` read-key 404** both builders produced (build-prompt Data Storage section or
  live-refresh example).
- The pixi ai_doc itself needs **no change** — it already covers the exact mistake.
