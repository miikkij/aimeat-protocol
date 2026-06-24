# Secretary P4 — design deviations (decide: accept or reconcile) — handoff prompt

Two parts: (1) framing line, (2) self-contained task prompt. Source audit:
`docs/plans/2026-06-24-secretary-gap-closure.md`. Design ref: `docs/plans/2026-06-23-secretary-feature.md` §4.

> NOTE: Unlike P1–P3, P4 is about two **deviations that already work**. There is no user-visible bug. This prompt's
> first job is a DECISION (accept-and-document vs reconcile-to-design); only reconcile if the developer says so. Don't
> rewrite working code just to match the doc unless asked.

---

## PART 1 — framing line (say this first)

> You are working in the AIMEAT repo. Read `CLAUDE.md` in full first and follow every MANDATORY RULE (esp. Rule 1 E2E,
> Rule 1b browser-verify, Rule 2 headers, Rule 4 i18n, Rule 7 lint/typecheck/typecheck:frontend/check:importmap, Rule 9
> never add known-gaps yourself). For EACH of the two items below, FIRST report the current state with file:line
> evidence and present the accept-vs-reconcile trade-off, and ASK the developer which to do before changing any code.
> If "accept" → only amend the plan doc to match reality. If "reconcile" → implement + verify. Never claim anything
> works without test/browser evidence. Don't invent APIs — grep and confirm.

---

## PART 2 — the task prompt

### Mission
Two parts of the Secretary's "brain" design (`§4`) were implemented differently than the plan described. Both function
correctly today; they are listed so the divergence is a conscious choice, not drift. For each: confirm the current
state in code, decide accept-vs-reconcile WITH the developer, then either amend the plan doc (accept) or implement the
design (reconcile). Do ONLY P4-A and P4-B.

### Repo orientation (verify each path)
- Directives system + 3-layer merge: `aimeat/src/routes/agent-directives.ts` (the `system` + `owner` + `agent` merge),
  `aimeat/src/models/agent-directives-schemas.ts`, storage `upsertAgentDirectives` / `getAgentDirectives` /
  `AgentDirectivesRecord` (`aimeat/src/storage/interface.ts`, `DirectiveRule = {id,description,details?}`).
- Secretary policy + config: stored in owner memory `secretary.config` =
  `{ contexts:[{ id, name, brain:{purpose,rules}, organismId, organismName, workspaces,
  policy:{ stopSpending, dailyMorselBudget, bands } }], activeContextId, pendingDecisions }`. The scheduler reads policy
  from here: `aimeat/src/services/scheduler.ts` `executeSecretaryJob` (`storage.getMemory(owner,'secretary.config')`).
- Company locked brain: `aimeat/src/services/secretary.ts` `ensureCompanySecretary` writes the EE-supplied brain via
  `storage.upsertAgentDirectives(...)` (i.e. directly into the agent layer), and the company UI renders it read-only
  (`aimeat/public/views/my-company.js` `SecretaryPanel`). The EE seam supplying it: `aimeat/src/enterprise/provider.ts`
  (`secretaryDirectives`/`secretaryScopes`/`secretaryCapabilities`) + `ee/index.js`.
- Plan §4 to amend if "accept": `docs/plans/2026-06-23-secretary-feature.md`.

### The two items

**P4-A — Policy block location.** Design §4 said the structured policy block (per-capability band, budgets,
stopSpending, goal refs) lives "ON THE DIRECTIVES RECORD" and "the scheduler reads this, never the prose." Reality: the
policy lives in owner memory `secretary.config` (per-context), and the scheduler reads it correctly from there.
- *Accept (recommended):* `secretary.config` is the natural home for the multi-context shape; amend §4 to say the policy
  is a structured block in `secretary.config`, read by the scheduler. No code change.
- *Reconcile:* move the policy onto the agent-directives record (a structured block per the schema), make the scheduler
  read it from directives, migrate existing `secretary.config` policies. Bigger change; multi-context makes it awkward
  (one directives record vs N contexts). Only do this if the directives API must own the policy.
- **Deliverable:** the developer's choice carried out — either a §4 amendment, or the reconciliation + migration + E2E
  proving the scheduler still gates on the moved policy + browser proving bands/stop-spending still work.

**P4-B — Company locked brain as a merge layer.** Design §4 said the company brain is "a new `source:'enterprise'` in
the merge, ranked above owner/agent and read-only." Reality: the locked brain is written into the agent's directives
in-place (no enterprise tier in the merge); it renders read-only in the company UI.
- *Accept (recommended for now):* no functional loss — the read-only promise holds. Amend §4 to say the company brain is
  written to the company-secretary's agent directives and rendered read-only.
- *Reconcile:* add a 4th `enterprise` source to the directives merge (`agent-directives.ts`), ranked above owner/agent,
  populated from the EE seam's `secretaryDirectives(orgId)`, read-only in the API + UI. Do this only if company
  secretaries will later need owner/agent layers to coexist UNDER a locked enterprise layer.
- **Deliverable:** the developer's choice carried out — a §4 amendment, or the new merge layer + E2E (merge order +
  read-only enforcement) + browser (company brain still shows locked).

### Acceptance
- If "accept" for an item: the plan doc §4 is amended to match the code; no behavior change; note it in the gap-closure
  doc. No tests needed beyond confirming nothing changed.
- If "reconcile" for an item: `pnpm lint`/`typecheck`/`typecheck:frontend`/`check:importmap` green; targeted E2E
  (`cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary`, +
  `--test=enterprise-stub` if you touch the seam) proving the new behavior + that Community is unaffected; browser
  verification of the affected UI; i18n/headers/OpenAPI as needed.

### Gotchas
- The open-core E2E runner forces `AIMEAT_EE_DISABLED=true` (stub) — Community must stay unaffected by any seam change;
  verify EE-active behavior on the dev server (it loads the gitignored `ee/`). `ee/` changes are committed in its own
  private repo, not here; restart `pnpm dev` to reload it.
- Don't break the existing 24/24 `e2e-secretary` or 4/4 `e2e-enterprise-stub`.
- Backend stays protocol-only (no SSR).

Start by reporting current state + the trade-off for each item and asking which way to go. Do not change working code
before that decision.
