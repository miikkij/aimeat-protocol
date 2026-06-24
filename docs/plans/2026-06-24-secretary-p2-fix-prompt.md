# Secretary P2 — capability corners (§21) + finish §22 routing — handoff prompt

Two parts: (1) a framing line to set expectations, (2) the self-contained task prompt. Source audit:
`docs/plans/2026-06-24-secretary-gap-closure.md`. Design ref: `docs/plans/2026-06-23-secretary-feature.md` §21, §22.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Before touching anything, read `CLAUDE.md` in full and follow every MANDATORY
> RULE exactly — especially Rule 1 (E2E on SQLite, happy path + ≥1 failure mode, 0 failures in suites you ran), Rule 1b
> (verify finished frontend by driving the real browser via the Playwright MCP, never the `.spec.ts` suite), Rule 2
> (file headers), Rule 4 (i18n en+fi together), Rule 7 (lint + typecheck + typecheck:frontend + check:importmap all
> green), Rule 8 (frontend styling: no inline styles, theme vars, existing button/component classes), and Rule 9
> (never add known-gaps yourself). Work in small verified steps. Never claim anything works without showing the
> test/browser evidence. Do not invent APIs — grep and confirm every endpoint/field/function you call actually exists.
> Do exactly the P2 items below, nothing more, and report what you actually observed.

---

## PART 2 — the task prompt

### Mission
In AIMEAT the per-user **Secretary** is an AI agent. Its core (identity, multi-context, hire→brain→self-organism,
bands + stop-spending, chat, resource finder, teach, save-note, Ask cards, guided playbooks, autonomous tick, learning
loop) is already built. The vision said the Secretary checks what's "available **or creatable**" and is the
custodian / gatekeeper / crew-organizer — but five capability corners named in the design were never built. Add them.
They are capability + brain additions on existing ungated/owner-auth routes — **no new architecture**. Do ONLY P2-A…P2-E.

### Repo orientation (verify each path before relying on it)
- Run dev server: from repo root `pnpm dev` (port 40050); restart after backend OR `public/*` changes. Dev login:
  `happyadmin` / `Zorlox0x#`. Browser-verify via the Playwright MCP.
- Frontend Secretary: `aimeat/public/views/secretary.js` (state/logic/layout) + `aimeat/public/views/secretary/cards.js`
  (pure presentational cards) + hooks `use-autonomy.js`, `use-learning.js`, `use-guided-plan.js`. Helpers:
  `aimeat/public/js/services/secretary-helpers.js` (note `suggestContextId` — the cheap context-router already used by
  the Phase-2 *suggest* path). Policy taxonomy: `aimeat/public/js/services/secretary-policy.js`.
- The resource finder is `doFind` in `secretary.js` → `GET /v1/discover` → rendered by `findCard` in `cards.js`.
- Ask/decision-card rails (reuse for any Draft/Ask action): `askDecision` / `applyDecision` in `secretary.js` post an
  agent-message with `metadata.prompt` `{ prompt_id, question, options[], allow_other }` to the owner inbox (rendered by
  the inbox `OptionPrompt`), stash the pending action in `secretary.config.pendingDecisions`, owner answers, Secretary
  applies. Guided-plan pattern: `use-guided-plan.js`.
- Backend tick (for P2-E auto-routing): `aimeat/src/services/scheduler.ts` → `executeSecretaryJob`. Owner-key AI:
  `completeForOwner(storage, config, ownerGhii, { prompt, systemPrompt?, model?, appId })` → `{ content, usage, ... }`.
- Routes you'll likely call (GREP + confirm exact paths/shapes first): capabilities (`/v1/capabilities`, create is
  ungated), knowledge (`/v1/knowledge` — `knowledge_contribute`/`_get`/`_links`), sharing groups + consent grants
  (`/v1/consent`, sharing-group routes), agents + device-authorization (`/v1/agents`, `/v1/agents/device-authorize` and
  the owner-approval path; see `public/views/profile/agents-tab.js` for the existing approve UX).
- Data: `secretary.config` = `{ contexts:[{ id, name, brain:{purpose,rules}, organismId, organismName, workspaces,
  policy:{stopSpending, dailyMorselBudget, bands} }], activeContextId, pendingDecisions }`. Feed `secretary.feed`
  `{items:[{id,ts,contextId,contextName,kind,text}]}`. Goals `secretary.goal.{id}`.
- Tests: `aimeat/test/e2e-secretary.ts`; run `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx
  test/run-e2e-ci.ts --test=secretary`. The E2E owner has NO OpenRouter key — assert deterministic logic in E2E (records
  written, routing decisions, pending cards), verify the live-AI paths in the browser. The E2E runner forces
  `AIMEAT_EE_DISABLED=true`.

### What to build (all five)

**P2-A — Create, don't just find.** When `doFind` returns ZERO results for a goal/query, surface a guided-playbook path
to **create** the missing piece — start with a capability (`/v1/capabilities` create; confirm it's ungated) and/or a
workflow. Gate the creation behind Draft/Ask (reuse the Ask-card rails). **Acceptance:** browser — an empty discover
result shows a "create it?" affordance that, on approve, scaffolds a capability and shows it; E2E — the create path
writes the expected record.

**P2-B — Knowledge custodian.** Add a Draft-band action for the Secretary to contribute/curate the user's knowledge
base on their behalf (`knowledge_contribute`/`_get`/`_links`) — e.g. promote a refined note or a reviewed decision into
shareable knowledge. Read is open; contributing defaults to Draft (approve first). **Acceptance:** browser — Secretary
drafts a knowledge contribution; on approve it lands in the knowledge graph and is discoverable via `aimeat_discover`.

**P2-C — Access gatekeeper.** A surface for the Secretary to help manage the user's OWN sharing groups + consent grants
(Draft/Ask). Personal admin only — do not touch org/`consent:manage` Enterprise scope. **Acceptance:** browser —
Secretary proposes a consent/sharing change; on approve it applies and is reflected by the consent API.

**P2-D — Crew setup.** A guided playbook to connect/configure the user's OTHER agents — walk the device-auth approval of
a pending agent and set its directives/mode/tags. (This is the on-ramp to future specialist agents.) **Acceptance:**
browser — the playbook walks approving a pending agent and setting its mode/tags; the agent appears configured.

**P2-E — §22 Phase-4 auto-routing + corrections-teach.** In the tick / any intake path, classify each incoming item
across ALL contexts (reuse `suggestContextId` cheap-first → a light LLM classify only on ambiguity) →
**high-confidence auto-route** into the right context, **low-confidence → Ask card**. Record user **corrections** (when
the user moves an item from context A to B) as a routing signal that biases future cheap-routing. **Acceptance:** E2E —
an item clearly matching a non-active context auto-routes there; an ambiguous one yields an Ask card; a recorded
correction changes a later cheap-route decision.

### Acceptance — not done until all pass AND you show the evidence
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm check:importmap` all green.
- Targeted E2E green (extend `e2e-secretary.ts`): each new capability has a happy path + ≥1 failure mode; don't assert
  live AI output in E2E.
- Browser verification (Rule 1b) on the dev server for each of P2-A…P2-E that has UI; report exactly what you observed
  (screenshot if useful). If you can't drive the browser, say so — don't claim it works.
- New strings in BOTH `aimeat/locales/en.json` + `fi.json` (matching keys). Headers on touched files. OpenAPI synced for
  any new route.

### Gotchas
- Long AI calls from the SPA MUST use `api(path, { method, body, timeoutMs: 1_800_000, retries: 0 })`, never `apiPost`.
- New server-data surfaces must subscribe to the `aimeat-live-update` window event and re-fetch.
- `GET /v1/memory?prefix=...` can be browser-cached — cache-bust when you need a fresh read right after a write.
- `secretary.js` is near the file-length lint limit — put new logic in hooks/helpers + presentational functions in
  `cards.js`, not inline.
- Backend is protocol-only: no SSR, no per-service backend files. Don't touch the Enterprise `ee/` module (P2 is the
  personal Secretary). Reuse existing generic routes — if a route doesn't exist, prefer a generic one over a
  secretary-specific backend file.

Do P2-A…P2-E, verify, and report results with evidence. If anything here contradicts the code you find, trust the code
and say what differed.
