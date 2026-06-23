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
| Inbox (Secretary↔owner correspondence) | **Agent↔owner direct messaging** — the Secretary is a GAII, so it messages its owner here (ungated) + inbox fill-in commands. Human↔human `messages.ts` is only for third-party DMs (Enterprise) | `routes/agent-messages.ts`, `routes/messages.ts` |
| Filing system / knowledge substrate | **Organisms + workspaces** (AI-designed; the organism is core/free, its *commerce-elevation into a company* is the `ee/` layer — §10) | `routes/organisms.ts`, `mcp` organism/workspace tools |
| Resource discovery (the sensory organ) | **Master directory `aimeat_discover`** — one query across all domains (live, node ≥1.32.0) | `routes/discover.ts`, MCP `aimeat_discover` |
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

**Core operating principle in the prose layer:** *scout before you build.* Before the Secretary builds, delegates, or spins up structure for any goal, it runs the master directory (`aimeat_discover`, §9) — map first, then find — and reuses what already exists. This is a standing instruction in every Secretary brain.

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

**Company side reuses the same substrate (but the company-ness is the paid layer):** the *organism* primitive is core/free, but **elevating** it into a company — the GOII identity (`org:{slug}@{node}`), commerce (offerings/orders/revenue split), financials, and the `/v1/orgs` namespace — is exactly what the proprietary `ee/` module adds (§10; this is the org-commerce layer already built as the EE experiment). So the company Secretary is an `ee/`-supplied, locked-brain Secretary pointed at the org's organism/workspaces. The *substrate* is shared core; the *company elevation* and the *company Secretary* are both the paid layer.

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

**Read-only discovery is the exception:** `aimeat_discover` (§9) is permanently **Act** and **immune to stop-spending** — it costs nothing and reads only, so the Secretary always scouts freely; only *acting* on what it finds is band-gated.

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

### Resource finder via the master directory `aimeat_discover` (first-class capability, both editions)
The Secretary's **primary sensory organ**. The master directory (`aimeat_discover` MCP tool; REST `GET /v1/discover` + `/v1/discover/facets`) is a single query across **all** domains — capabilities, workflows, knowledge, decisions, research, materials, companies + their offerings, documents, organisms, apps, memory — replacing ~20 per-domain searches. **Already live (node ≥1.32.0, `aimeat-crewai` ≥0.10.0); the Secretary only uses it, nothing to build in core.**

**Operating principle (bake into the brain — see §4/§5): _before the Secretary builds or delegates anything, it asks "what already exists that I can use?"_** The standard move per Goal:
1. **Map first (cheap):** `mode:"map"` (or `/v1/discover/facets`) — see what *types* and tags exist and how many, before fetching content. A token-cheap probe.
2. **Find targeted:** `mode:"find"` + `q`/`type`/`tags` → ranked hits. Goal "do X" → look for existing `capability`/`workflow` that already does it; goal "find out Y" → `knowledge`/`research`/`decision`/`document`.
3. **Use the find:** invoke the found capability / run the found workflow / read the found knowledge — don't build new when a fit exists.

Concrete ties to the rest of this design:
- **Always-Act, free.** `discover` is read-only and spends no morsels → it lives permanently in the **Act** band and is **never blocked by stop-spending**. Only *acting* on a find (invoking/transacting → `work:request`) passes through Draft/Ask. So the Secretary may scout freely without permission; only the action is gated.
- **Goals → decision-log loop (§7):** when taking a goal, the Secretary first discovers prior `decision` logs + `research`/`material` on the same topic → continues where it left off instead of repeating work.
- **Self-organism / crew assembly (§5):** before defining new structure or specialist agents, discover existing `capability`/`offering`/`workflow` pieces and wire them in.
- **Company Secretary:** use `scope:"shared"` + `type:"company,offering,document"` to see the org organisms' shared (workspace-gated) content, not just its own. `scope:"own"` needs `memory:read` to see the full owner set; `scope:"public"` is the whole node's public surface.

Design ref: `docs/internal/2026-06-23-master-directory-discovery-design.md`.

### AIMEAT guidance & guided actions (first-class capability, both editions)
The Secretary teaches the user how to use AIMEAT, and — with approval — does the work and shows the result. Two modes:

- **Teach.** Answer "how do I do X?" / "help me get to know AIMEAT" by **retrieving from existing material** and explaining in the user's context: the surface **handbooks** (`services/handbooks/{agent,appdev,admin}.ts`), the **bootstrap getting-started guide** (`routes/bootstrap.ts`), and the **managed prompts** (`/v1/prompts`). Because the Secretary has the self-organism, it knows what the user has/hasn't done and proactively suggests the next thing to learn or try.
- **Do-it-for-you (guided playbook).** The Secretary composes a **step plan** (reusing the `aimeat_task_propose_todos` pattern), presents it as an **Ask-band decision card** ("here are the steps I'll take"), and on approval **executes the steps within its scopes/bands** and shows the outcome in the Home feed. Steps that cost or leave the user's boundary still respect the bands, so the user approves the plan up front and sees the result after — "näytä lopputulos."

**Knowledge-source gap:** the existing handbooks target agents/devs/admins, not end-users learning the SPA. The teach mode's primary source should be a **new user-facing AIMEAT handbook** (a managed prompt / handbook page the Secretary reads), synthesized from the feature set + OpenAPI rather than hand-maintained where possible. Enterprise extends this with company-admin how-to (invoicing, member management, compliance) from the `ee/` capability set.

### Using extensions as tools (first-class capability, both editions)
Verified: **invoking** an extension action (`POST /v1/ext/{name}/{action}`, MCP `aimeat_extension_invoke`) requires only auth — **no scope** — and reading `ext:` public data is open. So the Secretary can *use* installed extensions/connectors as tools (fetch from a data source, run an action) freely, and read their cached `ext:` data via `aimeat_discover`/memory. Only extension **lifecycle** (`activate`/`deactivate`/instance config, which needs `ext:write`) stays **out of Community** — a Draft/Ask or Enterprise concern. This is how the §17 connectors (Vainu/Alma) become live tools for the Secretary, not just template dependencies.

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
- **Phase 1 — Onboarding interview → brain + self-organism.** The "hire" flow: interview (external-prompt or in-app OpenRouter) → AI writes the brain (agent-layer prose directives, including the standing **scout-before-build** instruction to map→find via `aimeat_discover` before building) **and** designs+creates the self-organism + workspaces (no structural questions to the user). Policy block + UI band toggles + versioning. *Verify: a full interview round-trip produces a populated brain and a sensibly-structured organism; flip bands; rollback the brain.*
- **Phase 2 — Interactive shell + resource finder + teach.** Secretary view + chat (text+image intake → structured into the self-organism) + Home feed + calendar + the resource finder via **`aimeat_discover`** (map→find→use against the user's goals; suggest via Draft/Ask) + **AIMEAT guidance (teach mode)** drawing on handbooks/bootstrap/prompts (+ the new user-facing handbook). *Browser-verify the real interactions, incl. a goal-driven `aimeat_discover` map→find returning relevant hits, and a "how do I do X?" answer grounded in real material.*
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

---

# Addendum (2026-06-23) — Specialist agents, use-case templates, extension data-sources

**Why:** A LinkedIn post from Integrata's CRO describing a "Commercial Crew Hub" (ready-made agents + data structures per use case, her "ICM model = Folder Structure as Agent Architecture", data sources Vainu/Alma + SharePoint, *security/scoped-access as the core worry*) is essentially AIMEAT described in someone else's words — ICM folders **are** the organism→workspace→memory structure. This addendum captures the design discussion that followed. **These sections extend the plan above; they do not replace it.** §3's secretary topology stays exactly as written.

## 15. Specialist agents — a new agent *type* alongside the secretaries

The Secretary machinery (the GAII identity, the directives brain of prose + structured policy, the Act/Draft/Ask bands, the cost guard, the self-organism, telemetry/trust/heartbeat) is **already generic** — only the brain and the scopes change. So we generalize it into a reusable **specialist agent** type **without touching §3**:

- **The two secretaries stay exactly as designed** — **1 personal** secretary (the user's "best buddy" for working with AIMEAT; untouched) + **1 company** secretary (`ee/`-locked brain).
- **+ N specialist agents** *in addition*: same machinery, **swappable brain**, deliberately **not named "secretary"** to avoid confusion — `sdr#owner@node`, `prep#owner@node`, `finance#…`, `recruiter#…`. Integrata's CRO literally calls hers a "Commercial **Crew**", so "crew" / "specialist" matches the customer's own mental model.
- Specialists are **additional agents**, not a new hierarchy tier. **The Secretary orchestrates them (core, resolved 2026-06-23):** the Secretary is by design the *hub*, specialists are the *doers*. It already messages and tasks its owner — orchestration just extends that to the owner's **other agents**: the Secretary delegates a sub-goal to a specialist by **creating an agent task** for it (the same `materialiseAgentTask` wake path) and/or messaging it, tracks the result, and folds it back into the feed + decision-log. For multi-step crews it composes/runs an **Agent Workflow** (existing engine) chaining specialists. This is **not** a "head secretary" tier — §3 topology is unchanged; it's agent→agent delegation the Secretary can already do. Delegation that spends (the specialist burns tokens/morsels) is **band-gated** like any other action (Draft/Ask, or Act where the brain allows). A specialist can still be driven directly by the user; Secretary-coordination is one path, not a requirement.
- A specialist is **what a use-case template instantiates** (§16). Its brain (directives + policy + scope profile) comes from the template; the user can then edit it like any agent brain.

**Build impact:** mostly factoring the secretary's brain/band/self-organism mechanics so a second agent type can reuse them. No new economy, scheduler, or directives machinery.

## 16. Use-case templates — packaged organism blueprints (pure data, not code)

A **use-case template** is what the CRO actually wants to "buy": not primitives, but a *ready-made hub*. In AIMEAT terms it is a **packaged, importable organism blueprint**:

| Template part | AIMEAT primitive | Status |
|---|---|---|
| Workspace skeleton + each one's purpose/schema (the "ICM folders") | organism export bundle (`organism.json` + `workspaces/{ws}/…`) | ✅ substrate exists |
| Specialist brains (e.g. SDR persona, meeting-prep persona) | agent directives (prose + policy) | ✅ §4/§15 |
| Bound data sources (Vainu, Alma) | extension dependencies + their config schema | ⚠️ connectors don't exist yet (§17) |
| Scope / consent presets | `MCP_SCOPE_PROFILES` + consent grants | ✅ |
| Data shape / rules | CSM/MSM schema locks | ✅ |
| Ready-made prompts | managed prompts (`/v1/prompts`) | ✅ |

**Architectural rule it must obey — a template is DATA, never code.** This respects the no-SSR / no-per-service-backend rule absolutely: a "B2B Sales Hub" template is **not** `portal-sales.ts`; it is an export blob + directives + extension references that a **single generic import route** loads. Nothing sales-specific enters the backend. This is exactly what makes the idea AIMEAT-native rather than a bolt-on.

**Substrate already exists:** `aimeat/src/services/organism-export.ts` already produces a ZIP (`organism.json` = settings + workspace index; `workspaces/{ws}/workspace.json` = content + `images/`); organism export/import MCP tools exist. There is no "template" concept *yet* — the work is to (a) extend that bundle format to also carry specialist directives + extension dependency refs + scope presets, and (b) add a generic **"instantiate template"** flow.

**Template bundle format (resolved 2026-06-23):** a template is **the organism-export ZIP with content stripped — manifest/skeleton only.** Reuse `exportOrganism` in a `skeleton` mode: `organism.json` (settings + workspace index) stays as-is; each `workspaces/{ws}/workspace.json` is **reduced to its schema/purpose only** (no objects, rows, or images — just the shape and what the folder is for); and a new top-level **`template.json`** carries the template extras — specialist directives, extension dependency refs, scope presets. So the format is *literally the existing bundle minus data, plus one manifest file* — no new serializer. Import = the existing organism-import builds the empty organism + workspaces from the skeleton, then the instantiate flow adds the specialists, checks the extension deps, and applies the scope presets. (The content-less export is also safe to publish/discover — no tenant data ever rides in a template.)

**Reconciles with §5 (no tension):** §5 has the AI *design* the self-organism from an interview; templates supply a *curated starting blueprint*. These are layers, not opposites — the template is the "tiny safety floor" §5/§14 already calls for, and the secretary/specialist then expands it. So the §5 onboarding mechanism is **generalized**: it can **seed from a template** instead of (or before) the interview.

**Templates are themselves a discovery artifact.** Because a template is data and AIMEAT already has the catalogue + `GET /v1/discover` (already live) + organism import, a template can be a *discoverable, installable* artifact — register a `templates` DiscoverySource, no new machinery. "B2B Sales Hub (FI/SE)", "Recruiting Hub", etc. become published, importable blueprints.

## 17. Extension data-sources (Vainu/Alma) — consumer-agnostic, with self-healing deps

**Extensions are the data-source layer** (the CRO's Vainu/Alma). An extension is just (a) a producer of `ext:{name}` data + (b) a callable action; it is **consumer-agnostic** — you build it once and *all* of these share it, so the "who is this for?" question dissolves:

| Consumer | How |
|---|---|
| Agents / specialists | MCP `aimeat_extension_invoke` → `POST /v1/ext/{name}/{action}` |
| Scheduled cron sync | manifest `schedules:` — **no agent involved** (the "continuously fetches X" mode) |
| Agent Workflow pipeline step | a pipeline stage calls the action |
| Cortex / app frontend | reads `ext:` public memory + calls actions to render UI panels |
| Another extension | `ctx.memory.getPublic('ext:other', key)` |

Two modes, **both first-class:** **pull-on-demand** (a consumer calls the action when it needs fresh data) and **push/scheduled** (a cron keeps `ext:` memory warm; consumers read the cache — which also cuts paid-API cost and ToS exposure). A good connector ships both: an action + an optional schedule.

**Missing connector = a covered state, not a blocker.** A template declares its extension dependencies. If `ext:vainu` isn't installed, the template surfaces the dependency and **generates a build prompt** → the user pastes it to Claude Code (or any agent) → it **builds + installs the connector over the appdev MCP** (`aimeat_extension_install`) → the dependency is satisfied. This is the prompt-driven workflow applied to extensions themselves; "extension not present yet" is self-healing.

**Connector feasibility (assessed against the code):** technically straightforward — QuickJS sandbox, `ctx.fetch()` outbound (SSRF-guarded), `ctx.memory.set/getPublic`, `export default async function(ctx, input)`, manifest with `actions` + `schedules` + `instances.config_per_instance`. The **real** barriers are non-technical and must be settled *before* writing a connector: (1) **ToS / redistribution** — Vainu and Alma are paid contract APIs; caching their data in *public* `ext:` memory on a multi-tenant node is likely contract-forbidden → lean **"bring your own key" per tenant** (`instances.config_per_instance`), not a node-global key; (2) **per-tenant credentials**, never node-global.

## 18. Secret config for connectors — wire to the existing encryption, don't build new

Storing a paid API key (Vainu/Alma) needs encryption at rest — and AIMEAT **already has it**; this is wiring, not a new primitive (and **not** a known-gap item):

- **Mechanism exists:** `aimeat/src/services/encryption.ts` — AES-256-GCM `encrypt()/decrypt()/getEncryptionKey()`, format `iv:authTag:ciphertext`, node-level master key `AIMEAT_ENCRYPTION_KEY` (fallback `AIMEAT_TOTP_ENCRYPTION_KEY`).
- **Proven pattern to copy = the OpenRouter key, NOT the generator backend:** `routes/openrouter.ts` encrypts on write → stores owner-memory `openrouter.apikey = { encrypted }` → decrypts on read (`services/ai-completion.ts`). (The generator *backend* currently stores plaintext — encryption was removed there — so do **not** model on it; the generator *UI's* `type:'secret'` field concept in `generator-settings.js` is the marker model, but the encrypting route is OpenRouter's.)
- **The only delta to wire:** (1) manifest config-field gains a `type: secret` marker (mirroring the generator UI's `type:'secret'`); (2) the extension install/update route encrypts those fields via `encryption.ts` exactly like `openrouter.ts` (today `routes/extensions.ts` stores `ExtensionRecord.config` plaintext); (3) `services/extension-runtime.ts` decrypts them before passing `ctx.config` into the QuickJS VM.

Note: the master key is **per-node**, not per-owner — secrets are still owner-scoped in memory, but encrypted with the node key. A tenant's "own Vainu key" is the *plaintext value*; it is encrypted with the node key at rest.

## 19. Phased-build additions (extend §13)

These ride the existing phases and the discovery/organism substrate; no phase ships company features in the MIT repo (§12 unchanged).

- **S-A — Specialist agent type.** Factor the secretary brain/band/self-organism machinery into a reusable specialist type; a specialist GAII (`sdr#owner@node`) with its own brain + scope profile, listed in the agents tab. *Verify: create a specialist with a distinct brain; its bands/cost-guard behave like the secretary's; it does not collide with the personal secretary.*
- **S-B — Use-case template format + instantiate flow.** Extend the organism-export bundle to carry specialist directives + extension dependency refs + scope presets; a generic "instantiate template" route that creates the organism + workspaces + specialists, and reports unmet extension deps. *Verify: import a template → organism + specialists materialize; an unmet dep is reported, not a crash.*
- **S-C — Connector pattern + secret wiring (§18).** Wire `type: secret` manifest fields through `encryption.ts` (encrypt on install/update, decrypt in the runtime); ship one reference connector behind "bring your own key" per instance, with both an action and an optional cron sync. *Verify: a secret round-trips encrypted (never plaintext in storage); an action call and a scheduled sync both populate `ext:` memory; SSRF guard rejects internal hosts.*
- **S-D — Missing-dep self-heal + template discovery.** The unmet-dependency → generated build-prompt → appdev-MCP install loop; register a `templates` DiscoverySource so blueprints are findable. *Verify: a template with a missing connector yields a working build prompt; templates appear in `GET /v1/discover`.*
- **Reference template — "B2B Sales Hub (FI/SE)"** as data: a sales organism skeleton + SDR & meeting-prep specialist directives + Vainu/Alma connector dependency refs. The end-to-end proof of the whole addendum.

## 20. Resolved/added decisions (extend §14)

6. **No "head secretary" rename.** §3 topology is unchanged (1 personal + 1 company). Specialists are an *additional* agent type, not a re-org of the secretaries. ✅ (user, 2026-06-23)
7. **Specialists are not called "secretary"** — `sdr#`/`prep#`/… naming to avoid confusion; "crew"/"specialist" matches the customer's mental model. ✅
8. **Templates are data, loaded by a generic import route** — never per-service backend code (no-SSR rule). ✅
9. **Extension secret storage reuses `encryption.ts` (OpenRouter pattern)** — wiring, not a new primitive, not a known-gap. ✅
10. **Connectors to paid third-party data (Vainu/Alma) default to "bring your own key" per tenant** (`instances.config_per_instance`), pending each provider's ToS/redistribution terms — settle the contract question before building a specific connector. ✅
11. **Template bundle = the organism-export ZIP with content stripped (manifest/skeleton only) + a `template.json`** (specialists + ext-dep refs + scope presets). Reuse `exportOrganism` in a skeleton mode; no new serializer. ✅ (§16)
12. **The Secretary orchestrates specialists/the user's other agents — core, not deferred.** Agent→agent delegation via agent tasks + messaging (+ Agent Workflows for chains), band-gated, no new "head secretary" tier (§3 unchanged). ✅ (§15)
13. **Connector-secret isolation is a product tier, not extra crypto:** shared multi-tenant nodes use node-key encryption + bring-your-own-key where ToS requires; tenants needing stronger isolation **buy a dedicated managed instance** (Overscale-hosted). Don't build per-tenant key vaults on shared nodes. ✅

### Still open (addendum)
- *(none — the three prior open items resolved as decisions 11–13 above.)*

---

## 21. Capability-surface coverage — does the Secretary reach all of AIMEAT?

Honest answer: the *machinery* (generic APIs + `aimeat_discover` + bands + self-organism) can reach everything, but a few capability *domains* weren't explicitly named. This sweep maps AIMEAT's user-facing surface against the design and closes the gaps.

| AIMEAT domain | In the design? |
|---|---|
| Memory | ✅ self-organism substrate (§5) |
| Storage / files | ✅ doc/image intake (§2) |
| Tasks (+ `propose_todos`) | ✅ action items, guided playbooks (§7,§9) |
| Schedules | ✅ calendar + autonomous tick (§7) |
| Messaging (agent↔owner) | ✅ correspondence + decision cards (§8) |
| Organisms / workspaces | ✅ self-organism, company model (§5,§10) |
| Discover / catalogue / matching | ✅ sensory organ, scout-before-build (§9) |
| Capabilities — invoke | ✅ resource finder acts on finds (§9) |
| Workflows | ✅ read (Community) / build+run (Enterprise) |
| Extensions — invoke + `ext:` read | ✅ **added** — use connectors as tools (§9, §17) |
| Wallet / morsels | ✅ cost awareness; `wallet:read` (Enterprise §6,§10) |
| **Capabilities / workflows — create** | ⚠️ **added below** |
| **Knowledge base — contribute / curate** | ⚠️ **added below** |
| **Sharing groups + consent — gatekeeping** | ⚠️ **added below** |
| **Setting up the user's other agents** | ⚠️ **added below** |
| Boards / social | ◑ read for awareness; post = Enterprise (`social:write`) |
| Apps | ◑ discover + suggest installing; building/publishing is dev work (defer) |
| Flags / appeals / admin / federation | ✗ not a Secretary function (operator / user-direct / infra) |

**Corners now explicitly added** (all additive — same machinery; most need *no new scope* because the routes are ungated or owner-auth):

- **Create, don't just find.** The vision said the Secretary "katsoo onko resursseja **saatavilla tai luotavissa**." Discovery covers *saatavilla*; the *luotavissa* half = when `aimeat_discover` comes up empty, the Secretary proposes **creating** the missing piece — a capability (`capabilities_create`, ungated), a workflow, or (per §16) a whole template/specialist — as a guided playbook through the Ask band. Personal can scaffold; anything that costs or publishes is Draft/Ask (Enterprise goes further).
- **Custodian of refined knowledge.** The classic secretary role. The Secretary curates the user's knowledge base (`knowledge_contribute`/`_get`/`_links`), keeping the "jalostettu tieto" current — not only its private self-organism but the shareable knowledge graph. Read is open; contributing on the user's behalf defaults to Draft.
- **Gatekeeper of access.** The historical secretary "controls who gets in." The Secretary helps manage **who can see the user's data** — sharing groups + consent grants. Adjusting the user's *own* sharing is personal-admin (Draft/Ask); `consent:manage` as a granted scope is Enterprise (org consent).
- **Setting up the crew.** The Secretary helps the user **connect and configure their other agents** — walk through device-auth approval of a new agent, set its directives/mode/tags — as a guided playbook. This is the on-ramp to §15 specialists: the Secretary is who you ask to "hire" and brief the rest of your crew.

With these, the Secretary's reach spans the **full user-facing AIMEAT surface**; operator tooling, moderation, and federation/infra correctly stay out (not a secretary's job). The edition split and §3 topology are unchanged — these corners are capability-list + brain additions, not new architecture.
