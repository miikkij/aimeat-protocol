# Secretary P5 — Addendum epic (§15–20): specialist agents · templates · connectors · secrets — handoff prompt

Two parts: (1) framing line, (2) self-contained task prompt. Source audit:
`docs/plans/2026-06-24-secretary-gap-closure.md`. Design ref: `docs/plans/2026-06-23-secretary-feature.md` §15–20 + the
phased items S-A…S-D in §19.

> NOTE: This is a **multi-session epic**, not a quick fix — four sub-features (S-A…S-D) + a reference template. Do them
> in the recommended order, one focused session each; do NOT attempt all in one pass. Everything here is currently
> **design-only — zero code exists** (confirmed by audit). §3 secretary topology is unchanged: this ADDS a new agent
> type alongside the two secretaries; it is not a re-org of them.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Read `CLAUDE.md` in full first and follow every MANDATORY RULE exactly — Rule 1
> (E2E SQLite, happy + ≥1 failure mode), Rule 1b (browser-verify via Playwright MCP, never `.spec.ts`), Rule 2 (headers),
> Rule 3 (OpenAPI sync for new routes), Rule 4 (i18n en+fi), Rule 5 (dependency management if you add a package), Rule 7
> (lint/typecheck/typecheck:frontend/check:importmap green), Rule 9 (never add known-gaps yourself). Also obey the
> "Backend Architecture Rule — NO Server-Side Rendering" and "every route must be generic" — a use-case template is
> DATA loaded by a generic route, never a per-service backend file. This is a multi-session epic: do ONE sub-feature
> (S-A, S-B, S-C, or S-D) per session, in the order given, verifying each before the next. Never claim anything works
> without test/browser evidence. Grep and confirm every API before calling it.

---

## PART 2 — the task prompt

### Mission
Generalize the Secretary machinery into a reusable **specialist agent** type, add **use-case templates** (packaged
organism blueprints as DATA), wire **extension connectors** with encrypted **secret** config, and make templates
self-healing + discoverable — culminating in a reference "B2B Sales Hub" template. Everything below is design-only
today. Build it in the order S-C → S-A → S-B → S-D → reference template (rationale below), ONE per session.

### Recommended order + why
1. **S-C first (connector secret-wiring)** — smallest, lowest-risk, unblocks real connectors. Pure encryption wiring,
   pattern already proven by `routes/openrouter.ts`. No product/ToS decisions needed for the *mechanism*.
2. **S-A (specialist agent type)** — factor the secretary's brain/band/self-organism machinery into a reusable type.
3. **S-B (template format + instantiate)** — extend organism-export to a skeleton + `template.json`; generic instantiate route.
4. **S-D (missing-dep self-heal + templates DiscoverySource)** — depends on S-B + S-C.
5. **Reference template "B2B Sales Hub (FI/SE)"** — proves the whole chain end-to-end.

> Before building a SPECIFIC paid connector (Vainu/Alma), settle the ToS/redistribution question (design decision #10):
> connectors to paid third-party data default to **bring-your-own-key per tenant** (`instances.config_per_instance`),
> never a node-global key. S-C builds the *mechanism*; a real Vainu/Alma connector needs the contract question settled.

### Repo orientation (verify each path before relying on it)
- Run dev server: `pnpm dev` (port 40050); dev login `happyadmin` / `Zorlox0x#`; browser-verify via Playwright MCP.
- Scope profiles: `aimeat/src/mcp/catalog/scopes.ts` `MCP_SCOPE_PROFILES` (today only `secretary`/`secretary-enterprise`
  among secretary-ish; no `sdr`/`prep`/`finance`/`recruiter`).
- Secretary machinery to factor: `aimeat/src/services/secretary.ts` (`ensureSecretary` — keypair, tags, scopes,
  directives) + the frontend brain/band/policy (`public/views/secretary/*`, `public/js/services/secretary-policy.js`).
- Organism export/import: `aimeat/src/services/organism-export.ts` (ZIP: `organism.json` + `workspaces/{ws}/workspace.json`
  + `images/`) + the organism import path + the organism MCP tools. NOTE: `aimeat/src/routes/templates.ts` is an
  UNRELATED gallery/marketplace, and `aimeat/src/services/template-bundles.ts` is CSM schema seeding — neither is the
  organism-blueprint feature; do not conflate.
- Encryption (for S-C): `aimeat/src/services/encryption.ts` (`encrypt`/`decrypt`/`getEncryptionKey`, AES-256-GCM,
  node master key `AIMEAT_ENCRYPTION_KEY`). Proven pattern: `aimeat/src/routes/openrouter.ts` (encrypt on write → store
  `{encrypted}` in owner memory → decrypt on read in `services/ai-completion.ts`). Extensions today store config
  PLAINTEXT: `aimeat/src/routes/extensions.ts` (`buildExtensionRecordFromManifest`, install/update handlers) +
  `aimeat/src/services/extension-runtime.ts` (passes `ctx.config` to the QuickJS VM undecrypted).
- Discovery (for S-D): `aimeat/src/services/discovery/registry.ts` + `sources/` (existing: `memory-fts`, `capabilities`,
  `apps`, `agent-tasks`). Register a `templates` source by adding one adapter — expansion is a registration, not a rewrite.
- Agent tasks / workflows (for specialist orchestration): `materialiseAgentTask` (`scheduler.ts`), the Agent Workflow
  engine. Tests: `aimeat/test/` (add `e2e-*` suites; register in `test/run-e2e-ci.ts`).

### The sub-features

**S-A — Specialist agent type.** Factor the secretary brain/band/self-organism machinery into a reusable "specialist"
type: provision a specialist GAII (`sdr#owner@node`, `prep#owner@node`, …) with its OWN brain (prose directives +
policy) + its own scope profile, listed in the agents tab, NOT named "secretary". Reuse `ensureSecretary`'s provisioning
pattern (extract a shared helper; don't fork it). The personal + company secretaries stay exactly as they are. The
Secretary can orchestrate specialists by creating agent tasks / messaging them (band-gated). **Acceptance:** E2E —
create a specialist with a distinct brain + scope profile; its bands/cost-guard behave like the secretary's; it does not
collide with `secretary#owner@node`. Browser — the specialist shows in the agents tab.

**S-B — Use-case template format + instantiate flow.** Extend `organism-export` with a **skeleton mode**: `organism.json`
(settings + workspace index) as-is, each `workspaces/{ws}/workspace.json` reduced to schema/purpose only (no objects/
rows/images), plus a new top-level `template.json` carrying specialist directives + extension-dependency refs + scope
presets. Add a GENERIC "instantiate template" route that builds the empty organism + workspaces from the skeleton, adds
the specialists, checks the extension deps, and applies the scope presets — reports unmet deps, never crashes. A template
is DATA, loaded by a generic route — no per-service backend file. **Acceptance:** E2E — export a template (skeleton +
`template.json`), import/instantiate it → organism + workspaces + specialists materialize; an unmet extension dep is
reported, not a crash. Round-trips content-free (safe to publish).

**S-C — Connector pattern + secret wiring (§18).** (a) Extend the extension manifest config-field schema with a
`type: 'secret'` marker (mirror the generator UI's `type:'secret'`). (b) In `routes/extensions.ts` install/update,
encrypt `type:'secret'` fields via `encryption.ts` exactly like `openrouter.ts` (today plaintext). (c) In
`extension-runtime.ts`, decrypt those fields before passing `ctx.config` into the QuickJS VM. Ship ONE reference
connector behind bring-your-own-key per instance (`instances.config_per_instance`) with both an action and an optional
cron sync. **Acceptance:** E2E — a secret field round-trips ENCRYPTED (assert ciphertext in storage, never plaintext);
an action call and a scheduled sync both populate `ext:` memory; the SSRF guard rejects internal hosts. Browser — the
secret field renders masked.

**S-D — Missing-dep self-heal + template DiscoverySource.** (a) When a template's extension dependency is unmet, generate
a build-prompt the user can paste to Claude Code (or any agent) which builds + installs the connector over the appdev
MCP (`aimeat_extension_install`), satisfying the dep. (b) Register a `templates` DiscoverySource so blueprints are
findable via `GET /v1/discover`. **Acceptance:** E2E — a template with a missing connector yields a working build prompt;
templates appear in `/v1/discover`.

**Reference template — "B2B Sales Hub (FI/SE)".** As DATA: a sales organism skeleton + SDR & meeting-prep specialist
directives + Vainu/Alma connector dependency refs (the connectors themselves only after the ToS question is settled).
The end-to-end proof of the epic. **Acceptance:** instantiate it → sales organism + the two specialists materialize; the
Vainu/Alma deps surface as unmet (with build prompts) until connectors exist.

### Acceptance — per sub-feature, not done until all pass AND evidence shown
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm check:importmap` all green.
- New `e2e-*` suite(s) registered in `test/run-e2e-ci.ts`, run on SQLite, happy + ≥1 failure mode, 0 failures.
- Browser verification (Rule 1b) for any UI; report what you observed. If you can't drive the browser, say so.
- i18n en+fi, file headers, OpenAPI sync for new routes, dependency-management rule if you add a package.

### Gotchas
- Backend is protocol-only: NO SSR, NO per-service backend file. A template is data loaded by a generic route — if you
  find yourself writing `portal-sales.ts` you're doing it wrong.
- The encryption master key is per-NODE, not per-owner; secrets stay owner-scoped in memory but encrypted with the node
  key (design decision #13: don't build per-tenant key vaults on shared nodes — stronger isolation = a dedicated managed
  instance).
- Long AI calls from the SPA use `api(path, {timeoutMs:1_800_000, retries:0})`, never `apiPost`.
- The open-core E2E runner forces `AIMEAT_EE_DISABLED=true`. This epic is core/MIT (specialist + templates + connectors
  are not Enterprise-gated) — keep it out of `ee/`.

Do ONE sub-feature per session in the order S-C → S-A → S-B → S-D → reference template. Verify and report with evidence.
If anything here contradicts the code you find, trust the code and say what differed.
