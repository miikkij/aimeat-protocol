# Research: Agent visibility model — the contrarian case against Manus-style "computer windows"

**Created:** 2026-05-29
**Intended audience:** A fresh Claude Code session that will do philosophical/architectural research and return a position paper.
**Deliverable:** ~2000-3000 word position paper with a clear recommendation for AIMEAT.

---

## Context (no prior conversation knowledge required)

**AIMEAT** is an open AI agent infrastructure protocol (https://github.com/miikkij/aimeat-protocol). It just shipped v1.10.0 with persistent identity, shared memory, capabilities catalogue, knowledge packages, work queue, sharing groups, and CSM (Community Service Manifest — declared schemas/blueprints for any service running on the network).

A previous deep-research round recommended building a **"Live Session Dashboard" — Manus-style "agent control room"** as the highest-priority next feature, citing Manus's "Computer window" + replayable+shareable sessions as a proven UX pattern (MIT Tech Review validated).

**The owner pushed back hard.** Specifically:

> "Muista että heidän toteutus ei välttämättä ole se paras vaan nekin etsii pioneerina näit. Mitä tarkoittaa replayable, mitä tarkoittaa shareable? Minusta se ei ole sitä mitä ne tekee actioneina. AIMEAT:ssa nämä on jo rakennettu tyyliin CSM ja MSM ym. — määritellään validoitavat datamodelit, blueprintit, specsit ja sitten on tietty polku mitä käydään läpi ja erilaisia kokoonpanoja. Niin haluan ymmärtää miksi me haluttaisiin replayable + shareable sessiot, mitä ne oikeasti tarkoittaisi, miksi käyttäjät käyttää niitä, mitä ne hyötyy siitä? Koska minusta agentin pitäisi pystyä automatisoimaan asioita iekä tehdä LLM kyselyitä vitukseen mikä tuntuu olevan suurempi trendi nyt kuin se että LLM pitäisi säästää ja etsiä niitä automatisoitavia kohtia joita toistona voidaan vähentää ja päätöksen tekoon avuksi ottaa LLM ja ihminen luuppiin?"

**The philosophical position:**
- Agents should **automate**, not fire LLM calls indiscriminately
- The 2026 trend is "more LLM calls" — the owner thinks this is wrong
- Focus should be on **identifying repetition that can be automated**, with LLMs used for **decision points** with **human-in-the-loop**
- AIMEAT already has CSM/MSM/blueprints — schemas + paths + configurations. The metaphor of a "validated execution of a defined plan" is native to AIMEAT.
- Manus-style "watch the agent's screen scroll" is presented as the answer to "show the user what's happening" — but maybe it's the **wrong answer** for an automation-first system.

---

## What to research

### Part 1: The Manus "computer window" pattern — what's the actual value?

Manus's "Computer window" is widely cited as a UX breakthrough: a live view of the agent's screen, interruptible, replayable, shareable. MIT Tech Review reviewed it positively (2025-03). It looks impressive in demos.

**Questions to answer rigorously:**

1. **What does "replayable" actually mean** in the Manus context?
   - Replay = scrubbable timeline of agent thoughts and screen actions?
   - Or = re-execute the same prompt and watch a fresh run?
   - Or = audit-trail of decisions for later inspection?
   - **Which interpretation, in practice, do users actually use?**

2. **What does "shareable" actually mean?**
   - Share = send a link, recipient watches the recording?
   - Share = let someone resume a session from a checkpoint?
   - Share = export an artifact (the conversation, the result, the trace)?
   - **Which interpretation drives real value?**

3. **Who actually benefits from "watch the agent work" UX?**
   - Developers debugging their own agent — clear value, but they have logging tools.
   - End-users curious about what the agent is doing — entertainment value at most?
   - Operators auditing agent behaviour for compliance — yes, but a structured audit trail beats a video.
   - Teaching/training — possibly, but not the primary use case in marketing.
   - **Find user studies, retrospectives, or post-hype-cycle reviews of Manus. What did people who used it for 3+ months actually say?**

4. **Was Manus's UX innovation the "Computer window" or something else?**
   - The window is visually striking — but maybe the real innovation is the **autonomy + tooling combination**, with the window being a wrapper to make it feel less scary?
   - Look for comparisons: would Manus be less effective without the window? Would it be MORE effective if the window were a structured plan view instead?

5. **2026 status of Manus**: is it still hot, plateauing, or fading? Did the "computer window" pattern get copied? By whom? Did anyone walk back from it?

**Honesty bar:** be willing to conclude either "this pattern is genuinely great and AIMEAT should adopt it" OR "this pattern is theatre that doesn't deliver in practice and AIMEAT should explicitly avoid it". Don't equivocate.

---

### Part 2: The automation-first alternative — structured execution view

**The hypothesis to test:**

If agents are primarily **automating** workflows (with LLMs at decision points and human-in-the-loop at approval points), then the right UI is NOT a "watch the screen scroll" view. It's a **structured execution view** of a blueprint being walked.

Reference domains where this is already solved:

1. **Workflow engines** — Temporal, Cadence, Apache Airflow, Prefect, Dagster, Inngest
   - How do they show "what's running right now"?
   - DAG view? Task list? Timeline? Gantt chart?
   - How do they handle pause/resume/intervention?
   - How do they make failures debuggable?

2. **Runbook automation** — Rundeck, Ansible Tower / AWX, Salt Mine, SaltStack, StackStorm
   - How do they show "the playbook is here, executing step 4 of 17"?
   - How do they surface decision points needing operator approval?
   - Audit trail UX?

3. **BPM (Business Process Management)** — Camunda, jBPM, Bonita, Activiti
   - These are decades old, well-studied, and explicitly about "human + automation in same flow"
   - BPMN visual notation — too heavy for AI agents? Or maybe relevant?
   - How do they handle "step requires human approval"?
   - How do they show "this is what's running, this is what's queued, this is what failed"?

4. **CI/CD pipelines** — GitHub Actions, GitLab CI, CircleCI, Buildkite
   - Pipeline visualisation: what works, what doesn't?
   - Live job streaming vs structured step view — when each is right?
   - Failure debugging UX

5. **Modern agent-but-not-LLM tools** — Zapier, Make.com, n8n
   - How do they show automation runs to users?
   - Step-by-step trace with input/output per step?
   - Visual flow with live indicators?

**Specific questions across these references:**

a. What's the right **primitive for "step"** in a multi-step automation? Discrete tasks? State transitions? Time-bounded actions?
b. How do these tools handle **non-determinism** — when the same flow takes different paths each time?
c. What's the right **collapsing/disclosure pattern** when there are 50 steps but only 3 currently active?
d. What's the right **"why is the system waiting"** affordance — clear surface for "blocked on human", "blocked on API", "blocked on timer"?
e. What's the right way to show **branches and decisions** that the agent (or system) made — "we chose path A over path B because..."?
f. How do they make the trace **searchable and shareable post-hoc**?
g. What's the right way to show **cumulative state** that grew over the flow (memory, files, decisions)?

---

### Part 3: AIMEAT-native synthesis

Given AIMEAT's specific architecture (CSM/MSM/blueprints, tasks with proposals, memory with versioning, capabilities catalogue, work queue), **what is the AIMEAT-native answer to "show the user what the agents are doing"?**

Specific questions:

1. AIMEAT already has **task proposals** — agents write a plan (scope, rules, verification, todos) before execution. (See sibling research file `2026-05-29-master-multi-agent-acceleration.md` Angle 4 for the "we currently hide this" UX bug.) If proposals are surfaced as the **primary unit of "what's happening"**, does the Manus-style "scroll the screen" view become redundant?

2. AIMEAT has **CSM** — a declared schema for any service. If every agent execution is "I am running CSM `foo` step 3 of 7", do we get **structured execution view for free** without writing custom UI per use case?

3. AIMEAT has **memory with versioning**. Cumulative state from agent runs is already there. Can we render "what state has built up during this run" as a memory-diff view?

4. AIMEAT has **the work queue + escrow**. Decision points where an agent waits on another agent's response are already first-class. Can we show "blocked on capability X provided by agent Y" natively?

5. AIMEAT has **the activity log**. We already capture events. Question: are we capturing the **right granularity** — high enough to be meaningful, low enough to be readable?

6. **What's missing from AIMEAT** to make a structured execution view work without major new infrastructure?

7. **Is there a contrarian positioning play** here? "Every other agent platform shows you the LLM thoughts. AIMEAT shows you the structured automation. Because your business runs on outcomes, not transcripts."

---

### Part 4: Recommendation

Based on findings, recommend ONE OF:

**Option A: Build the Manus-style live session view.** If research strongly indicates users (not just demoers) genuinely value the "scroll" view, build it. Define scope: minimum data model, event-sourcing approach, replay storage, share-link mechanics.

**Option B: Build the structured execution view.** If research indicates the scroll view is theatre, build the alternative: blueprint/CSM-anchored progress view, task-proposal-front-and-centre, decision-and-approval surface, structured audit trail. Define scope.

**Option C: Build BOTH but the structured one is the front door.** Live scroll is available as a "debug" panel for people who want it, but the primary owner-facing surface is structured.

For whichever option is recommended, define:
- Specific UI sections / panels
- Data model requirements (what does the backend need to capture)
- Owner-facing benefits in one sentence
- Acceptance test: "if a brand new user opens this view, they should be able to answer questions X, Y, Z within 30 seconds"

**IMPORTANT for the responding session:** Do NOT include any time/effort/difficulty estimates ("days to build", "1-week project", "easy/hard"). The owner finds these noise and never uses them. Describe WHAT the recommendation is and WHY it works — not how long it takes.

---

## Output format

```
# AIMEAT Agent Visibility Model — Position Paper

## TL;DR
The recommendation in 3 sentences. Don't equivocate.

## Part 1: The Manus pattern interrogation
### 1.1 What "replayable" actually means
### 1.2 What "shareable" actually means
### 1.3 Who actually benefits (with citations)
### 1.4 Was the window the innovation, or theatre?
### 1.5 Manus 2026 status

## Part 2: Structured execution view alternatives
### 2.1 Workflow engines (Temporal, Airflow, etc.)
### 2.2 Runbook automation (Rundeck, Ansible Tower)
### 2.3 BPM (Camunda etc.)
### 2.4 CI/CD pipelines
### 2.5 No-code automation (Zapier, n8n)
### 2.6 Cross-cutting patterns

## Part 3: AIMEAT-native synthesis
### 3.1 What AIMEAT already has
### 3.2 What's missing
### 3.3 The contrarian positioning play

## Part 4: Recommendation
### 4.1 Recommended option (A, B, or C)
### 4.2 UI panels and data model
### 4.3 Owner-facing benefits
### 4.4 Acceptance test

## Open questions
## Source quality notes
```

## Quality bar

- **Take a stance**. The owner explicitly invited contrarianism. Do not deliver a "both have merit" mush. Either Manus-style is right or it's wrong for AIMEAT — research enough to defend a position.
- **Cite real user studies / post-hype reviews** of Manus, not Manus marketing material.
- **Real reference architectures**: when discussing Temporal, Airflow, Camunda — link to actual UI screenshots or docs, not vendor claims.
- **AIMEAT-native** means: it should explicitly compose existing AIMEAT primitives (CSM, blueprints, task proposals, memory, work queue, activity log). If a recommendation requires inventing brand-new infrastructure, justify it heavily.
- **Adversarial sanity check**: ask "could this recommendation be reductio-ad-absurdum'd? Could it look bad in front of a user expecting magic?"
- **Length:** ~2000-3000 words. Tight, opinionated.

## How to run

Use WebSearch + WebFetch heavily on:
- Manus reviews 3-12 months after launch (not launch hype)
- Temporal / Airflow / Camunda UI docs and design write-ups
- Academic papers on "human-in-the-loop workflow visualisation"
- Post-mortems / retrospectives on agent UI patterns (any blog from someone who built an agent product and regretted certain UX choices)

If the deep-research workflow is available, this is a perfect fit. Otherwise manual fan-out.
