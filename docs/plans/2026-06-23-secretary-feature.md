# Secretary — Design & Phased Build Plan

**Status:** design approved in discussion (2026-06-23); open questions resolved; not yet built.
**Owner:** Jouni Miikki / Overscale Solutions Oy (Enterprise side).
**Source vision:** `jounisideas.log`. **Locked decisions:** see the session memo (memory `secretary-feature-design`).

---

## 1. What the Secretary is

A per-user AI assistant inside AIMEAT that reduces the user's cognitive load — the classic secretary role (communication hub, organizer of time/resources, custodian of records & decisions), rendered as a digital agent. It is the feature that crystallizes the **Community vs Enterprise** edition split:

- **Personal Secretary** — free, in Community core, does personal admin, brain is **user-editable**.
- **Company Secretary** — paid, supplied by the proprietary `ee/` module, does org admin, brain is **locked**.

The guiding principle stays AIMEAT-native: **prompt-driven, AI-agnostic, runs on the user's own key, user sees everything before it acts.**

---

## 2. The key insight — this is mostly wiring, not new machinery

The Secretary rides primitives that already exist. The plan's job is to *compose* them, not rebuild them.

| Secretary need | Existing primitive | File(s) |
|---|---|---|
| The "brain" (directives) | **Three-layer directives** (system+owner+agent), already merge-aware | `routes/agent-directives.ts`, `models/agent-directives-schemas.ts` |
| Autonomous tick on the user's key | Scheduler **`ai` job kind** → `completeForOwner` (server-side, owner key, offline-capable) | `services/scheduler.ts:450`, `services/ai-completion.ts` |
| Cost guard / stop-spending | Scheduler **constraints** (`daily_limit`/`max_runs`/`budget`) + `evaluateConstraints`/`applyAfterRun` | `services/schedule-constraints.ts`, `scheduler.ts:276` |
| Calendar / recurring schedule | Schedules API + scheduler | `routes/schedules.ts`, `services/scheduler.ts` |
| Action items | Agent tasks (`materialiseAgentTask`, wake fan-out) | `routes/agent-tasks.ts`, `scheduler.ts:615` |
| Inbox (Draft/Ask delivery) | Human↔human messaging + inbox agent capabilities (fill-in commands) | `routes/messages.ts`, `routes/agent-messages.ts` |
| Filing system / knowledge substrate | **Organisms + workspaces** (AI-designed; company = elevated organism) | `routes/organisms.ts`, `mcp` organism/workspace tools |
| Refined knowledge / decision log | Memory + **memory contracts** (reactive, self-describing) | `routes/memory.ts`, `routes/tracked-responses.ts` |
| Doc/image intake → structure | Storage upload + classify | `routes/storage-files.ts`, `services/*-classify.ts` |
| Reminders | Push service | `services/push.ts`, `scheduler.notifyOwner` |
| Scope surface | `MCP_SCOPE_PROFILES` / `scopesForProfile()` — add `secretary` + `secretary-enterprise` | `mcp/catalog/scopes.ts` |
| Enterprise gating | **`EnterpriseProvider` seam** (drop-in `ee/`, DI context, stub fallback) | `enterprise/provider.ts`, `enterprise/loader.ts`, `server-bootstrap/routes-loader.ts:407` |

---

## 3. Identity & topology

- **The Secretary IS a GAII agent**: `secretary#<owner>@<node>`. It reuses agent records, trust, telemetry, heartbeat, the agents tab.
- **Auto-provisioned** when OpenRouter is configured for the owner (no device-auth dance) — special-cased: pinned in the header, **not listed** in the public catalogue/directory, "trust" presented as **self-facing reliability** (did-what-it-said + decision score), not marketplace reputation.
- **Topology:** exactly one **personal** Secretary per GHII (brain editable) + one **company** Secretary per active org, attached to the **GOII**, brain **locked**, capabilities supplied by `ee/`. Personal and company memory never mix.
- **Scopes = "freedom of movement":** Community grants the conservative `secretary` set; the Enterprise brain attaches the `secretary-enterprise` superset (§9).

---

## 4. The brain — two layers, mapped onto existing directives

The directives system is already `system` (config, immutable) + `owner` + `agent` (merge-aware). The Secretary brain reuses this exactly:

1. **Persona / philosophy (prose)** — authored via the onboarding interview (§5): stored as the **agent-layer** directives for the Secretary GAII. Versioned.
2. **Policy (structured, machine-readable)** — a new structured block on the directives record: per-capability **band** (`act`/`draft`/`ask`/`off`), budgets, the `stopSpending` flag, and active goal refs. **The scheduler reads this, never the prose.** Generated-as-a-proposal, **UI-confirmed** (it spends money / takes irreversible action, so it must not live in free text the LLM paraphrases).

**Company secretary:** the `ee/` module contributes a **locked directives layer** (a new `source: 'enterprise'` in the merge, ranked above owner/agent and read-only in the UI). The employee gets a read-only view to understand behavior; cannot edit either layer.

**Brain change = a logged decision** (feeds the measurability loop in §7).

---

## 5. Onboarding interview → brain + self-organism ("hiring" the Secretary)

When the Secretary is taken into use, it runs a **single onboarding interview** that seeds everything. **Two modes:**
- **Prompt-driven (external):** the app generates an interview prompt; the user runs it in their own AI chat (Claude/ChatGPT/Grok) and brings the result back. Free, AI-agnostic.
- **In-app (OpenRouter):** the same interview runs inside AIMEAT via `completeForOwner` for users who'd rather not leave the app.

**The interview asks only about the user's needs, goals, and work — never about organisms/workspaces or any internal mechanic.** From that one interview the AI produces:

1. **The brain** — persona/prose directives (§4) + a proposed policy block (UI-confirmed).
2. **A self-organism + workspaces** — the Secretary's filing system. The AI **designs and creates** an organism (named to fit the user's model) and the workspaces under it, deciding *what each holds, why it's needed, and how to organize information efficiently* — all derived from the interview, none of it surfaced as a structural question to the user.

**Core principle (record it):** *the user is interviewed about needs; the AI silently translates needs → structure.* The Secretary then **expands and restructures its organism freely** as needs evolve — that is exactly what organisms are for. This self-organism is where the Secretary organizes and retrieves what's relevant to its purpose in each situation.

**Company side falls out for free:** a company already *is* an elevated organism (GOII), so the company Secretary operates over the org's organism/workspaces — no new concept, just the locked-brain Secretary pointed at the org organism instead of a personal one.

Organism content stays owner-keyed per the existing invariant (content keyed `organism.{id}.*`, owned by the member's GHII; the Secretary GAII acts on behalf).

---

## 6. Autonomy bands & the cost guard

### Bands (per capability, in the policy block)
- **Act** — do it, write a Home-feed entry.
- **Draft** — prepare it, send the owner an inbox message ("ready, approve?").
- **Ask** — send the owner an inbox **decision card** (options form); the owner answers asynchronously.
- **Off** — capability disabled.

The inbox makes Ask/Draft **asynchronous** — the backend tick never blocks; it *corresponds* with the owner (`secretary#you@node` → owner GHII). Messaging **you** is always allowed (it's the channel); messaging a **third party** is itself a gated capability (defaults Draft/Ask, and the scope is Enterprise-only — §9).

**Community default = Draft/Ask-heavy** ("rajattu liikkumavapaus"). **Enterprise brain unlocks more Act** for company-admin drudgery.

### Cost guard (two layers, both on existing constraint machinery)
- **Soft:** each autonomous capability has a band + optional per-day token/morsel cap → expressed as schedule **constraints** (`daily_limit`/`budget`). When a cap trips, `evaluateConstraints` already skips the run and can auto-disable + push-notify.
- **Hard:** a single **"Stop spending / Pause autonomous actions"** flag in the policy block. The scheduler checks it at the **top of every tick** (alongside the existing overlap/constraint guards in `executeJob`); when set, every capability degrades to Ask/Draft-only — the Secretary can still think, draft, and message the owner, but spends no morsels and makes no third-party/paid-token actions, and it reports what it *would* have done.

**Promise to the user:** nothing automatic ever costs anything they didn't switch on, and one click kills it immediately.

---

## 7. Execution model (hybrid) & the learning loop

### Hybrid execution
- **Interactive (frontend):** a Secretary "mode" reached from Home — chat (text + image upload), the Home **feed** (what it did), and the **calendar** (recurring + upcoming). Cortex-style orchestration over the generic APIs; honors the no-SSR rule.
- **Autonomous (backend):** a new scheduler job kind **`secretary`** (a specialization of the existing `ai` kind). The tick runs on a **fixed cron with a cheap "anything to do?" pre-check** (avoids burning tokens on idle ticks). Each working tick: load the brain (merged directives) + active goals + relevant context from the self-organism → run `completeForOwner` on the owner's key → the model proposes actions → the band policy routes each proposed action to Act / Draft / Ask / Off. Reuses `executeAiJob`'s budget-gated owner completion and the constraint guards verbatim.

### Learning loop — Goals → Decisions → Outcomes
- **Goals** are foundational ("mihin pyrit"). A **lightweight standalone goal record**; tasks/schedule/decisions reference a goal.
- **Decision log** as a **memory contract** (self-describing, reactive — preferred over a new table per `docs/coding-guidelines/memory-contracts.md`): `{ decision, goalRef, options[], chosen, rationale, expectedOutcome, actualOutcome?, score?, status }`.
- **Measurability:** the record stays **open** after the choice. A scheduled Secretary review (its own recurring job) revisits each open decision, records actual-vs-expected, scores it → a decision-quality signal *and* training for which recommendations the user accepts / that pan out. Without the revisit step it's a list, not a loop.

---

## 8. Decision cards (inbox payload)

The **Ask** band delivers a **decision card**: a **new typed message kind carrying a memory-contract reference** (resolved decision #1). The inbox renders the card's options as a form (extends the existing inbox fill-in-command pattern); answering writes the choice back into the decision-log contract, which the Secretary then acts on. Draft approvals use the same channel with a simpler approve/edit/reject payload.

---

## 9. Scope surface (Community vs Enterprise)

Two independent controls: **scopes = the surface the Secretary may touch**; **bands + budget = autonomy/cost**. Even where Community holds a scope, anything outbound/costly/destructive defaults to Ask/Draft. New profiles added to `MCP_SCOPE_PROFILES` (`mcp/catalog/scopes.ts`):

**`secretary` (Community personal):**
```
memory:read, memory:write, memory:delete,   // its own organism/workspaces + the user's knowledge
storage:read, storage:write,                // image/doc intake
messages:read,                              // triage the inbox (messaging the owner is ungated already)
workflow:read                               // understand existing automations
```

**`secretary-enterprise` (superset — adds the unlocked "freedom of movement"):**
```
messages:send,                       // originate DMs to third parties / customers
work:read, work:request, work:accept,// read the org work queue + transact in the marketplace
workflow:write,                      // build & run automations
wallet:read,                         // see balances for invoicing/finance
social:read, social:write,           // post to org boards / community
consent:manage,                      // manage org consent grants
events:emit                          // trigger ecosystem automations
```

**Resource discovery needs no scope.** Verified: the catalogue (`/v1/catalogue`, `/agents`, `/directory`, `/:actionId`, `/search`), the capabilities router, and the matching engine (`routes/matches.ts`) are **ungated** (public, no `requireScope`). So the personal Secretary can browse agents, offerings, and other corporations' services *for free* — discovery is a first-class capability requiring nothing. Only **acting** on a find (invoking/transacting an offer → `work:request`) is gated, which is Enterprise + Ask-band. `work:read` gates the work-queue *inbox* (incoming jobs), not discovery — hence it sits in the Enterprise set, not Community.

Notes: `memory:delete` is in Community but **defaults to the Ask band** (destructive); third-party `messages:send` is deliberately **not** in Community (it leaves the user's boundary); dev scopes (`cortex:write`, `ext:write`, `foundry:*`, `generator:*`) are excluded from both — not secretary work. Starting proposal; the exact line is the developer's to nudge before Phase 6.

### Resource finder (first-class capability, both editions)
Given the user's goals/needs, the Secretary searches the catalogue + directory and runs the matching engine to surface **useful agents and other corporations' offerings** that advance an intent. Personal: discover → suggest (Draft/Ask before engaging). Enterprise: may transact (`work:request`). This is how the Secretary answers "what's out there that helps achieve this goal?" — grounded in `routes/catalogue.ts`, `routes/matches.ts`, `services/matching.ts`. (Once the master directory `GET /v1/discover` lands — see `docs/internal/2026-06-23-master-directory-discovery-design.md` — the finder uses that unified endpoint instead of fanning out per-domain.)

### AIMEAT guidance & guided actions (first-class capability, both editions)
The Secretary teaches the user how to use AIMEAT, and — with approval — does the work and shows the result. Two modes:

- **Teach.** Answer "how do I do X?" / "help me get to know AIMEAT" by **retrieving from existing material** and explaining in the user's context: the surface **handbooks** (`services/handbooks/{agent,appdev,admin}.ts`), the **bootstrap getting-started guide** (`routes/bootstrap.ts`), and the **managed prompts** (`/v1/prompts`). Because the Secretary has the self-organism, it knows what the user has/hasn't done and proactively suggests the next thing to learn or try.
- **Do-it-for-you (guided playbook).** The Secretary composes a **step plan** (reusing the `aimeat_task_propose_todos` pattern), presents it as an **Ask-band decision card** ("here are the steps I'll take"), and on approval **executes the steps within its scopes/bands** and shows the outcome in the Home feed. Steps that cost or leave the user's boundary still respect the bands, so the user approves the plan up front and sees the result after — "näytä lopputulos."

**Knowledge-source gap:** the existing handbooks target agents/devs/admins, not end-users learning the SPA. The teach mode's primary source should be a **new user-facing AIMEAT handbook** (a managed prompt / handbook page the Secretary reads), synthesized from the feature set + OpenAPI rather than hand-maintained where possible. Enterprise extends this with company-admin how-to (invoicing, member management, compliance) from the `ee/` capability set.

---

## 10. Enterprise seam extension

Today `EnterpriseProvider` only `mountRoutes(app)`. Add a **capability registry** so `ee/` contributes Secretary capabilities + the locked directives layer, not just routes:

```ts
interface EnterpriseProvider {
  name: string; version: string;
  mountRoutes(app): void | Promise<void>;
  // NEW (additive, optional — stub returns empty):
  secretaryCapabilities?(): SecretaryCapability[];            // company-admin tools
  secretaryDirectives?(orgId: string): DirectiveLayer | null; // the locked brain layer
  secretaryScopes?(): string[];                               // the secretary-enterprise superset
}
```

Core ships the registry + the personal capability set; the stub returns nothing extra (Community runs fully). `ee/` (separate private repo `github.com/miikkij/aimeat-enterprise`, its own version line) registers company-admin capabilities (invoicing prep, member coordination, compliance/KYB reminders), the locked directives layer, and the enterprise scope set. Company Secretary attaches to the org via the **reused `org.{id}` consent grant** (resolved decision #4). Wired at `routes-loader.ts:407` where the provider is already loaded.

### Company model (real-world organisation structure)
The Enterprise Secretary maintains, in the **company organism's workspaces**, a model of the **real-world organisation** — departments, roles, reporting lines, and people *who are not AIMEAT users at all*. Most of a company isn't on AIMEAT, but having the structure is what lets the Secretary understand the business and act on it sensibly *from the AIMEAT agents' point of view* (who owns what, who to route a decision to, which department a cost belongs to). Built/maintained via the same interview + AI-shaping mechanism as the personal self-organism (§5), seeded from the company side. This is an `ee/` capability — Community has no company-model concept.

### Financial governance & KPI/ROI (the CFO-facing wedge)
Motivated by 2026 C-suite research (`secretary_kpi.log`): **AI cost accountability is now a board-level mandate, ROI-per-investment is demanded, and the CFO is the emerging AI buyer who wants financial-language reporting.** The Enterprise Secretary is positioned as that **CFO-ready cost & ROI governance layer**:
- **Cost in financial terms:** surface AIMEAT agent spend as cost-per-task / cost-per-outcome / per-department, not raw tokens — built on the existing usage/morsel/telemetry data.
- **Agent-level ROI attribution:** tie each agent's spend to a goal/decision, so the decision-log loop (§7) *is* the ROI mechanism — decisions scored against expected outcomes produce cost-per-outcome evidence the board wants.
- **Spend governance:** the cost guard / budgets / stop-spending (§6) are exactly the "per-agent spend caps" the research calls for — already in the design, now framed as a finance feature.

This is the commercial justification for the paid tier: the personal Secretary saves *you* time; the company Secretary gives the *CFO* cost accountability and ROI proof.

---

## 11. Frontend surfaces

- **Header button** (heart-shield + quill icon), shown when OpenRouter is configured. New importmap entry if a new shared module.
- **Onboarding flow:** the "hire" interview (external-prompt or in-app OpenRouter), then a brief review of the proposed brain + (silently created) self-organism.
- **Home:** Secretary card → feed (Act log) + upcoming/recurring calendar; re-fetch on `aimeat-live-update`.
- **Secretary view:** chat (text + image), brain editor (prose via prompt workflow + policy toggles), goals, decision log.
- **Inbox:** Draft approvals + Ask **decision cards** (typed message payload rendered as an options form).
- All `pf-`/view-prefixed CSS, `t()` strings (en+fi), button classes per Rule 8.

---

## 12. License / IP

- Core stays **MIT** (© Jouni Miikki) — including the Secretary shell, personal capabilities, the seam, and the UI.
- The `ee/` repo carries its **own proprietary LICENSE** (© Jouni Miikki & Overscale Solutions Oy) + EE source-file headers.
- Add a short **`LICENSING.md`** in core documenting the open-core boundary and pointing at `src/enterprise/`. No re-licensing of community code (that's the point of open-core).

---

## 13. Phased build

Each phase ends with E2E (Rule 1: targeted SQLite suite incl. ≥1 failure mode) and, for frontend, Playwright-MCP browser verification (Rule 1b). OpenAPI (Rule 3) + i18n (Rule 4) + headers (Rule 2) updated in the same commit. No phase ships company features in the MIT repo.

- **Phase 0 — Identity & provisioning.** Secretary GAII auto-provisioned on OpenRouter config; special-casing (pinned, unlisted, reliability label); the `secretary` scope profile. Header button. *Verify: button appears/disappears with the key; agent shows in agents tab with the right scopes.*
- **Phase 1 — Onboarding interview → brain + self-organism.** The "hire" flow: interview (external-prompt or in-app OpenRouter) → AI writes the brain (agent-layer prose directives) **and** designs+creates the self-organism + workspaces (no structural questions to the user). Policy block + UI band toggles + versioning. *Verify: a full interview round-trip produces a populated brain and a sensibly-structured organism; flip bands; rollback the brain.*
- **Phase 2 — Interactive shell + resource finder + teach.** Secretary view + chat (text+image intake → structured into the self-organism) + Home feed + calendar + the resource finder (catalogue/directory/matching search against the user's goals; suggest via Draft/Ask) + **AIMEAT guidance (teach mode)** drawing on handbooks/bootstrap/prompts (+ the new user-facing handbook). *Browser-verify the real interactions, incl. a goal-driven discovery and a "how do I do X?" answer grounded in real material.*
- **Phase 3 — Inbox bands + guided playbooks.** Draft approvals + Ask decision cards (typed message kind + contract ref + options form); third-party-send gating; **do-it-for-you guided playbooks** (propose steps → approve card → execute within bands → show result). *Verify: a Draft, an Ask, and an approved multi-step playbook round-trip end to end.*
- **Phase 4 — Autonomous tick + cost guard.** New `secretary` scheduler kind with the "anything to do?" pre-check; soft constraints; hard stop-spending flag checked per tick. *Verify: tick produces feed/inbox items; stop-spending instantly degrades to Ask/Draft and spends nothing; budget cap auto-pauses + notifies.*
- **Phase 5 — Learning loop.** Goal records; decision-log memory contract; scheduled review that scores open decisions. *Verify: a decision opens, gets revisited, scores.*
- **Phase 6 — Enterprise seam + company secretary.** Extend `EnterpriseProvider` with the capability registry + locked directives layer + `secretary-enterprise` scopes; implement the company Secretary (over the org organism, attached via the `org.{id}` consent grant) + first company-admin capabilities in `ee/`: the **company model** (real-world org structure in workspaces) and **financial governance / KPI-ROI** reporting (cost-per-task/outcome, agent-level ROI attribution, spend caps). *Verify: Community (stub) runs unaffected; with `ee/` dropped in, company Secretary appears with a read-only locked brain, the expanded scopes, a populated company model, and a CFO-facing cost/ROI surface.*

---

## 14. Resolved decisions (from the 2026-06-23 discussion)

1. **Decision-card payload:** new typed message kind carrying a memory-contract ref. ✅
2. **Goals:** lightweight standalone record; memory contract for the decision log. ✅
3. **Autonomous tick:** fixed cron + cheap "anything to do?" pre-check. ✅
4. **Company secretary scope grant:** reuse the `org.{id}` consent grant from the enterprise design. ✅
5. **Community vs Enterprise scope sets:** proposed in §9 (`secretary` / `secretary-enterprise`). Corrected: `work:read` is a work-*queue* scope, not discovery — moved to Enterprise; **resource discovery (catalogue/directory/matching/capabilities) is ungated**, so the personal Secretary discovers for free. Developer to ratify the exact line before Phase 6.

### Still to pin down as phases land
- Self-organism: a fixed minimal workspace skeleton the AI fills, or fully AI-shaped each time? (Lean: AI-shaped, with a tiny safety floor so a sparse interview still yields a usable structure.)
- Where the autonomous-tick cron lives relative to provisioning (created at hire, paused until the user enables a band).
- Exact reliability score formula (did-what-it-said + decision score weighting).
- User-facing AIMEAT handbook: a hand-written managed prompt/handbook page, or auto-synthesized from the feature set + OpenAPI (kept current automatically)? (Lean: auto-synthesized with a curated spine, so it never drifts from the actual API.)
