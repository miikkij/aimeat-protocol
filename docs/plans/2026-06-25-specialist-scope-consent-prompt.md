# Feature — Specialist scope-consent at provisioning (declare → owner approves extras) — handoff prompt

A NEW feature (not a bug-fix). Today every AIMEAT principal that gets capability scopes has a declare-and-consent
step EXCEPT system agents: normal agents go through device-auth where the owner selects scopes
(`agent-consent.html` → `POST /v1/agents/verify`), apps declare `?scope=…` and the owner approves a subset
(`routes/app-grants.ts`), but the Secretary and specialists are locked to a fixed role profile
(`scopesForProfile(role)`) with NO owner approval. After the P5 audit the specialist role profiles were trimmed to a
conservative Community-safe baseline (least-privilege) — which is the right default but means a role can't run "at full
power" out of the box. This feature closes that gap the AIMEAT-native way: a specialist (and a use-case-template's
specialist) **declares the extra scopes it would like**, and when those exceed the conservative baseline the **owner is
shown them and consents** at provisioning — mirroring the app-grant model. This subsumes the earlier "G2" question
(no need to re-bloat the profiles; extras are requested + consented).

Two parts: (1) framing line, (2) the self-contained task.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Read `CLAUDE.md` in full first and follow every MANDATORY RULE exactly — Rule 1
> (E2E SQLite, happy + ≥1 failure mode, 0 failures), Rule 1b (verify finished frontend by driving the real browser via
> the Playwright MCP, never `.spec.ts`), Rule 2 (headers), Rule 3 (OpenAPI sync for new/changed routes), Rule 4 (i18n
> en+fi together), Rule 7 (lint/typecheck/typecheck:frontend/check:importmap green), Rule 8 (frontend styling: theme
> vars, existing component/button classes), Rule 9 (never add known-gaps yourself). Work in small verified steps; never
> claim anything works without test/browser evidence; grep and confirm every endpoint/field/function before calling it.
> Build the feature below; report what you actually observed.

---

## PART 2 — the task prompt

### Mission
Give specialist agents (and template-instantiated specialists) an app-style **declare → consent → grant** scope flow,
so a job-role can run at full capability ONLY with the owner's explicit, per-provisioning approval — while the
least-privilege conservative profile stays the default. The personal Secretary stays frictionless (no consent — it is
conservative by design); this is specialists only.

### Repo orientation (verify each path before relying on it)
- Run dev server: `pnpm dev` (port 40050); restart after backend OR `public/*` changes. Dev login: `happyadmin` /
  `Zorlox0x#`. Browser-verify via the Playwright MCP. Suites: `cd aimeat && pnpm exec node --env-file=.env.test.sqlite
  --import tsx test/run-e2e-ci.ts --test=specialists [--test=...]`.
- **Specialist scopes today (the conservative GRANTED baseline — keep it):** `src/mcp/catalog/scopes.ts`
  `MCP_SCOPE_PROFILES` (the `specialist`/`sdr`/`prep`/`finance`/`recruiter` entries, all ⊆ the `secretary` baseline
  after the P5 G1 trim) + `SPECIALIST_ROLES` + `isSpecialistRole` + `scopesForProfile(role)`. There is an E2E invariant
  in `test/e2e-specialists.ts` asserting every role ⊆ `secretary` — it must stay green (the GRANTED-by-default set
  stays conservative; the new "requested extras" are a SEPARATE declaration, not added to these profiles).
- **Provisioning today:** `routes/specialists.ts` `POST /v1/specialists` (owner-only) → `services/specialist.ts`
  `ensureSpecialist` → `services/system-agent.ts` `provisionSystemAgent` → scopes locked to `scopesForProfile(role)`.
  The POST body does NOT accept scopes today.
- **Per-agent scope edit ALREADY EXISTS (reuse, don't rebuild):** `PATCH /v1/agents/:name/scopes` (owner-only,
  `routes/agents.ts` ~1382, `storage.updateAgent(gaii, { defaultScopes })`); frontend `updateAgentScopes()` in
  `public/js/services/agents.js`.
- **The model to MIRROR — app grants:** `routes/app-grants.ts` — `APP_GRANTABLE_SCOPES` (a scope→plain-language
  description vocabulary, ~line 41), `GET /v1/app-grants/authorize?scope=…` (app declares; validated against the
  vocabulary), the consent UI, and `POST /v1/app-grants/authorize-consent` which **filters the approved set to a SUBSET
  of requested (never widens)** (~line 214-220). Copy this "never grant more than requested" rule exactly.
- **Device-auth consent UI (reference for look/flow):** `aimeat/src/static/agent-consent.html` (presets + custom
  scope checkboxes the owner approves).
- **Template path:** `services/organism-template.ts` `instantiateTemplate` provisions a template's specialists via
  `ensureSpecialist`; `TemplateJson` carries `specialists[]` + `scopePresets`. A template specialist should be able to
  declare requested extras too.
- **NOT the mechanism:** `ConsentRecord` / `routes/consent.ts` gate **memory-data access** (`dataPattern`/`recipient`),
  NOT capability scopes. Use the agent `defaultScopes` model, not consent records.

### What to build

**1. Declare the requested extras (per role + per template specialist).** Add a SEPARATE declaration of the scopes a
role would like beyond the conservative baseline — e.g. a `SPECIALIST_REQUESTED_SCOPES: Record<role, string[]>` in
`scopes.ts` (sdr → e.g. `workflow:write`, `social:read`; finance → `wallet:read`; recruiter → `social:read`; the
others → none). Keep `MCP_SCOPE_PROFILES[role]` (the granted baseline) unchanged and conservative. Compute
`requestedExtras(role) = SPECIALIST_REQUESTED_SCOPES[role] \ scopesForProfile('secretary')` (only what exceeds the
baseline needs consent). A template specialist may also declare `requestedScopes` in `template.json`.

**2. Consent at provisioning.** Extend `POST /v1/specialists` (and the template instantiate flow) so that when a role
has requested extras:
- If the request includes NO `approved_scopes`, provision with the conservative baseline AND return, in the response,
  the **requestable extras** (each with a plain-language description — reuse/extend `APP_GRANTABLE_SCOPES`, or a shared
  `SCOPE_DESCRIPTIONS` map) so the UI can present them. (Provisioning still succeeds conservatively — extras are never
  granted silently.)
- If the request includes `approved_scopes`, grant `baseline ∪ (approved_scopes ∩ requestedExtras)` — **filtered to a
  subset of the requested extras, never wider** (copy the app-grant subset filter). Store on the agent's
  `defaultScopes` (not the locked profile).
- A role with no requested extras provisions exactly as today (no consent step, no behavior change).
Validate every approved scope against the vocabulary + the requested set; reject anything outside requested with a 400.

**3. Frontend consent step.** In the specialist-create UI (find where specialists are created — likely the Agents tab
or a specialists view; grep `POST /v1/specialists` callers + `updateAgentScopes`), when the chosen role has requested
extras, show them as a checklist with descriptions ("Run automations — `workflow:write`", "See wallet balance —
`wallet:read`", …) and a clear "these go beyond the safe default" note; the owner approves a subset; submit
`approved_scopes`. No extras → no extra UI. After provisioning, the existing `PATCH /v1/agents/:name/scopes` path lets
the owner adjust later (surface an "edit scopes" affordance if it isn't already there).

**4. Template instantiate.** When `instantiateTemplate` provisions a specialist that declares `requestedScopes`, do NOT
grant the extras silently — either accept an `approved_scopes` map in the instantiate request, or report the requested
extras per specialist in the result (like the unmet-extension-deps list) so the owner can approve/grant them (via the
consent step or `PATCH`) after instantiation. Default with no approval = conservative.

### Acceptance — not done until all pass AND you show the evidence
- The P5 invariant stays green: every role in `SPECIALIST_ROLES` is still ⊆ `secretary` for the GRANTED default
  (`MCP_SCOPE_PROFILES`); requested extras live in the SEPARATE declaration, never in the default profile.
- `--test=specialists` E2E extended + green, covering: (a) a role with extras, POST without approval → conservative
  scopes + the response lists the requestable extras; (b) POST with `approved_scopes ⊆ requested` → `defaultScopes =
  baseline ∪ approved`; (c) `approved_scopes ⊄ requested` (asks for more than requested) → filtered/400, never widened;
  (d) a no-extras role → provisions unchanged, no consent surfaced; (e) template instantiate surfaces a specialist's
  requested extras without granting them silently. Don't regress `--test=secretary`, `--test=enterprise-stub`,
  `--test=organism-templates`.
- Browser (Rule 1b): create an `sdr` → the consent checklist shows the extra(s) with descriptions → approve one →
  the specialist has baseline + that scope (verify via the agent record / GET); decline → conservative; the existing
  PATCH edit still works. Report what you observed (screenshot useful).
- New strings in BOTH `aimeat/locales/en.json` + `fi.json`; file headers on touched files; **OpenAPI** updated for the
  new `POST /v1/specialists` request/response fields (`approved_scopes` in, requestable-extras out) + run
  `pnpm generate:types`.

### Gotchas
- **Never grant more than requested** — copy the app-grant subset filter (`approved ⊆ requested`); and requested itself
  is bounded by a known vocabulary (don't let a role request `*` or dev scopes).
- **Keep the default conservative** — do NOT re-add the extras to `MCP_SCOPE_PROFILES[role]` (that would undo the P5 G1
  least-privilege fix and the invariant). Extras are a separate, consent-gated declaration.
- The personal **Secretary stays frictionless** (no consent step) — it is conservative by design; this feature is
  specialists (+ template specialists) only. Don't touch `ensureSecretary`'s flow.
- Use the agent `defaultScopes` model + `PATCH /v1/agents/:name/scopes`, NOT `ConsentRecord` (that's data-access).
- Backend stays protocol-only (no SSR); don't touch the Enterprise `ee/` module (this is core/MIT). On an Enterprise
  node a role could legitimately request `secretary-enterprise` scopes — the consent step is exactly the right gate, but
  keep the requested-vocabulary bounded and the default conservative.

Build it, verify with E2E + the real browser, and report with evidence. If anything here contradicts the code you find,
trust the code and say what differed.
