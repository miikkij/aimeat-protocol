<!--
@file memory-contracts.md
@description The Memory Contract pattern — a reusable procedure for building automation/coordination
  in AIMEAT on top of the existing memory system, instead of bespoke tables + handlers. Documents the
  five parts, when to use / what to keep behind the contract, and points to Tracked Response as the
  reference implementation.
@version-history
  v1.1.0 — 2026-08-26 — The row store, and the one multiplication that decides between it and a
    memory key. The repo said "prefer a memory record over a new table" and said nothing about the
    case where neither is right, so streams that arrive in volume kept landing in memory and were
    found later by an audit rather than by a limit.
  v1.0.0 — 2026-06-21 — Initial guideline, extracted from the Tracked Response feature.
-->

# Memory Contracts

**Reach for this by default when building automation or coordination in AIMEAT.** Before adding a new SQL table + bespoke handlers for "when X happens, do Y," ask: *can this be a Memory Contract?* Usually it can, and then a new automation is "design a JSON shape + a condition + an action" — no migration, no backend sync, and it federates and stays AI-legible for free.

A **Memory Contract** is one self-describing memory record that holds all the state for a piece of coordination, plus the rules for reacting to changes in it. We own only the record and our reaction to it; whatever computes or advances the state lives in **whatever system honors the contract** — internal, or an external system we know nothing about. The memory entry *is* the interface.

## Why it fits AIMEAT
AIMEAT is about *refined, valuable knowledge and the wisdom drawn from it* — not mass processing. A Memory Contract holds exactly that: the refined, decision-relevant state and the reaction rules. So the pattern's scope is not a limitation — it *is* the point. Heavy lifting stays behind the contract; the contract surfaces only the small, valuable, legible state we react to.

## The five parts (every contract has these)
1. **Self-describing record** — one memory key holds all state as structured JSON, with a `type` discriminator and a `spec` link to a doc that tells any human/AI how to read and update it. The record is the contract; other systems honor it without us shipping per-integration code.
2. **Condition as data** — the trigger/completion test is declarative JSON (e.g. `{ watch.key, condition: { field, equals } }`), not code — so it is editable, inspectable, and reusable.
3. **Reactive via trackable keys** — a registry of watched keys + a write hook fires evaluation when a watched key changes (event-driven). A reconciler sweep is the **safety net** so nothing fires-once-and-fails-silently or gets forgotten.
4. **Action dispatcher** — a `channel` / `mode` seam (auto vs human-gated), reusing existing services for the side effect (e.g. the federated message-send path). New channels slot in behind the same seam.
5. **Idempotency + observability** — guard fields (`lastUpdatedAt`, `lastTriggeredAt`, `attempts`, `lastError`, a `sent*Id`) make every contract replayable and auditable, and prevent double-firing across crashes/retries.

## When to use (default for)
Any valuable, refined, **event-driven coordination**: cross-system / cross-node handoffs, human-or-AI-in-the-loop gating, "do Y when X becomes true," anything an internal or external AI/system should be able to read and advance through a stable contract.

## Keep behind the contract (not in it)
High-write-rate or high-volume data, transactional/relational workloads, latency-critical paths, large blobs. These are not forbidden — they live in the **honoring system behind the contract**, which surfaces only the refined state we react to. The contract stays small, valuable, and legible.

## A row, a memory key, or a table

The repo's standing default is to prefer a memory record over a new table. There is a third answer, and reaching for it early is cheaper than discovering it: a **row store** on an organism workspace — `backing: 'rows'` on an objectType, appended through `/v1/organisms/:org/workspace/rows/:space`.

**One multiplication decides it, and it is worth doing before writing anything that writes on a schedule:**

> **If `keys_per_day × 365` exceeds 1000, the shape is wrong.**

1000 is the default key ceiling per principal (`src/config.ts`). Anything that writes a key per item per day crosses it inside a year, and the crossing is silent right up to the refusal. aimeat.io runs the ceiling at 100 000, which no other node does, so the node this was built on will not be the node that teaches you — build against 1000.

| | memory key | row store | its own table |
|---|---|---|---|
| one thing a person opens, or one collection they read whole | ✓ | | |
| a stream that arrives in volume and does not stop | | ✓ | |
| versioned, searchable, patchable, federatable | ✓ | | |
| appended, never edited, no version history | | ✓ | |
| charged to the member who wrote it | ✓ | | |
| charged to the organism | | ✓ | |
| needs SQL the app cannot express as a filter | | | ✓ |

**Four properties of the row store, each of which is why it exists:**

- **The quota is the organism's.** A memory key under `organism.*` is charged to the GHII of whoever wrote it, so ten members sharing a workspace draw on ten separate personal budgets and a member's own `user:` records share the same ceiling. Group data on one person's account is the asymmetry this fixes.
- **No version history.** Publishing a workspace record writes a full copy under `.version.N` with a window of 20. For a stream, twenty retained copies of every row is the whole problem restated.
- **Rows never enter the workspace index read.** That read materialises every value it touches and truncates at 5000 with no error and no flag. A `rows` space shows a count and a newest timestamp there, and nothing else.
- **Three timestamps, because they are three different questions.** `occurredAt` is when the thing happened in the world and is the query axis (`since`, `until`) and the default order; `createdAt` is when the row was written here and is what retention prunes on, because a retention promise is about how long WE keep it; `updatedAt` answers "what changed since I last looked" and is what any incremental sync needs. One column would force a choice, and the wrong choice shows up when somebody asks what arrived in August and is told when it was indexed.

**Filtering is on declared columns only.** A space names up to three fields in `indexOn`; they are denormalised into real indexed columns, and filtering and ordering happen on those. A field that was not declared is readable but not filterable, and the route **refuses** an undeclared filter rather than ignoring it — the generic `(scope, key, metrics JSONB)` table this repo already rejected once was unqueryable precisely because it did not have this.

**What does NOT belong in a row store**, because each already has a home that does the job better: opens and clicks (signals streams, with monthly rollups and a 24-month retention), send attempts and bounces (`OutboundMessage`, append-only with paging), email addresses even at 50 000 (`OutboundContact` is a real table with no row ceiling, a unique key on owner-plus-address, and the opt-out beside it), files and attachments (file storage), and a list published outward (a data package: CSV, a permanent public address, an OData feed).

## The mechanics (shared scaffolding)
The reusable pieces are generic, keyed on the contract `type`:
- **Registry** (`src/services/track-registry.ts`) — a process-local set of watched keys, rebuilt at boot from the live contracts; O(1) "is this key watched?" before any heavier evaluation. Updated on contract create/cancel/fulfil.
- **Write hook** — `emitMemoryWritten(ownerGaii, key)` (`src/services/event-bus.ts`) called from the central write paths (the generic memory-write route, the workspace publish path); a subscriber checks the registry and evaluates matching contracts.
- **Reconciler** — a periodic sweep over the contract namespace that retriggers anything in `error`, or whose condition is already met but never fired (missed event), or stuck past a TTL. This is what makes the pattern durable rather than fire-and-pray.

## Reference implementation
**Tracked Response** — an inbox message owed a federated reply once a linked follow-up completes. See `docs/specs/tracked-response-contract.md` (the contract shape + rules) and:
- `src/services/tracked-response.ts` — evaluator + fire (auto/approve) + reconciler
- `src/services/track-registry.ts` — the generic registry
- `src/routes/tracked-responses.ts` — create / list / cancel / evaluate

## Adding a new contract type (checklist)
1. Write a `spec` doc under `docs/specs/` (shape + state machine + the rules other systems must honor).
2. Define the record shape with `type`, `spec`, a `watch` (key + condition), a `response`/action seam, and the tracking/delivery guard fields.
3. Reuse `track-registry.ts` + the write hook + the reconciler (keyed by your `type`).
4. Reuse an existing service for the side effect; add a new `channel` only if none fits.
5. Keep it owner-scoped memory, off the `organism.` prefix unless it genuinely belongs to a workspace.
