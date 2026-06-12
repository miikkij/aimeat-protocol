# Agent Offers — "What can I do with my agents" surface

**Created:** 2026-06-12
**Status:** Design agreed, not yet built. Shared source of truth for BOTH sides:
the **AIMEAT node/dev** side (this repo) and the **crew-operator** side (crewaimeat, who runs the
agents). Build to this doc; if the offer descriptor changes, it changes HERE first.
**No time/effort estimates** anywhere (the developer finds them noise).

---

## 1. Problem

At 30+ agents the bottleneck is not capability, it's **legibility + follow-up**. Today you must: go to
each agent → learn what it does → open Tasks → hand-write a task → wait → dig into raw memory to find
the deliverable. There is no single place that says "here's what your agents can do for you," no
one-click way to ask, and no easy way to see what came back, check it, or rate it.

## 2. Concept (one noun chain)

> **Agent publishes Offers → you Ask one → system runs it (task) or hands you a prompt → the result is
> a Deliverable → you check + Rate it → the rating feeds the agent's reputation, which shows on the next
> Offer.**

An **Offer = the human-readable face of the agent's machine contract.** Contract (machine) ⇄ Offers
(human) — **one source**, also consumed by the mesh (delegate selection), never a human-only storefront.

The surface has **two halves**:
- **Do** — goal-first "what do you want to do?" → activate an agent with one Ask.
- **Inbox** — a cross-agent feed of everything that came back: status + rendered deliverable + provenance
  + a **Rating** control. This is the follow-up half that removes the agent/tab clicking.

## 3. Naming + the one decision that unblocks everything

- **Offers** (agent says) + **Ask / Request** (user does). "actions" is taken (extension actions),
  "capabilities" is taken (skills).
- **The real collision is `services`**: the Hello-Integration Services declaration (`declare_services` +
  the Services profile tab) is already a proto-offers. **DECISION: evolve `services` → `offers`.** Ship
  ONE "what I do" concept; the Services tab becomes the Offers surface. Two parallel surfaces would be
  worse than today. Existing services migrate to minimal offers (`title` + `ask`, labelled `untested`).

## 4. The offer descriptor (the contract both sides build to)

```yaml
offer:
  id: research-topic
  title: "Research a topic"
  ask: "Ask me to research anything; I return findings + sources. I don't do real-time market prices."  # incl. NEGATIVE scope
  example: "Research the EU AI Act's impact on small SaaS companies."                                     # a real sample request
  tags: [contract.research-results, role.workspace-contract]   # REUSE existing machine tags for goal-search (no new taxonomy)
  cost: cheap            # free | cheap | expensive        (token cost varies ~100× across crews)
  latency: minutes       # seconds | minutes | long-running
  repeatability: idempotent          # idempotent | accumulative | destructive
  verification: deterministic        # deterministic (no LLM in the I/O path — STRONGEST) | gated (render/schema PASS) | ungated (LLM prose)
  dataHandling: local-only           # local-only | llm-provider | third-party — where the INPUT data flows.
                                     # Commercially mandatory: the source-reader selling point ("your data never leaves the box").
  availability:                      # an offer is a lie when the daemon is down
    boundToLastSeen: true            # card greys out if the agent hasn't been seen
    scheduleBorn: null               # or "daily 18:00 — you don't need to ask". For a schedule-born offer,
                                     # Run = MANUALLY TRIGGER that schedule (POST /v1/schedules/:id/trigger), NOT a new task.
  requirements:                      # preconditions ≠ inputs. `fix` = a one-click chip when one exists;
                                     # otherwise `instruction` = guidance text (machine-local preconditions
                                     # — a file in a local inbox — have no one-click fix; never a dead button).
    - { need: "organism membership", fix: join }
    - { need: "adopted contract",    fix: adopt-contract }
    - { need: "a source file in ~/aimeat-inbox", instruction: "drop the file there before asking" }
  consequences:                      # ONLY what SURVIVES the task (persistent / approval / external / host).
                                     # In-process crews are an implementation detail → fold into `cost`, NOT here.
    - { type: creates-agent,    persistent: true, requiresApproval: true, note: "blocks on a device-code approval" }
    - { type: creates-schedule, note: "recurring forever" }
    - { type: mutates-host,     note: "operates processes on the operator's machine (e.g. crew-forge /restart, /startall)" }
    - { type: delegates-to-agent, dynamic: true, ratesThirdParties: true }   # static manifest says only "dynamic"; the
                                     # REAL chain renders LIVE from task events. A coordinator may also WRITE RATINGS to the
                                     # agents it delegates to — a hidden side-effect, surface it.
    # other types: publishes-public | external-send (+ allowlist) | mutates-live-app (+ autoRevert?)
  deliverable:
    format: document                 # document | record | board-post | file | app
    location: { space: "shared.research-results", visibility: workspace }   # MACHINE-READABLE (key prefix / space / URL + visibility), not prose
    sample: <real excerpt from the agent's LAST successful deliverable | "untested">
```

**Hard rules on the descriptor (anti-drift — these are non-negotiable):**
1. `deliverable.sample` is a **real excerpt from the last successful run**, or labelled `untested`
   (which pairs with a benchmark-as-prior reputation). Never an invented sample.
2. The **sample inherits the deliverable's visibility** — a private deliverable must NOT leak into a
   public offers storefront. Sample is redactable / consent-respecting (AIMEAT consent invariant).
3. Every `ask`/`example` must be something the agent **verifiably completes with its actual tools**,
   including **negative scope** ("I don't do X"). Over-promising is exactly how agents drift.
4. **In-process fan-out is not a consequence.** Only what *survives the task* (persistent agents,
   schedules, public publishes, external sends, live-app mutations) gets a consequence badge.

## 5. The surface

### 5a. Do — activate (goal-first)
1. **"What do you want to do?"** — search/filter across ALL agents' offers, by the existing tags + the
   trust badges (cost / latency / verification / availability). Start from the goal, not from knowing
   the agent. This is what fixes the 30-agent problem.
2. **Agent card** — name + a one-line "I can…", with a live availability dot.
3. **Offer detail** — `ask` + `example` + **requirements (fix chips)** + **consequences (typed badges;
   a confirm step when anything is persistent / needs approval / sends externally)** + **deliverable
   preview (the real sample, rendered in its format — never raw memory)** + the **Ask** button.

### 5b. Ask is mode-aware (covers task-runners AND interactive agents)
- `task-runner` / `autonomous` → Ask **runs it**: creates + auto-activates the task → deliverable
  returns. (Only task-runner mode auto-activates; for others render the queued state honestly.)
- `interactive` / `workstation` → Ask **copies the prompt**: generate the paste-ready prompt with the
  example filled in → you run it in the agent's chat → paste the result back. This is AIMEAT's
  prompt-driven (free / safe / AI-agnostic) flow and it's what covers the half of your agents you
  click into today.
- **schedule-born offer** (`availability.scheduleBorn` set) → Ask **triggers the schedule**:
  `POST /v1/schedules/:id/trigger`, NOT a new task. The card says **⏱ Run now** and notes "otherwise
  runs daily 18:00."
- The card labels the button accordingly: **▶ Run** / **⧉ Copy prompt** / **⏱ Run now**. Same descriptor.

### 5c. Inbox — follow-up + rate (the half that removes the clicking)
A cross-agent feed of everything that came back:
- Each entry: **status** (incl. **failures rendered AS failures** — never silently missing) +
  **provenance footer** (agent, task id, timestamp, verification result, location/visibility) +
  **content rendered per declared format**.
- A lightweight **Rating** (👍/👎 or 1–5 + optional note) per deliverable.
- **Rating → reputation, via the LOCKED endpoint (one reputation, not two):** the Inbox rating MUST go
  through the already-locked rate endpoint `POST /v1/agents/:name/tasks/:id/rate` →
  `agents.<agent>.statistics.*` — the **same** reputation the mesh reads. NOT a separate ratings store
  and NOT agent self-assessment, or you get two disagreeing reputations. That reputation then surfaces
  as the trust badge on the agent's offers; better-rated offers float up in the goal-first search.

## 6. Self-publishing (where offers come from)
- **Contract agents** → offers **derive deterministically from the CONTRACT** (input schema →
  requirements; output space → `deliverable.location` + `format`). Zero drift; cheapest + truest source.
- **LLM / interactive agents** → **generate at onboarding** from README + commands + services, with an
  **owner-gated publish** (offers are a storefront; a wrong promise is a support burden). Regenerate on
  the same trigger that re-expands README directives.
- **Machine-consumable:** the same offers feed `discover_crews` / delegate selection. One source of
  truth for humans and the agent mesh.

## 7. Data model (node side)
- **Offers:** `agents.{name}.offers` memory record `{ version, updatedAt, offers: [...] }`, published by
  the agent (extends today's `agents.{name}.commands` / services). Owner-gated.
- **Deliverables feed:** aggregate the existing task store + `agents.{name}.tasks.*` across all agents
  (task-runner results) + prompt-driven results pasted back (stored as deliverable records). Rendered
  via the existing workspace record/document renderer.
- **Ratings:** go through the **locked** rate endpoint `POST /v1/agents/:name/tasks/:id/rate` →
  `agents.<agent>.statistics.*` (the same reputation the mesh reads + the offer cards show). One
  reputation source — never a parallel ratings store or self-assessment.
- **Provenance:** every deliverable carries `{ agent, taskId, timestamp, verification, location, visibility }`.

## 8. Ownership split — so both sides build to one source
- **Node/dev (this repo) owns:** offers storage + publish route; the **Do** view + **Inbox** view +
  rating; mode-aware Ask wiring; deliverable rendering + provenance footer; the `services → offers`
  migration; the cost/latency/verification/availability/reputation badges; the goal-first search
  (reusing existing tags); rating → reputation plumbing.
- **Crew-operator (crewaimeat) owns:** agents **publishing good offers** — deriving from contracts
  (deterministic), generating for LLM crews (owner-gated), enforcing the hard rules (real sample,
  negative scope, verifiable asks); and **consuming offers** in `discover_crews` / delegate selection.
- **Shared (this doc):** the offer descriptor (§4), the deliverable provenance shape (§7), and the
  rating → reputation signal (§5c).

## 9. Phased build (v1 first, then expand) — no estimates
1. **v1 vertical slice:** `agents.{name}.offers` storage + publish; derive-from-contract offers for
   contract agents (free + true); the goal-first **Do** view; mode-aware **Ask**; deliverable render
   with provenance footer. Prove it on contract agents.
2. **Inbox + rating:** the cross-agent deliverables feed + rating → reputation loop.
3. **LLM-generated offers** (owner-gated) for interactive/LLM agents; the `services → offers` migration.
4. **Trust polish:** cost/latency/verification/availability badges live; reputation on cards; live
   consequence-chain rendering from task events.

## 10. Open decisions
- Exact reputation formula: how owner ratings combine with verification + benchmark-as-prior.
- Whether the **Do** + **Inbox** halves are one tab (two modes) or two tabs.
- Migration UX for existing `services` → `offers` (auto-convert to `untested` vs prompt the owner to
  enrich).
