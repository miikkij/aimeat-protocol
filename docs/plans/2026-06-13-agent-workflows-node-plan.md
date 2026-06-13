# Agent Workflows — node implementation plan

**Created:** 2026-06-13
**Owner sign-off:** decisions agreed with Jouni this session.
**Crew spec (the contract):** dev-organism Development workspace `doc-mqbukpqskhzq`
("Agent Workflows — node-engine spec").
**Node-side plan-of-record (organism):** `doc-2g180p9`
("Agent Workflows — NODE-side development plan").
**Crew executable reference:** `src/crewaimeat/workflow_spec.py`,
`src/crewaimeat/workflow_inspector.py`, `src/crewaimeat/offers.py` (read as the executable spec).

This is the **node/dev** build plan. The repo is source of truth for code + spec; the organism is
source of truth for coordination. No time/effort estimates (owner preference).

---

## 0. Scope & ownership

**Node owns (this plan):** the workflow object + its storage (in owner memory); the deterministic
run loop + two-sided signal evaluation (incl. the node-OpenRouter `llm` leaf); offer resolution +
the assembled blueprint + per-run classification; the inspection-hook dispatch + the guaranteed
owner alert; the test-run API; owner-visible run health + stats; the schedule migration.

**Crew owns (NOT this plan):** agents publishing `success_signal` + `required_to_function` in their
offers; the `workflow-inspector` agent (auto-repair + diagnose + recommend); the `workflow_spec.py`
reference + the `laimeat-sanomat-evening` definition.

**Shared contract:** the descriptor (crew spec §2), the signal grammar (§3), the offer-signal fields
(§5), the inspection-hook context shape (§7).

---

## 1. Key architectural decisions (locked this session)

1. **Storage = owner memory, NOT new SQLite/Mongo tables.** AIMEAT's memory system is already
   flexible and multi-backend; reuse it. Key layout (owner GHII namespace):
   - `workflows.def.<id>` — one workflow descriptor.
   - `workflows.run.<id>.<runId>` — one run record (prefix-listable; retention-bounded via TTL).
   - List defs → `listMemory(owner, { prefix: 'workflows.def.' })`.
   - List a workflow's runs → `listMemory(owner, { prefix: 'workflows.run.<id>.' })`.
   - **Definitions live in the owner GHII namespace** (`<owner>@<nodeId>`) so the owner AND all
     their agents see them. Resolve the storage identity to the owner GHII on every workflow write
     (the aggregation pattern), regardless of whether the caller is the owner or an agent.

2. **The run is an ASYNC persisted state machine.** The node `agent_task` dispatch is
   fire-and-forget (`scheduler.ts` `executeAgentTaskJob` creates the task, wakes the agent,
   returns). The crew spec §4 "run loop" must therefore be implemented as a state machine advanced
   by events, never as a synchronous wait. (Detailed in §4.)

3. **Run-fail policy = partial.** A RED step fails its dependent subtree; independent branches
   finish; the run ends `partial`. Not a whole-run halt.

4. **Who can author:** owner, OR an agent holding the `workflow:write` scope. `resolveIdentity()`
   on every route; writes resolve to the owner GHII namespace (above).

5. **`llm` leaf is opt-in + consent-gated.** Runs ONLY when (a) OpenRouter is configured on the
   node AND (b) the workflow def carries an explicit owner approval flag for node-LLM use. Missing
   key / over budget ⇒ the leaf degrades to `unknown` (does not hard-fail the run). Per-workflow
   cost cap is OPTIONAL (OpenRouter already caps at the key level).

6. **Deterministic per-step retry before inspector escalation.** `retry: { max, backoff_min }` on a
   step; transient failures retry cheaply before `on_step_fail: inspect` fires the costed inspector.

7. **Generic triggers from day one:** `trigger: schedule | manual | event`.

8. **Federation kept open** (a step's agent may later live on another node) — not built, not
   designed out.

---

## 2. The descriptor (node-side TS shape)

Stored as the value of `workflows.def.<id>`. Mirrors crew spec §2, with the node additions
(`retry`, generic `trigger`, `llm.approved`). Zod-validated on write (`src/models/`).

```ts
interface WorkflowDef {
  id: string;
  title: LocalizedString;            // string | { [locale]: string }
  description: LocalizedString;      // REQUIRED
  trigger:
    | { kind: 'schedule'; cron: string; timezone?: string }
    | { kind: 'manual' }
    | { kind: 'event'; on: 'memory.write' | 'offer.ordered'; match: Record<string, string> };
  vars: WorkflowVar[];               // typed params, overridable in a test run
  steps: WorkflowStep[];
  on_step_fail: 'inspect';           // (only mode for now; extensible)
  llm?: { approved: boolean };       // owner consent to use node OpenRouter for `llm` leaves
  costCapMorsels?: number | null;    // optional per-workflow cap (OpenRouter also caps per key)
  createdBy: string;                 // GAII/GHII of the author (audit)
  createdAt: string; updatedAt: string;
}

interface WorkflowStep {
  id: string;                        // stable; marks "what happened where" per run
  agent: string | string[];         // a list = parallel fan within one step
  offer: string;                     // inherit success_signal + required_to_function from this offer
  after?: string[];                  // DAG deps; same `after` + no mutual dep = parallel
  description: LocalizedString;
  required_to_function?: Signal | 'none';  // INPUT gate (consumer-owned)
  success_signal?: Signal;                 // OUTPUT check (producer-owned); inherited from offer if omitted
  retry?: { max: number; backoff_min: number };
  timeout_min: number;
}

interface WorkflowVar { name: string; type: string; description: LocalizedString; default?: string; example?: string; }
```

`required_to_function` / `success_signal` are **inherited from the agent's offer** (§5) and may be
overridden here; the effective values are shown in the blueprint.

---

## 3. Signal evaluator — pure, deterministic-first, unit-testable

New module `src/services/workflow/signal-eval.ts`. **Pure function**, no server, no I/O except the
storage reads it is handed:

```ts
evaluateSignal(tree: Signal, ctx: {
  read: (key: string) => Promise<MemoryRecord | null>;   // bound to owner namespace
  vars: Record<string, string>;                          // {var} templating
  llm?: (key: string, ask: string) => Promise<{ ok: boolean; reason: string }> | null; // null = disabled
}): Promise<{ ok: boolean; observed: unknown }>
```

Grammar (crew spec §3), exactly as specified:
- **Leaf `deterministic`** over `key` | `key_glob`: `exists` · `nonempty` · `count_nonempty(min)` ·
  `json_valid` · `json_schema(schema)` · `json_field(path, min|equals|nonempty)`. Returns
  `(ok, observed)` — `observed` is the expected-vs-observed payload the inspector surfaces.
- **Leaf `llm`** `{ key|key_glob, ask }`: delegates to the injected `llm` fn (which wraps
  `completeForOwner`, `src/services/ai-completion.ts` — same machinery as the `ai` schedule kind).
  Bounded: one call, cached per run. `llm === null` (disabled / no consent / no key) ⇒ the leaf
  returns `{ ok: 'unknown', observed: 'llm-disabled' }` and does NOT fail the gate (degrade, not
  break).
- **Composite:** `{ all: [...] }` · `{ any: [...] }` · `{ when, then }` (evaluate `then` only when
  `when` passes; `when` false ⇒ not-applicable ⇒ passes — the cheap deterministic gate guards the
  expensive/LLM check).

**Security:** `{var}` templating must not let a var value escape the owner namespace — reject `::`
(namespace separator) and any glob that would widen past the owner's keys. The `read` fn is bound to
the owner namespace by the caller (mirror `executeAiJob`'s `ns = ... || owner`, `scheduler.ts:443`).

**Tests:** `test/unit/` (or the e2e harness) — every leaf + composite + the `when`-gate
not-applicable path + the templating-escape rejection. No server needed.

---

## 4. Workflow engine — state machine ALONGSIDE the scheduler

New service `src/services/workflow/engine.ts`. **Not** inside `scheduler.ts` — it is woken by the
scheduler/events but owns its own lifecycle.

### Run record (`workflows.run.<id>.<runId>`)
```ts
interface WorkflowRun {
  runId: string; workflowId: string;
  defSnapshot: WorkflowDef;          // pin the def AT run time (interpretable after the def changes)
  vars: Record<string, string>;      // resolved params (firing date filled in)
  mode: 'full-live' | 'full-sandbox' | 'signals-only';
  keyPrefix?: string;                // 'wf-test.<runId>.' in sandbox mode; '' otherwise
  status: 'running' | 'waiting-step' | 'red' | 'partial' | 'done';
  steps: Record<string /*stepId*/, {
    state: 'pending' | 'input-red' | 'dispatched' | 'green' | 'output-red' | 'timed-out' | 'skipped';
    attempt: number;                 // for retry
    taskIds?: string[];              // dispatched agent task ids
    inputObserved?: unknown; outputObserved?: unknown;
    reads: string[]; writes: string[];   // per-step audit (ExecutionLogEntry shape, scheduler.ts:801)
    startedAt?: string; endedAt?: string;
  }>;
  startedAt: string; endedAt?: string;
}
```

### Trigger → start
- New schedule kind **`workflow`** (extend the `job.type` switch in `scheduler.ts:285`): the
  scheduler fires, calls `engine.startRun(workflowId, { mode:'full-live' })`. This is the ONE
  schedule that replaces the per-step crons (§9 migration).
- Manual trigger: a route calls `engine.startRun(..., { mode })` directly (also the test-run path).
- Event trigger: an event-bus subscription (`onChangeEvent` for `memory.write`; an offer-order hook
  for `offer.ordered`) calls `engine.startRun(...)` when `match` is satisfied. (Phase 2 — see §11.)

### The advance loop (async, event-driven)
`startRun` and `advance` share one routine `tick(run)`:
1. Compute the ready set: steps whose `after` deps are all `green` and not yet started.
2. For each ready step: **input check** (`required_to_function`). If RED ⇒ mark `input-red`, do NOT
   dispatch, invoke `on_step_fail`, and mark the dependent subtree `skipped`.
3. Dispatch the agent task(s) for the step (a list = parallel; reuse the `executeAgentTaskJob`
   materialise+wake path, factored into a shared helper). **Tag the task with a `workflow-run`
   scope entry** `{ name:'workflow', value:runId, type:'workflow-run', description:stepId }`
   (mirrors the schedule scope, `scheduler.ts:525`) — zero schema change. Mark the step
   `dispatched`, set `taskIds`. Run goes `waiting-step`. Persist + return.
4. **On the dispatched task's terminal transition** (`done`/`failed` at `agent-tasks.ts:991`): the
   task-route calls `engine.onTaskTerminal(task)`. The engine finds the `workflow-run` scope →
   loads the run → runs the **output check** (`success_signal`):
   - GREEN ⇒ mark `green`, record `outputObserved` + reads/writes, `tick(run)` again.
   - RED ⇒ if `attempt < retry.max`: schedule a re-dispatch after `backoff_min` (a one-shot timer /
     the watchdog). Else mark `output-red`, invoke `on_step_fail`, mark the dependent subtree
     `skipped`, `tick(run)` for independent branches.
5. When no step is `pending`/`dispatched`: finalize — `done` if all green, else `partial`
   (any red/skipped). Write run-health stats (§7). Persist.

`signals-only` mode: skip step 3 (no dispatch); evaluate BOTH signals of every step against existing
memory and finalize immediately — an instant health check of a past/known run.

### Concurrency & recovery (the memory-storage caveats)
- **Per-run serialization:** advancing the same run from two task completions (parallel steps
  finishing together) is a read-modify-write race on one memory key. Serialize per `runId` with an
  in-process lock (a `Map<runId, Promise>` chain, like the scheduler's `executing` set) and use the
  memory `version` field as the optimistic backstop.
- **Run overlap:** if a run is still alive when the trigger fires again, **skip** (default; runs
  share templated keys → collision). Same posture as the scheduler's overlap guard.
- **Watchdog cron:** a core scheduler handler (registered via `registerCoreHandler`) sweeps
  `waiting-step` runs; any step past `timeout_min` ⇒ `timed-out` ⇒ retry-or-`on_step_fail`.
- **Restart recovery:** on boot, the engine lists in-flight runs (`status` in
  `running`/`waiting-step`) and either resumes (re-checks dispatched tasks' current status) or lets
  the watchdog time them out. Without this a run hangs forever (the scheduler reloads jobs in
  `start()`; the engine needs the equivalent).

---

## 5. Offer resolution + blueprint

- **Offer signals (crew side, contract):** add `success_signal?: Signal` and
  `required_to_function?: Signal` to `OfferSchema` (`src/models/offer-schemas.ts`).
  `deliverable.location` already exists. All optional ⇒ existing offers validate unchanged.
- **Resolution:** on workflow save, for each step load `agents.<agent>.offers` → the named offer →
  use its `success_signal` / `required_to_function` / `deliverable.location` as the step defaults;
  the step may override/extend.
- **Save-time validation (reject, don't defer to run):**
  - the referenced agent/offer exists and publishes its signals + `deliverable.location` (an agent
    is "workflow-compatible" exactly then);
  - the `after` graph is a DAG (cycle detection);
  - every `{var}` referenced in a signal is declared in `vars`.
- **Blueprint (derived, not authored):** `GET /v1/workflows/:id/blueprint` composes the steps into
  one structural graph — the input→output flow + the exact memory/storage keys each step touches
  (templated from the params). Frontend renders it as a graph. This is the owner-facing "whole
  workflow" view.

---

## 6. Inspection hook + guaranteed alert

- **Node guarantees the alert (deterministic, always):** on any RED, write it into the run record
  AND push to the owner via `notifyOwner` (reuse `scheduler.ts:408` — push best-effort + a
  run-health record the profile tab reads). This path does NOT depend on the inspector.
- **Inspector dispatch (best-effort enrichment):** queue a task to the crew `workflow-inspector`
  agent with the spec §7 context: `{ workflow id + defSnapshot, failing step id, its signal tree,
  per-leaf expected-vs-observed, every step's state, the failing agent + its last task status }`.
  If the inspector agent is absent/offline, the run still surfaces RED to the owner.

---

## 7. Run health + stats (the "did it produce" trend)

- Derive on read from the last N run records (prefix list) — no separate rollup needed initially:
  per-step GREEN/RED rate ("this step went RED 3/5 runs"), last-run status, last success time, mean
  duration.
- Surface via `GET /v1/workflows/:id/health` and feed node-stats.
- Per-step **reads/writes** (recorded in the run, ExecutionLogEntry shape) feed the data-wallet /
  consent audit — the run shows exactly which owner keys each step read and wrote.
- Profile tab listens for `aimeat-live-update` (SSE) and re-fetches (CLAUDE.md live-update rule).

---

## 8. Routes (generic, protocol-only — no SSR)

All under `src/routes/workflows.ts`, mounted in `server.ts`. `requireAuth()` +
`requireRole`/`requireScope('workflow:write'|'workflow:read')`. `resolveIdentity()` → owner GHII
namespace for storage.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/workflows` | list the owner's workflow defs |
| `GET` | `/v1/workflows/:id` | one def (effective signals shown) |
| `PUT` | `/v1/workflows/:id` | create/update (save-time validation §5) |
| `DELETE` | `/v1/workflows/:id` | remove def (+ optionally its runs) |
| `GET` | `/v1/workflows/:id/blueprint` | derived structural graph |
| `GET` | `/v1/workflows/:id/health` | run-health trend |
| `GET` | `/v1/workflows/:id/runs` | list runs |
| `GET` | `/v1/workflows/:id/runs/:runId` | one run (per-step state + observed) |
| `POST` | `/v1/workflows/:id/run` | manual/test run; body `{ mode, target?, vars? }` |

Test-run body: `mode: 'signals-only' | 'full'`; for `full`, `target: 'sandbox' | 'live'`
(**optional, caller's choice** — sandbox writes under `wf-test.<runId>.`, live writes the real
keys). Default `target: 'sandbox'` to be safe-by-default; the caller opts into `live`.

**Compliance:** add every route to `openapi.yaml` + `pnpm generate:types` (Rule 3). i18n keys in
`locales/en.json` + `locales/fi.json` (Rule 4). File headers on new `.ts` (Rule 2). `pnpm lint` +
`npx tsc --noEmit` clean (Rule 7).

---

## 9. Schedule migration (6 → 1, reversible)

The six per-agent Sanomat schedules (`Uutisputki – iltavähäku/iltakirjoitus/iltakirjoitus B/
ilteditoriaali`, `Iltanumeron erikoisosiot + uutisvisa`, `Avaruussää — ilta`) become ONE
`laimeat-sanomat-evening` workflow with a single `trigger.kind:'schedule'`. The step `after` order +
signals encode the staggering the cron times approximated.

**Reversible:** disable the six old schedules (`enabled:false`), do NOT delete them. The workflow's
single schedule drives the run. If the workflow misbehaves, re-enable the six and disable the
workflow schedule. Delete the old schedules only after the workflow has run clean for a while
(owner's call).

The concrete `laimeat-sanomat-evening` definition is authored crew-side (from the real stage→key
map in `workflow_spec.py`) and saved via `PUT /v1/workflows/:id`.

---

## 10. E2E (new suite, SQLite)

`test/e2e/workflow.ts` (+ register in the CI runner). Cover:
- **Happy path:** a 2–3 step workflow, all signals GREEN, run ends `done`; per-step reads/writes
  recorded.
- **input-RED:** upstream produced nothing ⇒ downstream `required_to_function` RED ⇒ not dispatched
  ⇒ `on_step_fail` fired ⇒ owner alert recorded ⇒ run `partial`.
- **output-RED:** step ran but `success_signal` RED ⇒ retry (if configured) then `output-red`.
- **timeout:** dispatched step never completes ⇒ watchdog marks `timed-out`.
- **signals-only test run:** evaluates against existing memory, no dispatch.
- **save-time rejection:** workflow referencing an offer with no signals, or a cyclic `after`, is
  rejected by `PUT`.

Run with the filter runner on SQLite:
`cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workflow`
End-of-plan: full sweep on both backends (Rule 1).

---

## 11. Phasing (dependency order, no estimates)

1. **Contract:** add `success_signal` + `required_to_function` to `OfferSchema`. (Crew can then
   publish; node can validate.)
2. **Signal evaluator** (§3) + unit tests. Pure, no engine yet.
3. **Storage + descriptor + CRUD routes** (§2, §8) with save-time validation + offer resolution
   (§5). Blueprint endpoint.
4. **Engine state machine** (§4): schedule-kind `workflow`, dispatch + `workflow-run` task scope,
   `onTaskTerminal` hook in the task route, watchdog cron, restart recovery. Run records + run/health
   endpoints (§7).
5. **Inspection hook + guaranteed alert** (§6).
6. **Test-run modes** (signals-only / full-sandbox / full-live) (§8).
7. **Migration** of the Sanomat schedules (§9).
8. **Event triggers** (`memory.write`, `offer.ordered`) (§1.7) — last, additive.
9. **Frontend:** the Workflows tab (§12) — list + blueprint graph + run-health (frontend guide +
   browser-MCP verification, Rule 1b).

---

## 12. Frontend — the Workflows tab (owner-approved placement)

**Placement (locked):** a NEW profile tab `workflows`, registered in `profile.js` TABS immediately
AFTER `scheduler` (`profile.js:77`), `minTier: 'active'`. CSS prefix `wf-` (own file
`public/css/views/profile-workflows.css` or the profile bundle). It inherits the scheduler tab's
language: `section-title`/`section-desc` header, `btn-primary` "New", card list, SSE
`aimeat-live-update` listener + a ~15s poller (`scheduler-tab.js` pattern). Scheduler and Workflows
cross-link: a scheduler card whose job is a workflow trigger shows "owned by workflow X"; the
Workflows tab is the place for the DAG + runs + health (too rich for a scheduler card).

Importmap entries for any new shared module (CLAUDE.md cache-busting rule). All strings via `t()`,
keys in en.json + fi.json (Rule 4). No inline styles; reuse `.btn-*`, badges, theme vars (Rule 7).

**Three views:**

1. **List (tab root)** — one card per workflow: localized title · trigger summary (cron / manual /
   event) · last-run status badge (green / partial / red) · health sparkline + "step X RED 3/5
   runs" · next run · actions (Run ▶, View 👁, Edit ⚙). Empty state mirrors `sch-empty`.

2. **Detail = the "whole workflow"** — the blueprint DAG (derived from offers along `after` order),
   each node showing agent + offer + last-run GREEN/RED; an expandable failing step shows its
   signal tree + reads (✓ keys) + writes (✗ expected-vs-observed) + the inspector line; below, the
   recent-runs list (date · status · failing step · open). `Run ▾` offers signals-only /
   full-sandbox / full-live.

3. **Run** — per-step timeline: state (green / input-RED / output-RED / timed-out / skipped) ·
   duration · reads/writes counts; the failing step expands to the `success_signal` expression +
   expected-vs-observed + retry outcome + links to the deliverable and the inspector report.

**Create/Edit form** — extends the scheduler create form: trigger (schedule/manual/event) + `vars`
(typed, with descriptions) + `steps` (each: agent + offer picker → effective signals shown from the
offer, overridable; `after`; `retry`; `timeout_min`) + the `llm.approved` consent toggle (only
shown when node OpenRouter is configured). Save hits `PUT /v1/workflows/:id`; save-time validation
errors (§5) render inline.

Mockups for all three views: see this session's design discussion (list card, blueprint graph, run
timeline). Verify by driving the browser via Playwright MCP when the tab is done (Rule 1b).

---

## 13. Open / deferred (NOT gaps to file — discuss with owner before acting)

- **full-sandbox test mode** (Phase 4 deferred): only `signals-only` + `full-live` shipped. True
  sandboxing of a full run needs the agent/offer to honor a `wf-test.<runId>.` key prefix, which the
  node can't force. keyPrefix plumbing is in the run record for when offers opt in.
- **json_schema value-validation** (Phase 4 deferred): the `json_schema` leaf currently degrades to
  `json_valid` (the evaluator's documented fallback). Wire ajv value-validation into the engine's
  eval ctx to enforce the schema.
- Federation: cross-node `agent_task` for a step on another node — future.
- `on_step_fail` modes beyond `inspect` (e.g. `skip`, `abort`) — only `inspect` for now.
- Run-record retention policy (TTL vs prune-to-last-N) — pick when run volume is known.
- A rolled-up `workflows.health.<id>` key if derive-on-read gets expensive — defer until measured.
