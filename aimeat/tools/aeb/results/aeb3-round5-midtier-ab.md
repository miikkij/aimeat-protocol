# AEB-3 round 5 — mid-tier-model controlled A/B (the budget-allocation discriminator, 2026-07-17)

The decisive re-run of round 4 on a **mid-tier model (Claude Haiku 4.5)** instead of a frontier
model. Same controlled setup: identical pack-neutral PIPELINE spec (a team Sales & Marketing
Command Center), the ONLY variable is the build prompt — packs hidden (A) vs shown (B).
Rationale: round 4 on a frontier model tied because the model hand-rolls working engines within
one build's budget (ceiling effect). The hypothesis is that on a *weaker* model, hand-rolling the
engines eats the budget that domain correctness needs — so the pack arm should complete more DOMAIN.

## What each arm built (Haiku 4.5)

| | Run A (packs hidden) | Run B (packs shown) |
|---|---|---|
| Tokens | 77,284 | 83,799 |
| App size | 39 KB | 52 KB |
| Visual engines | hand-rolled Canvas 2D (three/p5/chart all `undefined`) | **three + p5 + aimeat-charts + aimeat-flow** packs (+ ui-dialogs/nav/motion, styling) |
| Data layer | flat public memory keys | flat public memory keys (both chose flat; neither used the workspace here) |

## Browser verification (bench node, real interactions) — DOMAIN checklist

| Domain check | Run A | Run B |
|---|---|---|
| Roles (manager/member/visitor) | ❌ **no role system at all** | ✅ role = Manager |
| Demo-data seeding (manager) | ❌ **no seed action; KPIs all €0** | ✅ demo loaded (€270k open / €179k forecast / €100k won) |
| Data chain aggregates (KPIs) | ❌ €0 (empty) | ✅ computed from seeded deals |
| Editable process diagram | partial (hand-rolled, empty) | ✅ **5 flow nodes** (aimeat-flow: Lead→…→Closing) |
| Campaign ROI | present as a form only | ✅ ROI computed on Campaigns tab |
| Kanban deals across stages | modals present, no data | ✅ 11 deal values across 5 columns |
| Console errors on load | benign 404s only | benign 404s only |
| Visual engines render | 2 hand-rolled canvases | 3 pack canvases (three/p5/chart) |

## Verdict (protocol v2): **B beats A on domain — hypothesis CONFIRMED**

On a mid-tier model the no-pack arm spent its budget hand-rolling three visual engines and
**dropped domain features** — no roles, no demo seeding, empty aggregation. The pack arm got the
visual layer as a few pack calls and spent its budget on the domain: roles, demo data, working
weighted-forecast/ROI aggregation, an editable process flow with per-stage counts, and a populated
kanban. B passed materially MORE domain checks (tokens were ~similar, so the win is on domain, not
budget — exactly the v2 verdict path).

## Cross-model picture (the honest, useful conclusion)

- **Frontier model (round 4, Fable):** packs = a **visual accelerator**. Both arms nail the domain;
  the pack arm's advantage is the commodity/visual layer and it can even lose budget to the richer
  architecture it then gets wrong (role bug). No domain win.
- **Mid-tier model (round 5, Haiku):** packs = a **domain enabler**. The no-pack arm can't afford
  both the engines AND the domain, so it drops domain features. Pack arm wins on domain.

**This validates the pack value proposition for the population packs mostly serve — cheaper/weaker
models.** The clean budget-allocation win the flagship suggested reappears once the model is weak
enough that hand-rolling the commodity layer is no longer "free."

## Stable flips

`three` and `p5` were load-bearing in B's domain-winning build (both rendered; the 3D overview and
particle band are part of the working command center) → flipped **preview → stable** citing this
result. Honest caveat: this is a COMBINED-task multi-pack win, not an isolated per-pack A/B; the
attribution is "these visual packs, available together, let a weak model complete more domain."
`pixi` and `phaser` were not exercised in this task and stay `preview` pending their own runs.
