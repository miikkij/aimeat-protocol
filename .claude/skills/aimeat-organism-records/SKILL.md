---
name: aimeat-organism-records
description: Where AIMEAT design specs, plans and roadmap items are authored (in the AIMEAT organism on aimeat.io, not repo docs/), the dogfood session rituals, LOOM/MACHINE ROOM reference resolution, and the ODPS provider identity block. Use when writing a design spec, plan, roadmap item, room.target/room.card/room.release record, an EXCHANGE listing's ODPS descriptor, or when reading/updating the dev organism's context and handbook.
---

# Organism records, roadmaps and ODPS listings

Applies only when an `aimeat_*` MCP server is connected. If none is, skip silently.

## Where new design work is authored

New design specs, plans and roadmap items are **records in the relevant AIMEAT organism on aimeat.io**, not files in repo `docs/`. Deliberate dogfooding: our own knowledge work runs on our own product, and the data stays in the service we own.

Route to the organism where that product's roadmap lives: each MACHINE ROOM app to its own organism/FABRIC; the AIMEAT platform itself (including `app-catalog`) to the FABRIC roadmap hub.

**Canonical in the repo, unchanged:** `openapi.yaml`, the RFC sections and coding-guideline references under `docs/`, `CLAUDE.md`, `docs/known_gaps.md`.

**Publishing is a gate.** Draft freely; publish only on the developer's explicit go-ahead in this session. Never auto-publish.

## Dev organism session rituals

Organism id `fbb51de5-56d5-4143-9871-b998a1187655`, appdev MCP (`mcp__claude_ai_AIMEAT_Appdev__*`). Source of truth for coordination and working context; the repo stays source of truth for code and the protocol contract. Full design: `docs/internal/aimeat-dev-organism-plan.md`.

Workspaces: Development `ws-mq664uyfz21`, Handbook `ws-mq6653ry24h`, Protocol `ws-mq665ahqc6b`.

1. **Session start:** read the `context` doc `main-context` in Development, the last few `decision`s, and the activity feed delta. Do not ingest the whole organism.
2. **Planning a task:** read just-in-time. The area's Handbook page(s), open `feature`/`bug` records, relevant `decision`/`invariant`.
3. **Finishing significant work:** update the `feature`/`bug`; log a `decision` or `known-gap` (both gated on human approval); update the Handbook page and the sub-context doc's current-state.
4. **Milestones:** a sub-context draft is the live current-state and can be edited freely. A publish is a milestone and needs the developer's explicit go-ahead.
5. **Sync:** keep `docs/known_gaps.md` and the roadmap in two-way sync (`pnpm organism:sync`, once it exists).

Never add a `known-gap` entry on your own, in the organism or in `docs/known_gaps.md`.

## LOOM roadmap work (MACHINE ROOM WARP/FABRIC)

Org `e8617051-...`, workspace `ws-mr48730nq0b`.

LOOM's `resolveDocRef` resolves `born_from.docs` and event `refs` from **only three places**:

1. the MACHINE ROOM `room.design` space (the YARN rule: design docs come only from there),
2. a librarian full-text search,
3. fallback: the dev organism's Development workspace (`ws-mq664uyfz21`).

A doc anywhere else, including DESIGN STUDIO (`ws-mr5mauol7vk`) and `room.outbox`, renders as a red "ei saatavilla" chip.

**So:** when a target is born from a DESIGN STUDIO session doc (SESSIO NNN), mirror that doc into `room.design` with the **same doc id** (note the canonical location at the top of the mirror) before or when publishing the target. Same for any other referenced doc outside those three places. FABRIC cards and releases follow the same rule.

`room.target_event` and `room.release` are **append-only**: a publish over an existing id is refused. `room.target` and `room.card` are updatable but require `expected_version`.

Write proper Finnish (ä/ö) in every record field. The node is fully UTF-8, and append-only namespaces make orthography mistakes permanent.

## ODPS provider identity

When an EXCHANGE listing's ODPS descriptor asks for the provider's legal identity or jurisdiction and the creator is Jouni / `happydude500001`, these are the values. Fill them in; do not leave them blank and do not ask.

```json
"dataHolder": { "legalName": "Overscale Solutions Oy", "businessID": "3323553-5",
                "URL": "https://www.overscalesolutions.com",
                "addressCountry": "FI", "addressLocality": "Espoo" },
"license":    { "geographicalArea": ["Worldwide"], "applicableLaws": "Finnish law" }
```

Same block the PRH app-tools already use. With it a listing validates at 100% completeness; without it the validator reports `dataHolder` and `applicableLaws` missing.

Everything else in the descriptor (valueProposition, SLA, dataQuality, provenance) is stated from what you actually know about the capability. Invent nothing there.
