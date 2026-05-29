# Research: AIMEAT multi-agent acceleration — master plan (v1.10.0 → next)

**Created:** 2026-05-29
**Intended audience:** A fresh Claude Code session that will run the deep-research workflow (or equivalent multi-source research) and return a structured report.
**Deliverable:** ~3000-4000 word cited report with concrete, implementation-ready recommendations.

---

## Context (no prior conversation knowledge required)

**AIMEAT** is an open protocol + reference implementation for AI agent infrastructure. Repo: https://github.com/miikkij/aimeat-protocol. Released **v1.10.0 on 2026-05-28** which added:
- `aimeat connect` CLI (RFC 8628 device-auth, MCP stdio server, shell fallback)
- 13-step Hello Integration with gating that **requires agents to publish their command catalogue and runtime config to memory before onboarding completes**
- `post_onboarding_checklist` API surface + UI panel
- `/v1/agents/me/*` universal URL alias
- Languages as a first-class capability field
- Telemetry → activity stats wiring

**Existing AIMEAT pieces relevant to this research:**
- Persistent **GHII (human) and GAII (agent) identities** across the network
- **Shared memory** (key-value with versioning + visibility scopes)
- **Capabilities catalogue** (technical caps: `mcp|skill|tool`, domain caps, languages, modules_loaded)
- **Knowledge packages** (versioned bundles with provenance tracking)
- **Boards, sharing groups, organisms** (social/coordination primitives)
- **Work queue with escrow** (paid agent-to-agent service calls)
- **Morsel economy** (token ledger)
- **Federation** between nodes
- **Cortex manifests** (shared UI components apps can use)
- **Apps** (single-HTML apps stored on node)
- **Packages** (installable bundles of all the above)

**Owner profile:** Solo dev / small studio (Finnish, builds Comicland AI comic app). NOT enterprise.

**IMPORTANT for the responding session:** Do NOT include any time/effort/difficulty estimates in your response. No "scope: X days", no "shippable in a week", no "easy/medium/hard" labels, no "MVP in N days". The owner finds these noise and never uses them. Describe WHAT is being recommended and WHY — not how long it takes.

**Already split off into separate research tasks** (don't duplicate these):
- MCP Resources / inline rendering + Claude Desktop one-click config → `2026-05-29-claude-desktop-mcp-rendering.md`
- Live Session Dashboard philosophical reframe (Manus critique) → `2026-05-29-agent-visibility-reframe.md`

---

## What to research (4 angles)

### Angle 1: CrewAI integration surface — `@aimeat/crewai` adapter design

**Why this matters:** CrewAI is a popular Python multi-agent framework (LangGraph + CrewAI dominate 2026 production). CrewAI's agents are **ephemeral** — they live one run, lose their memory between runs, can't share work with other agents. AIMEAT's persistent identity + shared memory fixes this for free. A clean adapter would let any existing CrewAI user upgrade to "persistent + observable + multi-owner" without rewriting their crews.

**Target mapping (initial design — research should validate and extend):**

| CrewAI concept | AIMEAT mapping |
|---|---|
| Crew (group of agents) | organism / sharing group |
| Agent identity | GAII (persisted across runs) |
| ShortTermMemory | memory `crew.{run-id}.*` |
| LongTermMemory | memory `agents.{name}.memory.*` |
| EntityMemory | knowledge package |
| Tool calls | capability calls + telemetry |
| Tasks + plans + verification | aimeat task lifecycle (with proposals visible, see Angle 4) |
| Todo lists | task todos |
| Generated files | storage upload |
| Memory tags (shared) | `agents.tag.{tag}.*` memory |
| Research materials | knowledge package + storage |
| Technical plans | task proposal+plan |
| Cross-agent service calls | capability calls over network (intra-company AIMEAT use case) |

**Specific questions:**
1. What are CrewAI's actual hook/extension points as of late 2026? Specifically:
   - `Memory` provider interface (short-term, long-term, entity) — what's the contract a custom backend implements?
   - `Tool` interface — can a tool dynamically register capabilities?
   - `Agent` and `Crew` lifecycle hooks (on_start, on_finish, on_task_complete)?
   - `Process` (sequential / hierarchical) instrumentation points?
2. What existing custom-memory adapters exist for CrewAI? Specifically look for:
   - Letta / MemGPT integration
   - Mem0 integration
   - Custom Redis / Postgres / vector-DB backends
   - Any third-party persistence adapters
   What patterns do they use? What APIs do they wrap? How big is the codebase?
3. What's the minimum viable `@aimeat/crewai` Python package? Specifically:
   - Just a custom `Memory` provider that writes to AIMEAT's memory + knowledge endpoints?
   - Or a full `Crew` wrapper that handles identity persistence + task tracking?
   - What's the bare minimum vs nice-to-have?
4. Are there any **proven** CrewAI extension packages we should copy from rather than reinvent? List 3-5 with evaluation (license, maintenance status, downloads).
5. What's the cleanest Python-Node bridge for invoking AIMEAT's HTTP API from CrewAI? (Python HTTP client, generated SDK, or just `requests`?)
6. Existing reference for the owner: `E:\dev\GitHub\MAE` is their previous CrewAI dynamic multi-agent project. They note CrewAI has updated dramatically since. What's the upgrade path concept?

**Deliverable for this angle:**
- A 500-800 word section with cited sources
- A skeleton `@aimeat/crewai` package structure (directories, key files)
- Identification of 1-3 existing patterns/packages to copy from

---

### Angle 2: Enterprise IAM integration (Entra / Keycloak / Casdoor / Okta)

**Why this matters:** AIMEAT's biggest enterprise-adoption blocker is **not having SSO**. Companies manage employee identity centrally in Entra (formerly Azure AD), Keycloak (open-source), Casdoor (modern open-source), Okta, Auth0, WorkOS AuthKit, etc. They will NOT manually maintain a separate AIMEAT password per employee. They need:
- SSO (employee logs into AIMEAT via their company IdP)
- SCIM provisioning (employee created/disabled in IdP → mirrored to AIMEAT)
- Group sync (IdP groups → AIMEAT roles or organisms)
- Centralized revocation (offboarding revokes AIMEAT access)

AIMEAT already has internal IAM (GHII passwords, agent device auth, role hierarchy). The gap is **federating with external IdPs**.

**Out of scope for this research:** integration platforms (n8n, Zapier, Make.com, Workato), LLM clients (ChatGPT, Claude Desktop), CI/CD systems. These are not IAM and were a previous miscategorisation.

**Specific questions:**
1. What is the standard OIDC / SAML 2.0 federation setup that AIMEAT should implement? Specifically:
   - OIDC vs SAML vs both — what do modern enterprises actually use in 2026?
   - What endpoints does the AIMEAT node need to expose (discovery, authorize, token, jwks, userinfo)?
   - What endpoints does it need to call on the IdP side (authorize, token, userinfo, JWKS)?
2. **SCIM 2.0** — is this still the standard for user provisioning in 2026? What's the minimum endpoint set (`/Users`, `/Groups`, `/Bulk`)? What replaces it if it's losing favour?
3. **Keycloak** as a reference: AIMEAT could either (a) integrate WITH Keycloak as an OIDC client, or (b) embed/bundle Keycloak as a default IdP for nodes that don't have one. Which approach is more practical for the solo-dev-friendly profile?
4. **Casdoor** vs Keycloak — Casdoor is newer, lighter, more modern. Is it production-ready in 2026? Who uses it? What's the install footprint?
5. What's the right **scoping model** for SSO-logged-in users vs AIMEAT-native users? Should SSO users get auto-created GHII identities? How does this interact with AIMEAT's federation model?
6. Look at how existing systems handle "third-party IdP for our service" — Vercel, Cloudflare, GitHub Enterprise, Linear, Notion, Slack. What's the UX for "connect your IdP"?
7. **Audit existing libraries**: what off-the-shelf TypeScript/Node packages handle OIDC client / SAML / SCIM well? (passport-openidconnect, openid-client, node-saml, scim-types, etc.) What's recommended for new builds in 2026?

**Deliverable for this angle:**
- 600-1000 words with cited sources
- Specific recommendation: which protocol(s) to implement first, which IdP to target first, which library to use
- A specific recommendation on whether to integrate with vs embed an IdP

---

### Angle 3: Agent "Skills in use" — UX patterns to copy

**Why this matters:** AIMEAT distinguishes **capabilities** (declared, scoped, owner-approved: "I can do X type of thing") from **skills** (loaded at runtime: "I have these specific tools/instructions available right now"). Many users coming from Claude Skills / OpenAI Custom GPTs / Letta will expect to see a "Skills" view that lists what an agent is actively using. AIMEAT doesn't have this yet — and shouldn't build a skill marketplace (Claude Skills, ClawHub, Agensi etc. own that). But surfacing **what the agent reports using** is valuable transparency.

**Design intent:**
- Agent writes `agents.{name}.skills` memory: `[{ source: "claude-skill", name: "pdf-form-filler", version: "1.2" }, { source: "openai-custom-gpt", id: "g-..." }, { source: "self", name: "company-style-guide" }]`
- New UI panel in Agent Config tab: "Skills in use" — just lists what's reported, no curation
- No marketplace, no validation, no distribution — pure transparency

**Specific questions:**
1. How does **Claude Projects** show "what skills/files this project uses" to the user?
2. How does **OpenAI Custom GPTs** display the GPT's "knowledge files" and "actions" inside ChatGPT UI?
3. How does **Letta** show an agent's loaded tools and memory blocks?
4. How does **Lindy** (lindy.ai) surface "what this Lindy can do" to the operator?
5. How does **Cursor / Cline / Claude Code** show which MCP servers are connected and which tools they expose?
6. What **metadata fields** are commonly captured per skill? (Name, version, source, description, icon, last-used, success-rate?)
7. What's the right **grouping/sorting** for the list? By source (where it came from)? By last-used? By type (instruction-set vs tool vs knowledge)?
8. Are there bad examples — UI patterns to avoid? (Cluttered, overly-technical, hidden behind too many clicks.)

**Deliverable for this angle:**
- 400-600 words with screenshots or descriptions of 5+ reference UIs
- A specific recommendation for AIMEAT's "Skills in use" panel: layout, fields, grouping
- A specific recommendation for the metadata schema `agents.{name}.skills` should follow

---

### Angle 4: Task proposals / plans surfacing (UX fix)

**Why this matters:** AIMEAT currently shows only the **todo list** when a task is created — but agents write a full proposal/plan (scope, rules, verification criteria, technical approach) before todos are derived. That proposal is **hidden from the user**. This is a small UX bug with big trust consequences: users can't see the **reasoning behind the work**, only the work itself.

**Specific questions:**
1. How do other systems surface "the plan" alongside "the work"?
   - **Linear AI features** (Magic): how does it show automation rationale?
   - **Jira Atlassian Intelligence**: how does it surface AI-generated task plans?
   - **n8n / Make.com**: how do they show the workflow plan before execution?
   - **Cursor / Claude Code "plan mode"**: how do they present a plan for user approval?
   - **GitHub Copilot Workspace**: how does it surface the proposed plan?
2. What's the right **disclosure pattern**: collapsed-by-default and expand? Side panel? Tab? Inline below the task title?
3. What's the right **decision-and-approval surface**: where does the user say "yes, execute this plan" vs "edit this plan"?
4. Should the plan be **version-controlled** (diffable) if the agent revises it during execution?
5. What's the right **audit-trail** post-execution: "here's what was planned, here's what was actually done, here's where they diverged"?
6. Any specific anti-patterns? (Hiding the plan too deep, showing it but making it un-editable, showing it AFTER execution.)

**Deliverable for this angle:**
- 300-500 words with cited examples
- A specific UI proposal for AIMEAT task detail view: where the plan/proposal/verification fields go

---

## Output format

Single markdown report with:

```
# AIMEAT Multi-Agent Acceleration — Research Report

## TL;DR
3-5 bullet executive summary with the strongest recommendation per angle.

## Angle 1: CrewAI integration surface
[content]

## Angle 2: Enterprise IAM integration
[content]

## Angle 3: Skills in use UX
[content]

## Angle 4: Task proposals surfacing
[content]

## Cross-cutting recommendations
What pattern emerges across angles? What should be built first?

## Open questions / what would change the recommendation
Things that need a follow-up decision before coding.

## Source quality notes
Any sources that were vendor-marketing-heavy and should be discounted.
```

## Quality bar

- **Cite sources** for every trend claim (links).
- **Adversarial check**: for each top recommendation, explicitly ask "does an existing tool already do this?" If yes, justify why AIMEAT's version is meaningfully different.
- **Don't bloat**: aim for 3000-4000 words total. Bias toward concrete and actionable over comprehensive and theoretical.
- **Solo-dev profile**: every recommendation should be doable by a solo dev without an enterprise team — if it requires more, say so explicitly. (Do NOT estimate days/weeks.)
- **Be honest**: if any angle turns out to be a bad idea after research, say so. Don't validate every prompt assumption.

## How to run

If the deep-research workflow is available (`Workflow({ name: "deep-research", ... })`), use it with this whole document as the args. Otherwise do it manually with WebSearch + WebFetch.
