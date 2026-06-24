# Secretary — Gap Analysis & Gap-Closure Prompt

**Audit date:** 2026-06-24 · **Auditor:** independent code review (4 parallel passes) against the design plan
`docs/plans/2026-06-23-secretary-feature.md`. **Method:** every design claim verified in code (file:line), not
against the plan's own build annotations.

This document is both the **gap analysis** and an **actionable gap-closure prompt** — hand any section to an
implementing agent (Claude Code). Each work item carries: design ref · current state (with evidence) · what to
build · target files · acceptance criteria (Rule 1 E2E + Rule 1b browser).

---

## 0. Verdict in one line

The **core Secretary (Phases 0–6) is genuinely built & verified** — identity, multi-context, hire→brain→self-organism,
operating bands + hard stop-spending, chat, resource finder, teach, save-note, inbox Ask cards, guided playbooks,
autonomous tick + Home feed + calendar, the learning loop, and the full Enterprise company-secretary (seam + locked
brain + CFO governance + company model). The gaps are **depth and reach**, not foundation: the autonomous tick is a
*briefing*, not an *action loop*; the soft cost budget is unenforced; several explicitly-named capability corners and
the entire §15–20 "specialist/templates/connectors" addendum were never started.

## 1. Audit summary

| Area | Designed | Status | Gap tier |
|---|---|---|---|
| Phase 0 identity + `secretary` scopes | §3, §9 | ✅ BUILT (scopes exact) | — |
| Phase 1 hire → brain + self-organism + bands + versioning | §4–§6 | ✅ BUILT | — |
| Phase 1.5 multi-context | §22 | ✅ BUILT | — |
| Phase 2 chat / finder / teach / **suggest-routing** | §7,§9,§22 | ✅ BUILT (suggest wired end-to-end) | — |
| Phase 3 save-note / Ask cards / playbooks / 3rd-party gate | §6–§9 | ✅ BUILT | — |
| Phase 4 tick + Home feed + calendar + **hard** stop-spending | §6,§7 | ✅ BUILT (shell) | see P1 |
| Phase 5 goals + decision-log contract + scored review | §7 | ✅ BUILT (manual log) | see P2-G |
| Phase 6 seam + company secretary + governance + model | §10 | ✅ BUILT | see P3 deviations |
| **Tick "anything to do?" pre-check** | §7, dec #3 | ❌ ABSENT — every tick spends | **P1** |
| **Tick loads goals + organism, routes ACTIONS via bands** | §7 | ❌ ABSENT — free-text briefing only | **P1** |
| **Soft cost guard: `dailyMorselBudget` → constraints** | §6 | ⚠️ STUB — dead field, unenforced | **P1** |
| **Budget enforcement for `secretary` job kind** | §6 | ❌ ABSENT (`daily_limit` is ai-only) | **P1** |
| **Self-facing reliability label** | §3 | ❌ ABSENT — trustScore stays 50 | **P2** |
| **§22 Phase-4 auto-routing of intake + corrections-teach** | §22 | ❌ ABSENT (suggest-only) | **P2** |
| **§21 Create-don't-just-find** | §21 | ❌ ABSENT (finder lists only) | **P2** |
| **§21 Knowledge custodian** | §21 | ❌ ABSENT | **P2** |
| **§21 Access gatekeeper (sharing/consent)** | §21 | ❌ ABSENT | **P2** |
| **§21 Crew setup (configure other agents)** | §21 | ❌ ABSENT | **P2** |
| **Doc/image intake into the self-organism** | §2,§7 | ❌ ABSENT (chat text-only) | **P3** |
| **Auto-create decisions from Ask cards / guided plans** | §7 | ❌ ABSENT (manual only) | **P3** |
| Policy block on the directives record (vs `secretary.config`) | §4 | ✅ ACCEPTED (config is the home; §4 amended) | **P4-A DONE 2026-06-24** |
| Company locked brain as `source:'enterprise'` merge layer | §4 | ✅ BUILT (live `enterprise` overlay, read-only, multi-company) | **P4-B DONE 2026-06-24** |
| §15 Specialist agent type (S-A) | §15,§19 | ❌ ABSENT | **P5 (separate epic)** |
| §16 Use-case template format + instantiate (S-B) | §16,§19 | ❌ ABSENT | **P5** |
| §17–18 Connector pattern + `type:secret` encryption (S-C) | §17,§18 | ❌ ABSENT (3/3 parts) | **P5** |
| §16/§17 templates DiscoverySource + missing-dep self-heal (S-D) | §16,§17,§19 | ❌ ABSENT | **P5** |
| Reference "B2B Sales Hub" + Vainu/Alma connectors | §19 | ❌ ABSENT | **P5** |

---

## P1 — Make the autonomous tick a real action loop + enforce the cost budget

> **Why first:** this is the heart of "autonomous Secretary" and the money-safety promise. Today the tick only
> writes a free-text check-in to the feed (evidence: `aimeat/src/services/scheduler.ts` `executeSecretaryJob`
> ~line 561–565 sends one fixed prompt, ignores goals/organism, appends a `briefing`), and `dailyMorselBudget`
> is a dead field (`use-autonomy.js` `enableTick` posts the schedule with **no `constraints`**; the `secretary`
> kind isn't covered by `daily_limit` — `schedule-constraints.ts` early-returns for non-`ai` kinds).

**P1-A — Tick action loop.** In `executeSecretaryJob`, before the completion: load the active context's **open
goals** (`storage.listMemory(owner, {prefix:'secretary.goal.'})` filtered `status==='open'`) and a cheap slice of
the **self-organism** (the context's `organismId` + recent workspace records / objectives), and build a prompt that
asks the model for a **structured action list** (JSON: `[{ capability, summary, payload }]`), not prose. Then route
each proposed action through the context's **bands** (`policy.bands[capability]`): `act` → perform + feed entry;
`draft`/`ask` → post the existing inbox card (reuse the Phase-3b `metadata.prompt` rails + `secretary.config.pendingDecisions`);
`off` → drop. Keep the short briefing as a fallback/summary. **Acceptance:** E2E — seed a goal + a context with a
capability band = `ask`, trigger the tick (stop-spending off, but in E2E assert the *routing decision* on a mocked/empty-key
path or assert the pending card is created); browser — Run-now with a real goal produces at least one band-routed item
(feed entry for `act`, inbox card for `ask`) tied to the goal. Reuse `api()` long-timeout (never `apiPost`).

**P1-B — Cheap "anything to do?" pre-check** (resolved decision #3). Before the paid completion, run a zero/near-zero
cost check: if there are **no open goals, no due decisions, and no pending intake** for the active context, skip the
paid briefing (write nothing, or a single cheap "idle" marker at most once/day). **Acceptance:** E2E — a context with
no goals/decisions/intake → tick returns `skipped` (or no paid call) ; with a goal → it runs. Confirm no
`completeForOwner` call on the idle path.

**P1-C — Enforce `dailyMorselBudget` (soft cost guard, §6).** Wire the budget so it actually caps spend. Two
acceptable routes — pick one and document it: **(i)** when `use-autonomy.js` `enableTick` creates the schedule, pass a
`budget` **ScheduleConstraint** derived from `policy.dailyMorselBudget`, and make `schedule-constraints.ts` honor
`budget`/`daily_limit` for the `secretary` kind (today it early-returns for non-`ai`); **or (ii)** enforce it inside
`executeSecretaryJob` with a per-day spend counter in `secretary.config` (read `result.usage`/morsels, accumulate,
skip + push-notify when the day's cap is hit, reset on date change). On trip: degrade to Ask/Draft-only and
push-notify, matching the §6 "auto-disable + notify" promise. **Acceptance:** E2E — set a tiny budget, simulate spend
past it, assert the next tick skips with reason `budget`; the hard `stopSpending` path stays as-is. Surface the
remaining budget in the automation card.

**P1-D — Reliability label (§3).** Compute a **self-facing reliability** number (not marketplace trust) from the
learning loop: e.g. mean decision `score` over reviewed decisions (+ "did-what-it-said" = ratio of `act` plans that
completed). Expose it (a small backend helper or compute client-side from `secretary.decision.*`) and render it in
`cards.js` `metaCard` / the operating card. Keep the agent `trustScore` untouched. **Acceptance:** browser — after a
couple of reviewed decisions, a reliability chip shows a real number; with none, it shows "—"/"building".

---

## P2 — Close the named capability corners (§21) + finish §22 routing

> The vision explicitly said the Secretary checks what's "saatavilla **tai luotavissa**" and is the custodian/
> gatekeeper/crew-organizer. These are capability-list + brain additions on existing ungated/owner-auth routes —
> no new architecture. All confirmed ABSENT in code.

**P2-A — Create-don't-just-find (§21).** When `doFind` (`secretary.js`) returns **zero** results for a goal, offer a
**guided playbook** to create the missing piece: a capability (`/v1/capabilities` create — ungated), a workflow, or
(later) a template/specialist. Gate behind Draft/Ask. **Acceptance:** browser — an empty discover result surfaces a
"create it?" path that, on approve, scaffolds a capability and shows it.

**P2-B — Knowledge custodian (§21).** Add a Draft-band action to contribute/curate the user's knowledge base
(`/v1/knowledge` `knowledge_contribute`/`_get`/`_links`) on the user's behalf (e.g. promote a refined note/decision
into shareable knowledge). **Acceptance:** browser — Secretary drafts a knowledge contribution; on approve it lands in
the knowledge graph + is discoverable.

**P2-C — Access gatekeeper (§21).** A surface for the Secretary to help manage the user's **own** sharing groups +
consent grants (Draft/Ask). **Acceptance:** browser — Secretary proposes a consent/sharing change; on approve it
applies.

**P2-D — Crew setup (§21).** A guided playbook to connect/configure the user's **other** agents — walk device-auth
approval + set directives/mode/tags. This is the on-ramp to §15 specialists. **Acceptance:** browser — the playbook
walks approving a pending agent and setting its mode/tags.

**P2-E — §22 Phase-4 auto-routing + corrections-teach.** In the tick/intake path, classify each incoming item
(inbox/scheduled/intake) across **all** contexts (reuse `suggestContextId` cheap-first → light LLM on ambiguity) →
high-confidence **auto-route** into the right context, low-confidence → **Ask card**. Record user **corrections**
(item moved A→B) as a routing signal (feeds the §7 loop). **Acceptance:** E2E — an item clearly matching a non-active
context auto-routes there; an ambiguous one yields an Ask card; a recorded correction changes a later cheap-route.

---

## P3 — Deferred niceties

**P3-A — Doc/image intake (§2,§7).** Add file/image upload to the Secretary chat (`chatCard`/`sendChat`): storage
upload + classify into the self-organism; for images use a vision-capable model via `/v1/ai/complete`. **Acceptance:**
browser — upload a doc/image → it's filed into the right workspace + discoverable.

**P3-B — Auto-create decisions from Ask cards / guided plans (§7).** When an Ask card is answered (`applyDecision`)
or a guided plan is approved/run (`use-guided-plan.js`), auto-create a `secretary.decision.*` contract (chosen +
rationale + an `expectedOutcome` + a default `revisitWhen`) so the learning loop measures real choices, not only
manually-logged ones. **Acceptance:** E2E — answering an Ask card creates a reviewable open decision.

---

## P4 — Design deviations (decide: accept or reconcile) — RESOLVED 2026-06-24

These **work** today; listed for a conscious decision, not because they're broken.

**P4-A — Policy block lives in `secretary.config` (owner memory), not on the directives record (§4 said "on the
directives record, scheduler reads this, never the prose").** The scheduler reads it correctly from config.
**DECISION: ACCEPT (developer, 2026-06-24).** Config is the natural home for the multi-context shape (one directives
record can't carry N per-context policies). No code change; plan §4 amended to say the policy is a structured block in
`secretary.config` read by the scheduler (the directives record keeps only token-level `budget_limits`).

**P4-B — Company locked brain was written into the agent directives in-place, not as a ranked `source:'enterprise'`
merge layer (§4).** **DECISION: RECONCILE (developer, 2026-06-24) — built.** Added a 4th `source:'enterprise'` layer to
the directives merge (`routes/agent-directives.ts` + pure `resolveEnterpriseDirectiveLayer` in `services/secretary.ts`),
ranked above owner/agent and read-only. Implemented as a **live overlay** from the seam (`secretaryDirectives(orgId)`,
resolved per the agent's `org:<slug>` tag) rather than a persisted copy, so brains are **swappable** and **each company
resolves its own** (multi-company), with the owner/agent layers left free to coexist under the locked layer.
`ensureCompanySecretary` no longer persists the brain; `ee/` v0.13.0 GET `/v1/orgs/:slug/secretary` now derives the
brain live (`companySecretaryBrain`). Read-only is enforced because PUT only writes the agent layer. The GET response
gained `enterprise_locked`. Verified: `secretary` 50/50 + `enterprise-stub` 4/4 (Community unaffected, EE disabled);
EE-active dev server — both `overscale`/`overscale-oy` merges show 4 read-only `enterprise` rules ranked above the agent
layer (`enterprise_locked:true`) sourced live (still present after the persisted directives were deleted), and the My
Company → Secretary panel renders the 🔒 locked brain.

### P4 post-audit residuals — G1, G2 (BUILT & verified 2026-06-24)

**G1 — kill the double-brain for company secretaries provisioned before v0.3.0.** A pre-v0.3.0 company Secretary
persisted the locked brain into its agent directives; with the live overlay that stale copy would render a *second* time
next to the enterprise layer. Fixed two ways (belt-and-suspenders): **(ii) merge-time dedup** — `agent-directives.ts`
drops owner/agent rules whose normalized description duplicates an enterprise rule (`dropEnterpriseDuplicates` in
`services/secretary.ts`), a no-op when there's no enterprise layer (Community/non-company untouched); **(i) self-heal** —
`ensureCompanySecretary` (v0.4.0), on re-provision of an existing company Secretary, deletes a persisted directives
record that is *purely* a copy of the locked brain (`isStalePersistedBrain`), preserving any genuine per-owner rules.
Verified — E2E (unit: dedup collapses a stale copy/keeps genuine rules/no-op without a layer + `isStalePersistedBrain`;
HTTP: a personal Secretary's agent rules survive the merge) `secretary` 53/53 (SQLite + MongoDB), `agent-directives`
13/13, `enterprise-stub` 4/4; EE-active browser — persisting the brain into `secretary-overscale-oy`'s agent layer then
GETting the merge shows `system:2, enterprise:4, agent:0` (the stale copy deduped, renders once); re-provision logged
`stripped stale persisted brain` (self-heal deleted it); a persisted copy *plus* a genuine rule → `agent:1` (the genuine
rule preserved). My Company → Secretary panel shows the locked brain once (4 distinct rules, 🔒 chip).

**G2 — bare-org offerings 500 (pre-existing, not caused by P4).** `GET /v1/orgs/:owner/:slug/offerings` 500'd for an org
whose offerings doc predates the `{refs:[]}` schema (legacy `{offerings:[]}`, e.g. `overscale`) — `for (const ref of
doc.refs)` threw on `undefined`. `ee/` v0.14.0 guards the refs array (`Array.isArray(doc?.refs) ? … : []` → empty
catalog) + validates/resolves each ref defensively. Verified EE-active — `overscale` offerings now `200 {offerings:[]}`
(was 500), `overscale-oy` unchanged 200; the My Company catalog subtab for `overscale` loads ("Catalog is empty …")
instead of the error boundary.

---

## P5 — Addendum epic (§15–20): specialist agents · templates · connectors · secrets

**Entirely design-only — zero code.** This is a **separate epic**, not a Secretary bug. Confirmed ABSENT: no specialist
agent type/scope profiles (only `secretary`/`secretary-enterprise`), no organism **template** format/instantiate flow
(`organism-export.ts` has no skeleton mode; `routes/templates.ts` is an unrelated gallery; `template-bundles.ts` is CSM
seeding), no `type:secret` manifest support / extension-config encryption (`routes/extensions.ts` stores plaintext;
`encryption.ts` exists but is unused by the extension flow; `extension-runtime.ts` passes `ctx.config` undecrypted), no
`templates` DiscoverySource, no missing-dep build-prompt loop, no reference template/connector.

**Recommendation:** treat §15–20 as its own planned epic (the plan's S-A…S-D already scope it). Do **not** fold it into
Secretary gap-closure. Before starting S-C, settle the §17/§20 ToS question (Vainu/Alma = bring-your-own-key per
tenant). The secret-wiring (S-C) is the highest-leverage, lowest-risk first step (pure encryption wiring, pattern =
`routes/openrouter.ts`).

---

## Cross-cutting build notes (apply to every item)

- **Long AI calls** (`/v1/ai/complete`, the tick): always low-level `api(path,{timeoutMs:1_800_000,retries:0})`,
  never `apiPost` (30s timeout + retries re-fires slow models).
- **Live updates:** any new Secretary surface showing server data must subscribe to `aimeat-live-update`.
- **ee/ changes** live in the separate private repo (gitignored `ee/`); restart `pnpm dev` to reload it; the open-core
  E2E runner forces `AIMEAT_EE_DISABLED=true` (stub) — verify Community-unaffected there, verify EE-active in the dev
  server / browser.
- **Each item ends with** targeted SQLite E2E (happy + ≥1 failure mode) per Rule 1, browser verification per Rule 1b,
  i18n en+fi (Rule 4), headers (Rule 2), `pnpm lint`/`typecheck`/`typecheck:frontend`/`check:importmap` green (Rule 7),
  and OpenAPI sync for any new route (Rule 3). Gate `known_gaps` additions through the developer (Rule 9).
- **Order:** P1 (tick loop + budget) delivers the most user-visible "it actually works autonomously and safely" value;
  P2 broadens reach; P3 polishes; P4 is a doc/decision; P5 is a separate epic.
