# AEB-3 round 4 — controlled A/B on the flagship task class (protocol v2, 2026-07-17)

The formal budget-allocation A/B the flagship pointed to. Same complex domain task
(a team Sales & Marketing Command Center) built TWICE by fresh agentic-coder sessions,
one shot each, with network to a bench node. **Controlled variable:** the build-app prompt.
- **Run A (packs hidden):** the "Ready-made UI (cortex)" block AND the "Optional capability
  packs" block were removed from the build prompt. Core SDK libs (auth/data/organism/ai/
  markdown/live/agentface) stayed in both — they are the platform baseline, not accelerator packs.
- **Run B (packs shown):** the unmodified build prompt (charts/flow/3D/particles packs advertised).
The **spec is identical and pack-neutral** (capabilities described — "a rotating 3D view",
"an editable node diagram" — never a library name), so A got no hint the packs exist.

## What each arm built

| | Run A (packs hidden) | Run B (packs shown) |
|---|---|---|
| Tokens | 129,562 | 163,046 |
| App size | 68 KB | 74 KB |
| Data layer | flat PUBLIC memory keys + a hand-rolled member roster (avoided the workspace layer) | proper **organism workspace**, schema-locked process/campaign/deal namespaces |
| 3D view | hand-rolled canvas painter's-algorithm bars + rotation matrices | **three pack** (drag-orbit, theme bg) |
| Particle band | hand-rolled canvas | **p5 pack** |
| Charts | hand-rolled canvas | **chartjs pack** |
| Editable process | custom | **aimeat-flow pack** |
| Tool calls (fetches) | 15 | 31 (fetched pack docs + lib sources) |

## Browser verification (bench node, real interactions)

**Run A:** create team → load demo data → Overview shows KPIs (€298k open / €168k weighted
forecast / €33k won), 4 canvases rendering, **role gate CORRECT** (the org creator is shown as
MANAGER), all 5 tabs, only benign 404s (empty-key reads). A complete, working command center.

**Run B:** provisioned the organism workspace (after a platform fix — see below); three/p5/
chartjs/aimeat-flow all load with **0 console errors**; all 5 tabs present. BUT a **role-
derivation bug**: the org CREATOR is shown as MEMBER with zero manager controls, so the
manager-only setup (define process, seed demo data) is **unreachable for the space owner** →
the whole domain data flow is blocked. Its superior architecture never gets data through the UI.

## Verdict (protocol v2)

**B does NOT beat A.** By the v2 rule (B wins only with MORE domain checks, or equal at ≥20%
less budget): B passes FEWER domain checks (its role bug cascades to block seeding →
persistence/ROI/forecast/aggregation all unreachable) AND used MORE tokens (163k vs 130k).
A shipped a simpler-but-fully-working app with correct roles.

## What this actually teaches (more useful than a rigged "B wins")

1. **Pack value at the commodity/visual layer is confirmed.** B got 3D + particles + charts +
   an editable flow as a few pack calls each, all rendering with zero errors, while A hand-rolled
   all of it (much larger engine code share). That half of the hypothesis holds cleanly.
2. **"Freed budget → better domain" did NOT hold on a frontier model.** B spent its freed budget
   on the harder, more-correct architecture (real workspace + membership roles) and got the ROLES
   WRONG; A's simpler flat model just worked. Packs accelerate the commodity layer; they do not
   make the domain logic correct, and richer architecture is a double-edged sword.
3. **The controlled A/B does not reproduce the flagship's clean budget win.** The flagship LOOKED
   like a decisive pack win because I hand-authored a pack-prescriptive spec (told it exactly which
   pack, gave schemaRefs). Removing that guidance, the pack arm's advantage shrinks to the visual
   layer and is offset by the domain bugs it introduced. Honest conclusion: on a frontier model at
   this task size, packs are a **visual/commodity accelerator, not a domain-quality multiplier**.
   The domain-quality win, if real, likely needs a weaker model (where hand-rolling engines eats the
   budget that domain correctness needs) — the next discriminator.

## Platform bugs surfaced + fixed by this exercise (the real ROI)

Both block ANY app that provisions its own organism workspace from the documented lib API:
- `AIMEAT.organism.create()` returned the raw `{ organism }` envelope, not the documented
  `{ id, name }` → `createWorkspace(org.id, …)` got `undefined` (fixed 81b0a2db).
- `AIMEAT.organism.createWorkspace()` — the manifest meta-schema REQUIRES `schemaRef` per
  objectType but the lib documented it as optional → 400 INVALID_MANIFEST. The lib now auto-fills
  a schemaRef + permissive schema so the documented contract holds (fixed 268cc2b2).
Both the flagship AND Run B hit these independently — strong signal they'd bite real builders.
