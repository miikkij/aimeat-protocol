# Secretary P5 epic — gap-closure (post-audit) — handoff prompt

The P5 epic (S-C secrets · S-A specialists · S-B templates · S-D discovery · reference template) was audited
2026-06-24: code read + gates re-run + **165/165 E2E re-run independently** (extension-secrets 14, specialists 17,
organism-templates 10, b2b-sales-hub 6, discover 20, mcp-extensions 20, workspace-export-import 10, organism-batch 11,
secretary 53, enterprise-stub 4). It is **overwhelmingly correct**:
- **S-C** — secrets encrypted at rest (no plaintext path), decrypted only at the VM (action + scheduler cron), masked
  on read, ciphertext preserved on PATCH, 503 when no node key, idempotent plaintext-normalized compare. Security-clean.
- **S-B** — content-free skeleton genuinely strips objects + image binaries (no tenant-data leak); `instantiateTemplate`
  reuses `restoreOrganismFromFiles` + reports unmet deps without crashing; generic owner/creator-gated ZIP-safe routes.
- **S-D** — `buildConnectorPrompt` is a real prompt (names the connector + `aimeat_extension_install` + the `type:secret`
  pattern); a `templates` DiscoverySource is registered AND the memory source excludes `template.catalog.*` (no
  double-listing); publish stores a public content-free record.
- **Reference template** — pure DATA (`docs/templates/b2b-sales-hub/`); Vainu/Alma are unmet dep refs only (no connector
  code — ToS gate respected).

**One real finding (this prompt):** the S-A specialist **scope profiles exceed the Community-safe line they claim to
respect.** This is the only gap.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Read `CLAUDE.md` in full first and follow every MANDATORY RULE exactly — Rule 1
> (E2E SQLite, happy + ≥1 failure mode, 0 failures in suites you ran), Rule 2 (headers), Rule 9 (never add known-gaps
> yourself). Work in small verified steps; never claim anything works without test evidence; grep and confirm before
> changing. This is a small, precise scope-correctness fix — do exactly G1 (and decide G2 with me), nothing more.

---

## PART 2 — the task prompt

### Mission
The P5 specialist scope profiles (`src/mcp/catalog/scopes.ts` `MCP_SCOPE_PROFILES`) contradict their own comment and the
design's edition split. The comment on the specialist block (lines ~129–134) states *"Per-role presets stay WITHIN the
Community-safe set — outbound (messages:send), transactional (work:*), spend (wallet debit) and consent stay
Enterprise-only, exactly like the Secretary"*, and the same file's `secretary` comment (line ~126) lists `wallet`,
`workflow:write`, and `social-write` as the Enterprise-only `secretary-enterprise` superset (per
`docs/plans/2026-06-23-secretary-feature.md` §9). But the actual arrays grant Enterprise-reserved scopes to Community
specialist defaults:
- `sdr`: includes **`workflow:write`** (Enterprise-only per §9) and `social:read` (Enterprise superset).
- `finance`: includes **`wallet:read`** (the comment itself calls wallet Enterprise-only).
- `recruiter`: includes `social:read` (Enterprise superset).

The Community `secretary` baseline is exactly: `memory:read, memory:write, memory:delete, storage:read, storage:write,
messages:read, workflow:read`. `specialist` (the generic base) and `prep` already comply; `sdr`/`finance`/`recruiter`
do not.

This is not an exploit (these scopes gate core features, not paid unlocks), but it is a **least-privilege / design-
consistency violation**: a Community-provisioned specialist silently gets autonomy surface the design reserves for the
Enterprise tier, while the code comment claims otherwise.

### G1 — bring the specialist presets back within the Community-safe set (recommended fix)
In `src/mcp/catalog/scopes.ts`, trim the role presets so none grants a scope outside the `secretary` Community baseline
(memory r/w/delete, storage r/w, messages:read, workflow:read) — i.e. remove `workflow:write` from `sdr`, `wallet:read`
from `finance`, and `social:read` from `sdr`/`recruiter` (or, if you and the developer decide a role genuinely needs a
broader scope, see G2 — do NOT just leave the comment lying). After the trim, every entry in `SPECIALIST_ROLES`
(`specialist`, `sdr`, `prep`, `finance`, `recruiter`) must be a subset of the `secretary` array. Update the comment if
the wording needs to match. **Acceptance:** add an E2E assertion (extend `test/e2e-specialists.ts`) that, for every role
in `SPECIALIST_ROLES`, `scopesForProfile(role)` ⊆ `scopesForProfile('secretary')` — and it passes. Re-run
`--test=specialists` (don't regress 17/17) + `--test=secretary` + `--test=enterprise-stub`. `pnpm lint`, `typecheck`,
`typecheck:frontend`, `check:importmap` green.

### G2 — OR, if a role legitimately needs a broader scope (developer decision, ask first)
If the developer decides e.g. an SDR genuinely needs `workflow:write` or finance needs `wallet:read`, then DON'T trim —
instead make it an explicit, documented exception: (a) reconcile the misleading comment so it states which roles carry
which Enterprise-superset scopes and why, (b) update `docs/plans/2026-06-23-secretary-feature.md` §9/§19 to record the
decision, and (c) confirm these scopes are acceptable to grant by default on a Community node (they gate core
workflow/wallet/social-read features, which exist in Community — so this is an autonomy-surface choice, not a paywall
bypass). **Do not pick G2 unilaterally — present the trade-off and let the developer choose G1 vs G2 per role.**

### Notes / non-issues (do NOT touch)
- S-C, S-B, S-D, and the reference template passed the audit cleanly — no changes needed there.
- The whole P5 epic is core/MIT and does NOT touch `ee/` — keep it that way.
- The dev server may be running a stale build; restart `pnpm dev` if you browser-check anything (S-A's only browser
  surface is the "Specialist · <role>" badge in the Agents tab — unaffected by a scope trim, but confirm a trimmed
  `sdr` still provisions + shows the badge).

Do G1 (or G2 per the developer's call), verify with the subset E2E assertion + the suites above, and report with
evidence. If anything here contradicts the code you find, trust the code and say what differed.
