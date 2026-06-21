# Living Documents — Spec & Phased Plan

_Status: design soft-locked 2026-06-21. Workspace-backed. Builds on the notebook
enrich/delegate/distribute pipeline + the workflow engine + the offer/morsel economy._

## 1. Vision

A **living document** is a workspace-backed markdown document that maintains itself.
It is **assembled from memory keys** (not inline text), refreshed in the background by a
**pulse** (a workflow), scoped by a **charter**, and recorded in a **ledger**. Every
finding and every refinement is a versioned memory entry, so the document has full
**provenance** and **per-section time-travel** by construction. It can grow recursively,
fire on real-world triggers, stop itself when a goal is met, and — as a shareable
**template** — act as a billable contract that routes placeholder-fill to the author's
agents.

## 2. Locked decisions

- **Workspace-backed only.** All artifacts live inside an organism workspace (free
  versioning via `.latest` + `.version.N`, the existing workspace viewer, organism sharing).
- **Markdown** is the render format.
- **Charter is shown two ways:** a technical **YAML** form and a **readable** prose form,
  kept in sync. Both are editable by hand.
- **AI-authored configuration:** an AI step turns a user's plain-language need into a
  charter + template (both forms); the user can then edit everything by hand.
- **Live view + timeline:** see the latest render; scrub history globally and **per
  section**; read older versions; drill into sections; pick a per-section combination of
  versions to compose a **personalized static snapshot** saved to the normal
  document-space.
- **Two surfaces:** you author/manage **templates** in a personal **Living Documents**
  management area, then **deploy** a template into a workspace where it becomes a live
  **instance** that pulses, accrues content, and renders with a "living" UI. Template =
  reusable skeleton (no content); instance = workspace-backed, alive.
- **Profile menu item:** "Living Documents" is a top-level profile tab (not buried in a
  workspace), because instances **generate cost** when they pulse and must be easy to find,
  monitor, and pause.
- **Template marketplace + cross-owner billing is DEFERRED** until the organisations
  capability exists — sharing and billing happen **only through organisations**. The
  schema keeps forward-compat hooks (see §3.5, §8) so it slots in later without rework.

## 3. Data model (soft-locked)

Everything is a workspace object/record under one living document `docId`. Per-slot
history comes from workspace versioning (`versioned: true`).

| Artifact | Space / key (within `organism.{org}.w.{ws}`) | Mode | Purpose |
|---|---|---|---|
| **Config** | `living.{docId}.config` | document, versioned | charter + template (config history) |
| **Source** | `living-src.{docId}.{srcId}` | records | one raw finding/fact/excerpt + provenance + `active` flag |
| **Derivation** | `living-slot.{docId}.{slotId}` | document, versioned | refined content for a slot; `.version.N` = time-travel |
| **Ledger** | `living-ledger.{docId}.{ts}` | records | append-only change events |
| **Snapshot** | normal document-space (`pages.*`) | document | frozen personalized copy (a plain doc, not living) |

A new workspace `schemaRef: schema:living-document@1` marks the config object so the
viewer knows to render it as living.

**Templates** (the personal management surface) live in **owner memory**, not a workspace,
since they're reusable across workspaces:

| Artifact | Key (owner memory) | Purpose |
|---|---|---|
| **Template** | `living.template.{templateId}` | reusable charter+template skeleton (no content) |
| **Template index** | `living.templates` | list/metadata for the management UI |

Every deployed instance's `config` records `templateId` + `templateVersion` it was deployed
from (linkage for future template→instance migrations and, later, marketplace attribution).

### 3.5 Surfaces & forward-compat hooks

- **Template (personal):** authored/edited in the profile **Living Documents** tab. Fields
  include `visibility` (default `private`; the marketplace later flips this to
  `org`/`public`) and `billing` (unused until §8). Carrying these now means Phase 6 adds
  behaviour, not schema churn.
- **Deploy:** instantiating a template into a workspace **copies** its charter+template into
  `living.{docId}.config` (snapshotting `templateId`+`templateVersion`), ensures the
  workspace manifest has the `living` objectType, and registers the instance in the
  cross-workspace index the profile tab reads.
- **Instance status** (`living.{docId}.config.status`): `version`, `last_pulse`, `health`,
  **`paused`** (cost control), and **`cost`** (cumulative morsels/AI spend) — recorded from
  the first pulse so the profile tab can show/limit spend and future org-billing has data.
- **Stable slot ids:** editing a template must preserve slot `id`s so a deployed instance's
  derivations keep mapping; renames are id-stable.

### 3.1 Template + slots

```yaml
template:
  - section: "Who's shipping"
    desc: "Companies with shipping or near-ship cells. Facts only, dated, sourced."
    slot: shipping
    kind: derived              # static | derived | aggregate | composite | manual
    rules: { max_words: 150, sources: [web-researcher], may_recurse: true }
  - section: "Price history"
    slot: prices
    kind: aggregate            # computes from the time-series of its source records
    render: table              # table | chart (chart = later phase)
  - section: "Editor's notes"
    slot: notes
    kind: manual               # human-owned; the pulse never rewrites it
```

**Slot kinds:**
- `static` — fixed prose from the template (scoping/structure only).
- `derived` — LLM refines active sources into prose (the default).
- `aggregate` — computes a table/series/chart from the *set* of source records over time
  (e.g. daily stock closes → table now, chart later). No LLM rewrite; deterministic.
- `composite` — contains a **sub-template with its own slots** (recursion).
- `manual` — human-authored; pulse may only *propose* adjacent slots, never edit this one.

### 3.2 Source record

```jsonc
{
  id: "a1", slot: "shipping",
  text: "ProLogium pouch cells to a Chinese OEM, Q4 2026",
  data: { /* optional structured payload, e.g. {ticker:'QS', close:6.12} for aggregate slots */ },
  producer: "web-researcher#jouni@node",     // who produced it (provenance / billing)
  origin: "electrek 2026-05-27",             // url/citation
  active: true,                              // disable-don't-delete
  supersededBy: null,
  addedAt: "…", deactivatedAt: null
}
```

### 3.3 Derivation record

```jsonc
{
  slot: "shipping", version: 14,
  markdown: "- **ProLogium** — … Q4 2026 〔a1〕\n- **QuantumScape×Honda** …",
  derivedFrom: ["a1","b3","c2"],   // exact sources this stands on → "how we concluded"
  producedAt: "…", producedBy: "pulse|human", prev: 13
}
```

### 3.4 Rendering & time-travel

Render = walk the template; per slot show its current (latest active) derivation, or for
`composite` recurse into the sub-template, or for `aggregate` compute from active sources.
Disabled sources and superseded derivations drop out of the active view but persist.
**Time-travel** = read `living-slot.{docId}.{slotId}.version.N`, or render "as of date D"
using sources whose `[addedAt, deactivatedAt)` window contains D (so transitions need
timestamps, not just creation times).

## 4. Charter (the contract) — two forms

### 4.1 YAML (technical)

```yaml
charter:
  title: "Daily watch: EV-supply-chain stocks"
  scope: "Daily close + notable moves for a set of tickers, with the news behind moves."
  tracks:
    - "Daily closing price per ticker"
    - "Notable (>5%) moves and why"
  params: { tickers: [QS, SLDP, FREY], move_threshold_pct: 5 }
  include: [stock, close, earnings, guidance]
  exclude: [crypto, options]

  # WHO fills WHAT (this is the billable contract part for shared templates)
  agents:
    - { slot: prices, offer: "quote-bot/daily-quote" }
    - { slot: moves,  offer: "web-researcher/research" }

  # WHEN to pulse — ANY trigger may fire (composite), subject to guards + cadence floor
  triggers:
    - { kind: schedule, cron: "0 22 * * 1-5" }                 # weekdays 22:00
    - { kind: activity, on: workspace, changed_gte: 10 }       # 10 ws items changed since last pulse
    - { kind: activity, on: workspace, changed_gte: 1, since_last_pulse_h_gte: 24 }  # <10 but 24h old
    - { kind: event, on: memory.write, match: { key: "*.quotes.*" } }

  # WHEN NOT to pulse (suppress even if a trigger matched)
  guards:
    - { no_workspace_activity_for_h: 168 }   # dormant workspace → skip
    - { cadence_floor_h: 6 }                 # never more often than every 6h (cost guard)

  # WHEN to STOP (end the pulse, notify, optionally freeze a snapshot)
  stop:
    - { when: "metric.maturity >= 0.9", then: { notify: true, freeze: true } }
    - { when: "param.ticker delisted",  then: { notify: true } }

  recursion: { max_depth: 2, max_subslots_per_slot: 6, max_total_slots: 30,
               spawn_threshold: "leaf > 1.5x max_words for 2 cycles",
               on_overflow: split_to_child_doc }
  decay: "disable sources unverified for 5 cycles"
  size_budget: 2000 words
  trust: { derive: auto, curate: gated, restructure: gated }   # per-action gating

  billing: { model: per-pulse, billed_offers: ["quote-bot/daily-quote", "web-researcher/research"] }
```

### 4.2 Readable (prose, generated from the YAML; editable)

> **Daily watch: EV-supply-chain stocks.** Tracks the daily close and notable (>5%) moves
> for QS, SLDP, FREY, and the news behind each move. It refreshes on weekday evenings, or
> whenever 10+ workspace items change, or once a day if anything changed at all — but never
> more than every 6 hours, and not at all if the workspace has been quiet for a week. Prices
> come from *quote-bot*; move explanations from *web-researcher*. It stops and notifies you
> when the topic is "mature" or a ticker is delisted. New wording is applied automatically;
> dropping facts or restructuring asks first.

## 5. Trigger / guard / stop lifecycle (new)

A pulse is **considered** when ANY `trigger` matches; it **runs** only if no `guard`
suppresses it and the `cadence_floor` is satisfied; after running it evaluates `stop`.

- **Activity triggers** count workspace items changed *since the last pulse* (the engine
  already tracks workspace activity / `memory.write` events). The two activity rules
  together encode "10 changed, OR ≥1 changed and 24h elapsed."
- **Guards** are the inactivity/cost brakes — the "don't trigger if nothing's happening"
  case, and the hard minimum interval.
- **Stop** ends the living doc's pulse (sets `status: retired`), notifies the owner
  (in-app + email via the existing notify path), and may `freeze` a final snapshot. "Good
  enough" = a tracked `metric.*` crossing a threshold the pulse maintains.

## 6. AI-authored configuration

A `living-author` prompt (sibling of `notebook-plan`/`notebook-distribute`) takes the
user's description ("follow these 5 stocks daily, note why they moved, make charts later")
+ the owner's offer catalogue + workspace structure, and emits a **charter + template**
(both YAML and readable). The user edits freely afterward. This is the "living document
configuration." Re-running the author on an existing config = a proposed migration (gated).

## 7. Live view, timeline, personalized snapshot

- **Live view** — render the latest active document as markdown (new viewer component,
  workspace-backed so it can reuse the workspace doc viewer plumbing).
- **Timeline** — a global scrubber (config + all slots) and a **per-section** scrubber
  (that slot's `.version.N`); read any older version; drill into sections; see the ledger
  inline.
- **Personalized snapshot** — pick, per section, which version to include → compose a
  custom combination → **freeze** to a static markdown document in the normal
  document-space (a plain, non-living doc the user owns/shares independently).

## 8. Template collection & marketplace (contract + billing) — DEFERRED (needs organisations)

> **Deferred:** sharing and billing happen **only through organisations**, which don't exist
> yet. Build the personal template collection + management + deploy now (Phase 0); the
> shareable/billable marketplace is Phase 6, after organisations. The schema hooks in §3.5
> (`visibility`, `billing`, `templateId` linkage) keep this additive.

- Living-document **templates** (charter + template skeleton, *no* content) are collected
  into a shareable collection (a catalogue, knowledge-package-style) and can be installed
  into any workspace.
- A template's `charter.agents` + `charter.billing` make it a **contract**: it names which
  offers fill which slots, what they produce/store, the cadence, and the billing model.
- When **another owner** instantiates the template, their pulse's gather step invokes the
  **template author's** offers (cross-owner). The existing offer economy debits the caller
  and credits the provider in morsels per invocation — so the author earns each time a
  subscriber's pulse runs (e.g. "today's news as images, per region").
- **Caveat (design risk, see §11):** today's cross-owner billing path is `POST
  /v1/agents/:name/offers/:offerId/invoke` for **callable** offers (sync, debit/credit
  built in). The fleet's research/image offers are currently **async task-runner** offers,
  which are *not* callable cross-owner with billing. Marketplace billing therefore needs
  either (a) callable wrappers for those offers, or (b) a new cross-owner task+escrow flow.
  This is the single biggest new mechanism and is isolated to the final phase.

## 9. Worked examples

1. **Workspace status doc** — `triggers: [{activity, changed_gte:10},{activity,
   changed_gte:1, since_last_pulse_h_gte:24}]`, guard `no_workspace_activity_for_h`.
   Auto-summarizes "what changed in this workspace" with no manual trigger.
2. **Stock tracker** — daily `schedule` + event triggers; `prices` is an `aggregate` slot
   (table now, chart later from accumulated source records); `moves` is `derived` from
   `web-researcher`; `stop` when a ticker delists.
3. **Technology tracker** — evolution / pricing / availability; `stop` "when it gets good
   enough" (`metric.maturity >= 0.9`) → notify + freeze.
4. **Regional news-as-images (shared template)** — author publishes a template whose slots
   are filled by the author's news + image agents; subscribers in other regions install it;
   their pulses call the author's agents → author earns morsels per pulse.

## 10. Mapping to existing AIMEAT (buildability)

- **Pulse** = a Workflow (schedule/event triggers, async dispatch, signals, retries,
  notify-on-finish — all built). Charter triggers compile to a workflow def.
- **Gather** = the notebook `delegate` (offers/agents) + `librarian_assess` steps.
- **Restructure / split** = the `distribute` mechanism applied to a slot.
- **Trust** = the `notebook.settings` pattern, split per action (derive/curate/restructure).
- **History/viewer** = workspace `versioned` objects + the workspace viewer.
- **Billing** = the offer/morsel economy (`offers/:id/invoke` + receipts).
- **AI authoring/derive** = new prompts in the `notebook-*`/`prompt-defaults` family.

## 11. Open questions / risks

- **Cross-owner async billing** (§8 caveat) — the key new mechanism for the marketplace.
- **"Genuinely new" dedup** — content-hash + semantic similarity, else `src` sets bloat.
- **Cost control** — prefer event/activity triggers over polling; `cadence_floor`,
  workflow `costCapMorsels`, AI daily budget; only re-derive *dirty* slots.
- **Contradiction handling** — new source vs active source: disable + log + (gated) surface.
- **Human vs pulse edits** — `manual` slots sacred; derived slots = pulse proposes / human
  disposes in gated mode.
- **Recursion governance** — enforce the charter's depth/subslot/total caps + spawn
  threshold every cycle.
- **Snapshot fidelity** — frozen copies must inline content (no live refs) so they stay static.

## 12. Phased plan

Each phase is independently shippable with its own E2E + browser verification.

- **Phase 0 — Templates, deploy & render (no pulse).** `schema:living-document@1`; the
  profile **Living Documents** tab; **personal template collection** (create/edit/delete a
  template by hand — charter + template/slots); **deploy** a template into a workspace
  (copies config, registers the instance); markdown renderer that assembles slots from
  sources/derivations; manual "add source" + "re-derive slot" actions. Proves
  template → deploy → assemble → render end-to-end.
- **Phase 1 — AI authoring + readable charter.** YAML⇄readable charter; `living-author`
  prompt (need → charter+template) to create templates fast; hand-edit remains.
- **Phase 2 — Pulse engine + manual trigger.** The core self-update loop per slot: gather
  (delegate to the slot's agent / librarian) → new sources → AI re-derive → versioned
  derivation + ledger + `cost`/`last_pulse`. Triggered by a **"Pulse now"** button
  (client-orchestrated, reusing the proven notebook delegate/AI/librarian pipeline). This
  delivers the full loop + "feel" immediately. **Unattended scheduling moved to Phase 3**
  (the scheduler core-handler + cadence) — that's where the trigger/guard/stop logic lives,
  and where a server-side pulse runner shares this same gather/derive contract.
- **Phase 3 — Triggers, guards, stop/notify + monitoring.** Activity + composite + event
  triggers; inactivity/cadence guards; stop conditions → retire + notify + optional freeze;
  the Living Documents tab shows cross-workspace **status + cost** and a **pause** control.
  (Examples §9.1–§9.3 work end-to-end here.)
- **Phase 4 — Recursion + curation + aggregate.** `composite` slots + split + recursion
  governor; decay; contradiction handling; `aggregate` slots (table).
- **Phase 5 — Live viewer + timeline + snapshots.** Global + per-section timeline; drill-in;
  personalized per-section version combination → frozen static doc in document-space
  (`aggregate` charts may land here too).
- **Phase 6 — Marketplace + cross-owner billing. DEFERRED until organisations.** Shareable
  template collection (org-scoped); template-as-contract; cross-owner agent invocation with
  morsel billing (resolve the §8 caveat). Enables the §9.4 income example.

## 13. Verification (per phase)
- E2E: new `e2e-living-*` suites for the routes/services each phase adds (contract +
  failure modes), mirroring `e2e-notebook-plan`.
- Browser (Playwright MCP): drive the real flows on the dev server (`jounimiikki`), incl.
  a real pulse cycle and a real cross-owner billed pulse in Phase 6.
- Gates: lint / typecheck / typecheck:frontend / check:importmap; openapi + i18n in sync.
