# Agent Offers — v1 implementation plan (node side)

**Created:** 2026-06-12
**Parent design:** [2026-06-12-agent-offers-surface.md](2026-06-12-agent-offers-surface.md) — the agreed
descriptor + surface. This doc is the **node/dev half** of v1 (§9.1 of the parent): storage + publish
routes, the goal-first **Do** view, mode-aware **Ask**, and the deliverable render with a provenance
footer. **No time/effort estimates.**

> **Build gate:** start once crewaimeat confirms the offer descriptor (§4 of the parent). The
> *contract→offers derivation* runs on the **agent/crew** side (crewaimeat owns it); the node just
> stores + renders what agents publish. For node-side dev + tests we seed an `agents.{name}.offers`
> record directly.

## In scope (v1) vs out (later phases)
**In:** offers storage + publish/read routes + Zod validation; `GET /v1/offers` owner aggregate (the
Do feed) with agent `mode`/availability attached; the **Do** view (goal-first search → agent cards →
offer detail); mode-aware **Ask** (Run vs Copy-prompt); a minimal deliverable view with the provenance
footer; i18n + OpenAPI + E2E.
**Out (do NOT build in v1):** the Inbox/deliverables feed, ratings → reputation, LLM-generated offers,
the `services → offers` migration, live consequence-chain from task events, the full trust-badge set
(v1 shows `verification` + `availability` only; cost/latency render if present, no live reputation).

---

## A. Backend

### A1. Offer descriptor validation — new file `aimeat/src/models/offer-schemas.ts`
Zod schema mirroring parent §4. Export `OfferSchema` + `OffersDocSchema = { version, updatedAt, offers: OfferSchema[] }`.
Enums: `cost ∈ {free,cheap,expensive}`, `latency ∈ {seconds,minutes,long-running}`,
`repeatability ∈ {idempotent,accumulative,destructive}`,
`verification ∈ {deterministic,gated,ungated}` (deterministic = no LLM in the I/O path, strongest),
`dataHandling ∈ {local-only,llm-provider,third-party}` (where input data flows — commercially required),
`deliverable.format ∈ {document,record,board-post,file,app}`.
`requirements[]` = `{ need, fix? , instruction? }` (one of `fix` chip-id OR `instruction` text).
`consequences[]` = `{ type ∈ {creates-agent,creates-schedule,mutates-host,publishes-public,external-send,mutates-live-app,delegates-to-agent}, persistent?, requiresApproval?, dynamic?, ratesThirdParties?, allowlist?, note? }`.
`availability` = `{ boundToLastSeen?, scheduleBorn? (string | { scheduleId, human }) }`.
`tags[]`, `sample` (string | object | the literal `"untested"`). Cap array sizes + string lengths
(e.g. ≤40 offers, ask ≤500, sample ≤8k). File header per Rule 2.

### A2. Routes — extend `aimeat/src/routes/agents.ts`
Storage is memory key `agents.{name}.offers` (no new table). Use `resolveIdentity()` + the owner
bare-name conventions already in this file.

- `PUT /v1/agents/:name/offers` — `requireAuth, requireRole('agent')`. The agent publishes its OWN
  offers (resolveIdentity → must match `:name`), or the OWNER publishes for one of their agents.
  Validate body with `OffersDocSchema`; on success `storage.setMemory({ key:`agents.${name}.offers`,
  ownerGaii: <agent GAII>, value, visibility:'owner', ttlHours:null, version, ... })`. Reject invalid
  with `error('INVALID_OFFERS', zodErrors)`.
- `GET /v1/agents/:name/offers` — read one agent's offers (member/owner visible). Returns the doc or `{ offers: [] }`.
- `GET /v1/offers` — **owner aggregate (the Do feed).** `requireAuth, requireRole('owner')`. For each of
  the owner's agents (`storage.getAgentsByOwner`), read `agents.{name}.offers`, and attach per-agent
  runtime context the cards need: `{ agent: name, mode, lastSeen, online: <lastSeen within 10m or
  webhook>, offers: [...] }`. Owner-session aggregation pattern (see CLAUDE.md "Owner Sessions —
  Aggregation"). Flatten to one searchable list client-side.

Bump the agents.ts file header version-history (Rule 2). All routes generic/JSON (no SSR).

### A3. OpenAPI (Rule 3)
Add `PUT/GET /v1/agents/{name}/offers` and `GET /v1/offers` to `openapi.yaml`; `pnpm generate:types`.

### A4. E2E (Rule 1) — new `aimeat/test/e2e-agent-offers.ts`, register in `run-e2e-ci.ts`
Happy path + ≥1 failure mode: publish valid offers (200) → `GET /v1/agents/:name/offers` returns them
→ `GET /v1/offers` aggregates them with `mode` attached; publish INVALID offers → 400
`INVALID_OFFERS`; a non-owner agent cannot publish another agent's offers → 403. (Owner token satisfies
`requireRole('agent')`, as the existing suites do.) Run on SQLite.

## B. Frontend (follow `docs/frontend-development-guide.md`, Rule 7)

### B1. Service — new `aimeat/public/js/services/offers.js`
- `listOffers()` → `GET /v1/offers` (the Do feed).
- `getAgentOffers(name)` → `GET /v1/agents/:name/offers`.
- `publishOffers(name, doc)` → `PUT …/offers` (used later by the publish UI; v1 read-mostly).
- `ask(agentEntry, offer, inputs)` — **mode-aware**, the heart of v1. Branch order: schedule-born first
  (independent of mode), then by mode:
  - `offer.availability.scheduleBorn` set → `POST /v1/schedules/:scheduleId/trigger` (run the schedule
    now). NOT a new task. Returns `{ triggered: true }`.
  - `mode ∈ {task-runner, autonomous}` → `POST /v1/agents/:name/tasks` (existing route) with a title +
    description composed from `offer.title` + `offer.ask` + the user's `inputs`/`example`. Returns the
    task id (→ deliverable view).
  - `mode ∈ {interactive, workstation}` → build the paste-ready prompt client-side from
    `offer.ask`+`example`+inputs and `copyToClipboard()` (no server call). Returns `{ copied: true }`.
- `buildAskPrompt(agent, offer, inputs)` — the prompt composer (interactive path).
- (Phase-2 note) Inbox ratings call the **locked** `POST /v1/agents/:name/tasks/:id/rate` →
  `agents.<agent>.statistics.*`. NOT a new ratings store. Out of v1.

### B2. View — new `aimeat/public/views/profile/offers-tab.js` (the Do surface)
Prefix CSS `of-`. New `aimeat/public/css/views/offers.css`; add the module to the importmap in
`public/spa.html`; register the tab in the profile view; add the `aimeat-live-update` listener
(CLAUDE.md SSE rule). Three layers:
1. **Goal-first search bar** (reuse `/components/SearchBar.js`) filtering the flattened offer list by
   `title`/`ask`/`tags`; show badges: `cost`, `latency`, `verification`, and an availability dot from
   `online`.
2. **Agent cards** — name + one-liner; offers as rows.
3. **Offer detail** — `ask` + `example` + requirements (chips) + consequences (typed badges; a confirm
   modal — reuse `useConfirm` — when any consequence is `persistent`/`requiresApproval`/external) +
   deliverable **sample rendered** (reuse the workspace record/document renderer; respect
   `sample === "untested"` → an "untested" badge) + the **Ask** button labelled `▶ Run` (task modes)
   or `⧉ Copy prompt` (interactive modes).

### B3. Deliverable + provenance (minimal, v1)
After a Run, show the task status + deliverable via the existing agents-tasks rendering, wrapped in a
small **provenance footer** component: `{ agent · task id · timestamp · verification result · location
(space/visibility) }`. **Failures render as failures** (explicit error state, never blank). The full
cross-agent Inbox + rating is phase 2 — v1 just shows the single deliverable for the ask you just made.

### B4. i18n (Rule 4) — `locales/en.json` + `locales/fi.json` together
Keys under `profile.offers.*`: the tab title, search placeholder, the badges (cost/latency/verification
labels), `run`/`copyPrompt`/`copied`, `untested`, requirement/consequence labels, the confirm copy,
and the provenance-footer labels. Add to BOTH files.

## C. Verification (per CLAUDE.md)
- `pnpm typecheck` + `pnpm lint` (0 errors).
- E2E: `…--test=agent-offers` (+ `--test=agent-tasks` since Ask uses the task route) on SQLite.
- Rule 1b: drive the browser via Playwright MCP — seed an `agents.{name}.offers` record, open
  `/v1/profile#offers`, confirm the goal-first search + offer detail render, click **Run** on a
  task-runner agent and **Copy prompt** on an interactive one, and confirm the deliverable + provenance
  footer appears.

## D. Dependencies / hand-offs
- **crewaimeat (blocking):** confirm the descriptor (parent §4); provide the contract→offers derivation
  on the agents so real offers exist (v1 node tests use a seeded record meanwhile).
- **Shared:** the offer descriptor (parent §4) is the contract — the Zod schema in A1 must stay in sync
  with it. If the descriptor changes, change the parent doc + A1 together.

## E. Definition of done (v1)
An owner with mixed-mode agents opens the Offers tab, searches "what do you want to do," sees offers
with cost/latency/verification/availability, opens one, **Runs** it (task-runner) or **Copies the
prompt** (interactive), and sees the resulting deliverable with a provenance footer — without clicking
through individual agents/tabs. Inbox, rating, reputation, LLM-generated offers, and the services
migration are explicitly deferred to later phases.
