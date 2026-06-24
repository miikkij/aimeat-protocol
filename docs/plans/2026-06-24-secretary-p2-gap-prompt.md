# Secretary P2 — gap-closure (post-audit) — handoff prompt

P2 (capability corners + §22 routing) was built and is mostly solid: gates green, E2E 38/38 (independently
re-run), consent/crew/knowledge/create surfaces work, and the interactive note-intake auto-router + corrections-teach
work. This prompt closes the **residual gaps an independent audit found**. Two parts: (1) framing line, (2) the task.

Audit verdict (verified in code + by re-running gates/E2E on 2026-06-24):
- ✅ P2-C (consent grant/revoke + sharing groups), P2-D (crew: approve device-auth + set mode/tags) — complete.
- ✅ P2-E *interactive* path — a note is classified across all contexts, a high-confidence non-active match auto-routes
  into that context's organism, low-confidence falls back to an Ask card, and corrections are recorded + bias future
  routing (`use-intake.js` + `secretary-routing.js`).
- ⚠️ **G1 — P2-E is NOT wired into the autonomous tick.** The §22 design requires auto-routing in the AUTONOMOUS path
  ("no present user picked a hat"). The routing helpers exist in `src/services/secretary-tick.ts` (`scoreContexts`/
  `routeAcross`/`recordCorrection`-style fns, v0.2.0) but `executeSecretaryJob` never calls them — confirmed: no
  routing reference in `scheduler.ts`. The tick still operates only on the active context.
- ⚠️ **G2 — P2-A "create a capability" only works for operators.** `POST /v1/capabilities` requires
  `requireRole('owner')` AND is governed by `config.capabilityPublishing` (default `'disabled'`); operators (e.g. the
  first owner) bypass the publishing gate, but a NORMAL owner on a default node hits the gate → the "Create what's
  missing" approve throws an error toast. The affordance is shown to everyone but only succeeds for operators.
- ◑ **G3 — P2-B is import-only, not curate/link.** Used owner-callable `POST /v1/knowledge/import` (good — the
  agent-only `knowledge_contribute` can't be called from the owner SPA), package lands + is discoverable. But §21's
  "custodian" also named `_links` (curating the knowledge GRAPH); linking is not done.
- ◴ **G4 — cosmetic:** a benign console 404 on first load (`GET /v1/memory/secretary.routing.corrections` before any
  correction exists; the hook catches it and defaults to `{}`).

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Read `CLAUDE.md` in full first and follow every MANDATORY RULE exactly — Rule 1
> (E2E SQLite, happy + ≥1 failure mode, 0 failures in suites you ran), Rule 1b (verify finished frontend by driving the
> real browser via the Playwright MCP, never `.spec.ts`), Rule 2 (headers), Rule 4 (i18n en+fi together), Rule 7
> (lint/typecheck/typecheck:frontend/check:importmap green), Rule 9 (never add known-gaps yourself). Work in small
> verified steps; never claim anything works without showing test/browser evidence; grep and confirm every endpoint/
> field/function before calling it. Do exactly G1…G4 below, nothing more, and report what you actually observed.

---

## PART 2 — the task prompt

### Mission
P2 of the AIMEAT **Secretary** is built; an audit found four residual gaps. Close them. G1 is the real feature gap
(finish §22 by auto-routing in the autonomous tick); G2 makes "create what's missing" work for normal users (not just
operators); G3 is an optional curation upgrade; G4 is cosmetic.

### Repo orientation (verify each path before relying on it)
- Run dev server: `pnpm dev` (port 40050); restart after backend OR `public/*` changes. Dev login: `happyadmin` /
  `Zorlox0x#`. Browser-verify via the Playwright MCP. Run the suite:
  `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary`. The E2E
  owner has NO OpenRouter key (so `completeForOwner` throws there) — assert deterministic logic in E2E, verify live-AI
  paths in the browser. The runner forces `AIMEAT_EE_DISABLED=true`.
- Autonomous tick: `aimeat/src/services/scheduler.ts` → `executeSecretaryJob` (loads `secretary.config`, picks the
  ACTIVE context, runs the action loop). Pure routing/guard helpers (already written, NOT yet called by the tick):
  `aimeat/src/services/secretary-tick.ts` — the cross-context routing fns added in its v0.2.0 (`scoreContexts` +
  `routeAcross` + the correction-learning fn; read the file for exact names/signatures) + the `RoutingCorrections`
  type. The frontend mirror is `aimeat/public/js/services/secretary-routing.js` (`routeIntake` / `learnCorrection`);
  keep the two in lockstep.
- Interactive intake (the working P2-E reference to mirror): `aimeat/public/views/secretary/use-intake.js`
  (`route` via `routeIntake`, `autoRouteNote`, `recordCorrection`, corrections persisted at owner memory
  `secretary.routing.corrections` = `{ map: { word: contextId } }`).
- P2-A create: `aimeat/public/views/secretary/use-create-resource.js` (`approve` → `POST /v1/capabilities`,
  `visibility:'private'`). Gate: `aimeat/src/routes/capabilities.ts` (`requireRole('owner')` + `config.capabilityPublishing`).
  Cards: `aimeat/public/views/secretary/cards-reach.js`. Operator/owner check: look at how the SPA already knows if the
  session is an operator (e.g. `window.AIMEAT.auth` / the owner record / an admin flag) — grep before assuming.
- P2-B knowledge: `aimeat/public/views/secretary/use-knowledge.js` (`POST /v1/knowledge/import`). Knowledge links API:
  `/v1/knowledge` `_links` (grep `routes/knowledge*.ts` for the link endpoint + whether it's owner-callable).
- `secretary.config` shape: `{ contexts:[{ id, name, brain, organismId, organismName, workspaces, policy:{stopSpending,
  dailyMorselBudget,bands} }], activeContextId, pendingDecisions, autonomousLedger }`. Goals `secretary.goal.{id}`,
  decisions `secretary.decision.{id}`, feed `secretary.feed`. Ask-card stored shape is camelCase
  (`metadata.prompt.promptId`); the tick posts cards directly via `storage.createMessage` (see `postSecretaryAskCard`).

### What to build

**G1 (primary) — auto-route in the autonomous tick (§22 Phase-4).** In `executeSecretaryJob`, when the tick produces a
note-filing action (the `file_intake`/note path) OR processes any incoming intake item, classify it across ALL of the
owner's contexts using the existing `secretary-tick.ts` routing helpers (cheap word-overlap, biased by the persisted
`secretary.routing.corrections`). High-confidence match to a NON-active context → file into THAT context's organism
(auto-route) and append a feed entry naming the context; low/ambiguous confidence → post an Ask card (reuse
`postSecretaryAskCard`) instead of silently filing into the active context. (No present user = auto-routing is required,
per §22.) Keep it cost-free (the routing math is pure; no extra AI call). **Acceptance:** E2E — drive `executeSecretaryJob`
(or the routing it now uses) so a tick-produced note clearly matching a non-active context lands in that context's
organism, and an ambiguous one produces an Ask card; assert the deterministic routing decision without needing the AI
key (you can unit-test the wiring like tests 23/27 do). Browser — with ≥2 contexts and an open goal whose action text
clearly belongs to the non-active context, Run-now files into the correct context. Reuse `secretary-tick.ts` — do not
duplicate the routing math.

**G2 — make P2-A work for non-operators (or degrade honestly).** Today `use-create-resource.approve` calls
`POST /v1/capabilities`, which a normal owner can't satisfy when `config.capabilityPublishing` is `'disabled'`. Pick the
right fix and document it: either (a) only show the "Create what's missing" affordance when the session can actually
create a capability (detect operator / publishing-enabled; otherwise hide it or show a clear "capability creation is
disabled on this node — ask the operator" message instead of letting Approve throw), or (b) create the missing piece via
an owner-callable artifact that doesn't need the publishing gate (e.g. file a "capability request"/draft into the
self-organism as a guided-playbook output) so a normal user gets a real outcome. **Acceptance:** E2E — the non-operator
path no longer throws an uncaught error; browser — as a non-operator owner (or with `capabilityPublishing` disabled),
the affordance either isn't offered or gives a clear, non-error outcome; as an operator it still creates the capability.

**G3 (optional) — knowledge curation/links (§21 "_links").** If the "custodian" role should curate the knowledge GRAPH
(not just import a package), add a Draft-band action to create knowledge links via the owner-callable links endpoint
(confirm it exists + is owner-callable; if not, document that import is the owner-side ceiling). **Acceptance:** E2E —
a link is created + readable; browser — Secretary drafts a link, on approve it appears in the graph. If linking has no
owner-callable path, document that and skip — don't fake it.

**G4 (cosmetic) — kill the first-load 404.** Stop the benign `GET /v1/memory/secretary.routing.corrections` 404 on first
load: seed an empty `{ map: {} }` on first write, or have the loader treat a 404 as `{}` without hitting the network
error path (it already defaults to `{}` — just avoid the console 404, e.g. by checking existence via a list/`count` or
swallowing the 404 cleanly). **Acceptance:** no console 404 for that key on a fresh owner; routing still works.

### Acceptance — not done until all pass AND you show the evidence
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm check:importmap` all green.
- `--test=secretary` E2E green (extend it for G1 + G2); each new behavior has a happy path + ≥1 failure mode; don't
  assert live AI output in E2E.
- Browser verification (Rule 1b) for G1 + G2; report exactly what you observed (screenshot if useful). If you can't
  drive the browser, say so.
- New strings in BOTH `aimeat/locales/en.json` + `fi.json`; headers on touched files; OpenAPI synced for any new route.

### Gotchas
- Reuse `secretary-tick.ts` routing helpers in the tick — do NOT re-implement the math; keep it in lockstep with the
  frontend `secretary-routing.js`.
- Long AI calls from the SPA use `api(path, {timeoutMs:1_800_000, retries:0})`, never `apiPost`.
- New server-data surfaces subscribe to `aimeat-live-update`. `GET /v1/memory?prefix=...` can be browser-cached —
  cache-bust when reading right after a write.
- `secretary.js` is near the file-length limit — keep new logic in hooks/helpers + presentational bits in cards files.
- Backend stays protocol-only (no SSR, no per-service backend file). Don't touch the Enterprise `ee/` module (P2 is the
  personal Secretary). Don't regress the existing 38/38 `e2e-secretary`.

Do G1…G4, verify, and report results with evidence. If anything here contradicts the code you find, trust the code and
say what differed.
