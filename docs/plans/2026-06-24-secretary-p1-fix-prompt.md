# Secretary P1 fix — handoff prompt for a fresh Claude Code session

Two parts: (1) a short framing line to set expectations, (2) the self-contained task prompt.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Before touching anything, read `CLAUDE.md` in full and follow every
> MANDATORY RULE exactly — especially Rule 1 (E2E on SQLite, happy path + ≥1 failure mode, 0 failures in suites you
> ran), Rule 1b (verify finished frontend by driving the real browser via the Playwright MCP, never the `.spec.ts`
> suite), Rule 2 (file headers), Rule 4 (i18n en+fi together), Rule 7 (lint+typecheck+typecheck:frontend+check:importmap
> all green), and Rule 9 (never add known-gaps yourself). Work in small verified steps. **Never claim anything works
> without showing the test/browser evidence.** If a design detail is ambiguous, re-read the referenced code before
> guessing. Do not invent APIs — grep and confirm every endpoint/field/function you call actually exists. The task is
> below; do exactly P1-A…P1-D, nothing more, and report what you actually observed.

---

## PART 2 — the task prompt

### Mission

In AIMEAT, the per-user **Secretary** is an AI agent. Its **autonomous tick** (a `secretary`-kind scheduled job) was
built as a shell that only writes a free-text "briefing" to a Home feed. It does **not** load the user's goals, does
**not** look at the self-organism, does **not** turn the model's output into routed actions, has **no** cheap
idle-skip, and its **daily spend budget is a dead field** that is never enforced. Your job (P1) is to turn the tick
into a real, cost-safe action loop. Do **only** the four items P1-A…P1-D below.

### Repo orientation (verify each path before relying on it)

- Run dev server: from repo root `pnpm dev` (port 40050). Restart it after backend **or** public/* changes (the SPA
  cache-busts by a BUILD_ID set at boot). Dev login: `happyadmin` / `Zorlox0x#`.
- Backend tick: `aimeat/src/services/scheduler.ts` → method `executeSecretaryJob` (and helpers `appendFeed`,
  `reviewOpenDecisions`). The hard stop-spending guard already lives at the top of `executeSecretaryJob` (keep it).
- Scheduler constraints: `aimeat/src/services/schedule-constraints.ts` (`evaluateConstraints` / `applyAfterRun`,
  `knownConstraintTypes`). NOTE: it currently early-returns `{allow:true}` for any job kind that isn't `'ai'` — so the
  `secretary` kind is unconstrained today.
- Owner-key AI: `completeForOwner(storage, config, ownerGhii, { prompt, systemPrompt?, model?, appId })` in
  `aimeat/src/services/ai-completion.ts` — returns `{ content, usage, ... }`; runs server-side, no JWT. The tick is
  already wired to it.
- Frontend Secretary view: `aimeat/public/views/secretary.js` (state/logic/layout) + `aimeat/public/views/secretary/cards.js`
  (pure presentational cards) + hooks `use-autonomy.js` (the tick controls + feed), `use-learning.js` (goals +
  decisions), `use-guided-plan.js`. Policy taxonomy: `aimeat/public/js/services/secretary-policy.js`
  (`SECRETARY_CAPABILITIES` ≈ 11 caps, `BANDS` = act/draft/ask/off, `defaultPolicy`, `mergePolicy`). Helpers:
  `aimeat/public/js/services/secretary-helpers.js`.
- Data shapes (owner memory keyed by the owner GHII, e.g. `happyadmin@<node>`):
  - `secretary.config` = `{ contexts: [ { id, name, brain:{purpose, rules:[{id,description}]}, organismId, organismName,
    workspaces, policy:{ stopSpending:boolean, dailyMorselBudget:number|null, bands:{ [capId]: 'act'|'draft'|'ask'|'off' } },
    brainHistory } ], activeContextId, pendingDecisions }`.
  - Goals: `secretary.goal.{id}` = `{ id, title, why, status:'open'|'done', contextId, contextName, createdAt }`.
  - Decisions: `secretary.decision.{id}` (see `docs/specs/secretary-decision-contract.md`).
  - Feed: `secretary.feed` = `{ items:[ { id, ts, contextId, contextName, kind:'briefing'|'review'|..., text } ] }` (newest first, cap 50).
  - Ask/decision cards already exist: the Secretary posts an agent-message with `metadata.prompt`
    `{ prompt_id, question, options[], allow_other }` to the owner inbox (rendered by the inbox `OptionPrompt`), and
    stashes the pending action in `secretary.config.pendingDecisions`; the owner answers; the Secretary applies it.
    Study `askDecision` / `applyDecision` in `secretary.js` and the Phase-3b rails before reusing them.
- Tests: `aimeat/test/e2e-secretary.ts`. Run one suite: `cd aimeat && pnpm exec node --env-file=.env.test.sqlite
  --import tsx test/run-e2e-ci.ts --test=secretary`. IMPORTANT: the E2E test owner has **no OpenRouter key**, so
  `completeForOwner` throws there — you **cannot** assert the happy AI path in E2E. Assert the deterministic parts in
  E2E (idle-skip, budget-skip reasons, that an Ask card / pending decision record is written, band routing decisions on
  a stubbed/empty result) and verify the **real AI path in the browser** on the dev server (which has a working model;
  use Run-now). The E2E runner forces `AIMEAT_EE_DISABLED=true`.

### What to build (do all four)

**P1-A — Tick action loop.** Rework `executeSecretaryJob` so each working tick:
1. loads the active context's **open goals** (`storage.listMemory(owner, { prefix: 'secretary.goal.' })`, keep
   `status==='open'`), and a **cheap slice of the self-organism** (the context's `organismId` + a small number of recent
   workspace records / objectives — keep it bounded, don't dump everything);
2. asks the model (via `completeForOwner`) for a **structured action list** — JSON like
   `[{ capability, summary, payload }]` where `capability` is one of the policy's capability ids — not prose. Parse it
   defensively (tolerate fences/prose around the JSON; on parse failure, fall back to the current short-briefing
   behavior so the tick never hard-fails);
3. **routes each proposed action through the active context's bands** (`policy.bands[capability]`, default sensibly if
   missing): `act` → perform the action and append an `act` feed entry; `draft`/`ask` → post the existing inbox card
   (reuse the Phase-3b `metadata.prompt` rails + `secretary.config.pendingDecisions`) instead of acting; `off` → drop.
   Keep appending a short human-readable briefing as a summary/fallback.
Reuse the existing `appendFeed`. Keep the existing decision-review sweep (`reviewOpenDecisions`) and the stop-spending
guard. Frontend `runTick` already uses the long-timeout `api()`.

**P1-B — Cheap "anything to do?" pre-check.** Before the paid `completeForOwner` call, run a near-zero-cost check: if
the active context has **no open goals, no due decisions, and no pending intake**, skip the paid briefing (return a
`skipped` result with a clear reason, or write at most one cheap "idle" marker per day — your call, document it). The
stop-spending hard guard stays above this.

**P1-C — Enforce `dailyMorselBudget` (the soft cost guard).** Make `policy.dailyMorselBudget` actually cap autonomous
spend. Pick ONE approach and document it in the code:
- (i) have `use-autonomy.js` `enableTick` attach a `budget`/`daily_limit` **ScheduleConstraint** derived from
  `policy.dailyMorselBudget` when it POSTs `/v1/schedules`, and make `schedule-constraints.ts` honor that constraint for
  the `secretary` kind (today it early-returns for non-`ai`); **or**
- (ii) enforce it inside `executeSecretaryJob` with a per-day spend counter persisted in `secretary.config` (read
  `result.usage` / morsels, accumulate, reset on date change, skip + push-notify once the day's cap is hit).
On trip, degrade to Ask/Draft-only (no paid actions) and push-notify the owner, matching the "auto-disable + notify"
intent. Surface remaining budget in the automation card (`cards.js` `automationCard`). The hard `stopSpending` path is
unchanged and independent.

**P1-D — Self-facing reliability label.** Compute a **reliability** number for the Secretary from the learning loop
(NOT the marketplace `trustScore`, which must stay untouched at its default): e.g. the mean `score` over reviewed
`secretary.decision.*` records, optionally combined with a "did-what-it-said" ratio (share of `act` actions that
completed). Compute it (client-side from the decision records is fine, or a small backend helper) and render a small
chip in `cards.js` `metaCard` (and/or the operating card). With no reviewed decisions yet, show "—" / "building", never
a fake number.

### Acceptance — you are NOT done until all of these pass and you've shown the evidence

- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm check:importmap` — all green (Rule 7).
- Targeted E2E green: extend `aimeat/test/e2e-secretary.ts` and run
  `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary` — cover at
  least: idle pre-check skips (no goals/decisions → no paid call), budget trip skips with the right reason, and a tick
  that produces a band-routed `ask` action writes a pending decision card. (Don't assert the live AI output in E2E.)
- Browser verification (Rule 1b) on the running dev server: log in as `happyadmin`, ensure stop-spending is OFF and a
  context has at least one open goal, click **Run now** on the Secretary automation card, and confirm a real
  band-routed outcome (a feed `act` entry and/or an inbox Ask card tied to the goal) — not just a briefing. Confirm the
  reliability chip shows a real number after a reviewed decision. Report exactly what you observed (screenshot if
  useful). If you cannot drive the browser, say so — do not claim it works.
- i18n: any new user-visible string added to **both** `aimeat/locales/en.json` and `aimeat/locales/fi.json` with the
  same key structure (Rule 4).
- File headers updated on touched files (Rule 2). OpenAPI synced if you add/modify a route (Rule 3).

### Gotchas (these have bitten before — heed them)

- Long AI calls from the SPA (`/v1/ai/complete`, Run-now trigger) MUST use the low-level `api(path, { method, body,
  timeoutMs: 1_800_000, retries: 0 })`, NEVER `apiPost` (its 30s timeout + retries aborts and re-fires slow models).
- Any new Secretary surface that shows server data must subscribe to the `aimeat-live-update` window event and re-fetch.
- The list endpoint `GET /v1/memory?prefix=...` can be browser-cached; add a cache-bust query param when you need a
  fresh read right after a write.
- `secretary.js` and `my-company.js` are near the file-length lint limit — put new logic in hooks/helpers, not inline.
- Backend is protocol-only: no SSR, no per-service backend files; the tick logic belongs in `scheduler.ts`/services,
  the UI in `public/`.
- Don't touch the Enterprise `ee/` module for this task (P1 is the personal Secretary).

Do P1-A…P1-D, verify, and report results with evidence. If something in this prompt contradicts the code you find,
trust the code and say what differed.
