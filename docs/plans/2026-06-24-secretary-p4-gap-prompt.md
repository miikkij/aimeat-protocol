# Secretary P4 — gap-closure (post-audit) — handoff prompt

P4 was audited (code read + gates/E2E re-run on 2026-06-24): **P4-A accepted (docs amended), P4-B reconcile is
correctly built** — the company brain is a live read-only `enterprise` overlay from the EE seam
(`resolveEnterpriseDirectiveLayer` in `src/services/secretary.ts`, wired into `agent-directives.ts` GET, provider
passed at `routes-loader.ts:299`), never persisted, per-company, Community-safe (the stub omits `secretaryDirectives`
→ empty layer). Gates green; E2E 67/67 (agent-directives 13, secretary 50 incl. resolver-unit + Community-unaffected,
enterprise-stub 4). This prompt closes the **two residual items the audit surfaced** — both small; G1 is a real
robustness/migration edge from the reconcile, G2 is a pre-existing unrelated bug. Two parts: framing + task.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Read `CLAUDE.md` in full first and follow every MANDATORY RULE exactly — Rule 1
> (E2E SQLite, happy + ≥1 failure mode, 0 failures), Rule 1b (browser-verify via Playwright MCP, never `.spec.ts`),
> Rule 2 (headers), Rule 4 (i18n en+fi), Rule 7 (lint/typecheck/typecheck:frontend/check:importmap green), Rule 9
> (never add known-gaps yourself). Work in small verified steps; never claim anything works without test/browser
> evidence; grep and confirm every endpoint/field/function before calling it. Do exactly G1 (and G2 if you choose to
> take it), report what you actually observed.

---

## PART 2 — the task prompt

### Mission
P4-B changed how a company Secretary's locked brain is delivered: it is now a LIVE read-only `enterprise` overlay
resolved at directives-read time, and `ensureCompanySecretary` (v0.3.0) **no longer persists** the brain into the
agent's directives record. Two residual items remain.

### Repo orientation (verify each path)
- Run dev server: `pnpm dev` (port 40050); restart after backend OR `ee/` changes; dev login `happyadmin` / `Zorlox0x#`;
  browser-verify via the Playwright MCP. EE module is the gitignored repo-root `ee/` (dev loads it; the open-core E2E
  runner forces `AIMEAT_EE_DISABLED=true` → stub, so verify EE-active behavior in the dev server/browser).
- The overlay: `src/services/secretary.ts` `resolveEnterpriseDirectiveLayer(tags, provider, nodeId)` +
  `src/routes/agent-directives.ts` GET merge (`system + enterprise + owner + agent`, `enterprise_locked` flag).
- `ensureCompanySecretary` (`src/services/secretary.ts`) — v0.3.0 no longer persists the brain. Company secretaries are
  agents named `secretary-<slug>`, tagged `system:company-secretary` + `org:<slug>`, owned by the org creator GHII.
- Agent directives storage: `storage.getAgentDirectives(gaii)` / `upsertAgentDirectives` / `deleteAgentDirectives`(grep
  the exact name). The PUT route writes only the agent layer.
- ee/ company-secretary routes: `ee/index.js` (v0.13.0) `GET /v1/orgs/:slug/secretary` derives the brain live; org
  commerce routes incl. the public offerings subtab. Org access helper: `resolveOrgAccess`.
- Tests: `aimeat/test/e2e-secretary.ts` + `e2e-agent-directives.ts`; run
  `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary --test=agent-directives`.

### What to build

**G1 (real) — kill the double-brain for company secretaries provisioned BEFORE v0.3.0.** A company Secretary created
under the old code persisted the locked brain into its agent-directives record. With the new live overlay, that stale
agent-layer copy now renders **alongside** the enterprise overlay → the brain shows twice (duplicate rules / a stale
purpose). The audit's dev boxes were cleaned by hand, but anything provisioned under the old code elsewhere still
double-renders. Make it robust, two acceptable routes (pick one, document it):
- (i) **One-time cleanup at provision/boot:** when `ensureCompanySecretary` runs for an existing company Secretary (or a
  small boot/idempotent sweep), strip any persisted agent-layer directives whose rules duplicate the enterprise layer
  (or clear the persisted brain for `system:company-secretary` agents entirely, since the brain is now seam-sourced).
- (ii) **Dedup at merge time:** in `agent-directives.ts`, when `enterprise_locked` is true, drop agent/owner rules that
  duplicate enterprise rules (and prefer the enterprise purpose), so a stale persisted copy can never double-render.
Prefer (i) if it can run safely idempotently; (ii) is a cheap belt-and-suspenders that also protects future cases.
**Acceptance:** E2E — provision a company Secretary, manually persist a brain copy into its agent directives (simulating
old code), then GET its directives and assert the enterprise rules appear exactly once and `enterprise_locked` is true
(no duplicates); Community/personal agents unaffected. Browser — a company Secretary whose agent directives still hold a
stale brain shows the locked brain once.

**G2 (optional, pre-existing — NOT caused by P4) — the bare-org offerings 500.** `GET /v1/orgs/:owner/:slug/offerings`
(the public catalog subtab) returns 500 for an org that has no portfolio/offerings data (observed on the `overscale`
org). Reproduce, find the unguarded access in the `ee/` offerings handler (likely a missing-portfolio / empty-refs
edge), and make it return an empty catalog (200) instead of throwing. **Acceptance:** the endpoint returns 200 with an
empty/normal payload for an org with no offerings; existing orgs with offerings unchanged. (This is an `ee/` change —
committed in the private repo; verify EE-active in the dev server.)

### Acceptance — not done until all pass AND evidence shown
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm check:importmap` all green.
- `--test=secretary --test=agent-directives` E2E green, with a new G1 test (happy + the duplicate-stale case); don't
  regress the 67/67.
- Browser verification (Rule 1b) on the EE-active dev server for G1 (and G2 if taken); report what you observed.
- i18n en+fi for any new string; headers on touched files; OpenAPI synced for any route change.
- If you want the end-of-plan guarantee, also run the MongoDB sweep (`pnpm test:e2e:mongodb`) — P4-B was verified on
  SQLite only; the overlay is a pure read-time function + storage reads, so MongoDB parity is expected but unverified.

### Gotchas
- The enterprise overlay must stay a NO-OP for non-company agents and under the stub (Community) — don't regress that;
  `resolveEnterpriseDirectiveLayer` already guards on `COMPANY_SECRETARY_TAG` + `secretaryDirectives` presence.
- `ee/` changes live in the separate private repo; restart `pnpm dev` to reload; the open-core runner forces stub mode.
- Backend stays protocol-only (no SSR). Don't reintroduce persisting the company brain — keep it seam-sourced.

Do G1 (G2 if you take it), verify, and report with evidence. If anything here contradicts the code you find, trust the
code and say what differed.
