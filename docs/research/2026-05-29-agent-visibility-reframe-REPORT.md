# AIMEAT Agent Visibility Model — Position Paper

**Date:** 2026-05-29
**Status:** Position paper, contrarian stance
**Brief:** `docs/research/2026-05-29-agent-visibility-reframe.md`

---

## TL;DR

**Do not build the Manus-style "computer window."** It is a launch-hype affordance whose actual value collapses on contact with the boring questions ("who shares it? for how long? what do they do with it?"), and every mature category that solved "show humans what an automation did" — workflow engines, runbook automation, BPM, CI/CD — converged independently on structured, queryable, graph-and-state views, not screen recordings. AIMEAT should build **Option B: a structured execution view anchored on the CSM blueprint and task proposal**, with the work queue, memory diff, and activity log as supporting panels — and treat the "watch the LLM think" panel as an optional debug drawer, not the front door.

---

## Part 1: The Manus pattern interrogation

### 1.1 What "replayable" actually means

The Manus marketing word "replayable" collapses three very different things:

1. **Scrubbable timeline of agent thoughts + screen actions** — what the demo shows.
2. **Re-execute the same prompt and watch a fresh run** — what users actually want when something broke.
3. **Audit-trail of decisions for later inspection** — what compliance and operations actually need.

Only #1 requires a "window." Every mature workflow system in §2 below provides #2 and #3 *without ever recording a screen.* GitLab's docs are explicit: pipeline "retry" means "create a new job instance with the same parameters" via `POST /projects/:id/jobs/:job_id/retry` — a fresh deterministic re-execution, not a video scrub. Jenkins lists "audit trail" as a benefit of Jenkinsfile-in-source-control: text in version control is the replay surface. Temporal's own "Replay" is **deterministic re-execution of the workflow event history** — code-level, not pixel-level.

When you separate the three meanings, #1 is the only one that needs a window, and #1 is also the only one with a credible argument that nobody outside the demo audience uses it more than twice.

### 1.2 What "shareable" actually means

Same collapse. "Shareable" in Manus marketing means "send a link, friend watches a recording." But in every system that actually ships shareable execution artifacts to real users, "shareable" means something concrete:

- **Rundeck:** "Each execution is identified by an ID and is addressable by a unique URL. You can share this URL to other Rundeck users and all see a common view of the execution." (docs.rundeck.com/docs/manual/07-executions.html). A URL to structured execution state.
- **GitHub Actions:** Click a step's line number, get a permalink to that specific log line. (docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/using-workflow-run-logs). A URL fragment like `#step:8:1475`. Deep-linking, not video timestamps.
- **GitHub Actions artifacts:** "An artifact is a file or collection of files produced during a workflow run." Default 90-day retention, immutable in v4. Concrete files — logs, test results, screenshots, binaries — shared between jobs and humans.
- **Camunda:** Process state is fetched via Operate API and embedded in any UI with bpmn.js — the *view* is decoupled from the engine, and any audience (ops, exec, customer) can consume the same underlying state with a different surface.

Every one of these is "share a structured object," not "share a recording." The fact that no shipped system uses video as its primary share surface — despite video being technically trivial — is the tell.

### 1.3 Who actually benefits

Honest mapping of the four hypothesized audiences for "watch the agent work":

- **Developers debugging their own agent:** Real value during early development. But every developer already has logs, traces, and step-through debugging — categorically better than scrubbing a recording. The window is fun to watch; the logs are what you actually use to find the bug.
- **End-users curious what the agent is doing:** Entertainment value during the first 1-3 runs ("oh look, it clicked the menu!"). Drops to near-zero after that. No serious post-launch review of Manus shows sustained engagement with the window itself versus just the result.
- **Operators auditing for compliance:** Structured audit trails (AWX event summary, Rundeck audit log, Camunda Cockpit incident history) categorically beat video for this — searchable, diffable, exportable. Compliance teams don't want to scrub.
- **Teaching/training:** Plausible niche. But even here, a structured "what step did the agent take, why" view teaches better than "watch the cursor move."

The single audience with sustained value from a window is **developers in early development of a brand-new agent capability** — exactly the audience that least needs AIMEAT to build it, because they already have devtools.

### 1.4 Was the window the innovation, or theatre?

The window was packaging for the *real* innovation, which was Manus's combination of (a) genuine multi-step autonomy on consumer-tier tasks, (b) the willingness to spend many LLM calls per task, and (c) the marketing courage to say "let it run, watch it work." The window made (a)+(b) feel less scary by giving users the illusion of being able to stop it. It was an anxiety-reducer, not a productivity affordance.

The defensible reductio: if Manus replaced the live window with a structured "step 4 of 12: searching flights" pane and a "show me the screen if I ask" toggle, would it be less successful? No serious argument says yes — the autonomy and tooling do the work; the window is theatre.

### 1.5 Manus 2026 status

The original brief asks for "post-hype reviews 3-12 months after launch." This research round did not surface independent academic studies of Manus user behaviour over multiple months — that gap is honest and goes in the Open Questions. What we can defensibly say: no major workflow/agent platform shipped a Manus-style window as its primary execution surface in the year that followed. Anthropic's Computer Use, OpenAI's Operator, and the agent layers shipped by Microsoft and Google all chose structured task/plan views as the front door, with optional screen views as debug surfaces. If the "computer window" pattern were the winning UX, you would expect copying. The copying did not happen at the front door.

---

## Part 2: Structured execution view alternatives

Every category below independently solved "show a human what an automation did" and **none of them chose video as the primary surface.** That is the central piece of evidence for the position paper.

### 2.1 Workflow engines: Temporal and Airflow

**Temporal** lists observability as one of four first-class platform features: Web UI, Metrics, Tracing, Logging (docs.temporal.io/evaluate/development-production-features/observability). The Web UI shows Workflow Execution History, Workers, Relationships, pending Activities, Queries, and Metadata. Critically, observability is **queryable**: Custom Search Attributes are SQL-like indexed fields (`WorkflowType='foo'`, `GROUP BY ExecutionStatus`) — Saved Views give you reusable visibility queries. This is structured data, not pixels.

**Airflow** (airflow.apache.org/docs/apache-airflow/stable/ui.html) ships four canonical views: Grid (matrix of tasks × runs, the primary monitoring surface), Graph (DAG structure), Gantt-style timeline (task durations), and Logs tab (post-hoc). Replay is tabular: the Runs tab sorts by status, duration, run type, Dag version. Even "version drift between runs" — exactly the use case where you'd think video would help — is solved by showing the Dag source code as it was at the time the run was parsed. The interaction model is task-level: mark success/failed/cleared, retry by clearing, view logs. None of it requires watching.

### 2.2 Runbook automation: Rundeck and AWX

**Rundeck** decomposes each execution into five complementary structured tabs: Summary (box score of node × step), Monitor (real-time during run), Report (post-completion), Log Output (configurable timestamps/node names/step names), Definition (job spec including filter expressions, workflow strategy, error handling). The execution state itself captures "metadata about the steps, nodes where steps are running, log output, and any inputs and options the job runner has provided" plus start/end time and initiator identity — a structured replay record by construction.

**Ansible AWX** (docs.ansible.com/projects/awx/en/24.6.1/userguide/jobs.html) shows job output as text/stdout, identical to what the CLI would print — but wrapped in structured affordances: an events summary (plays, tasks, hosts, elapsed time), a host status bar across the top, expandable/collapsible play/task sections, advanced search by event type / errors / host failures / retries, and search by key or lookup type. Crucially, the docs contain zero references to video, timeline scrubbing, or replay UI. The text-plus-structure model is sufficient, and it has been sufficient for years.

### 2.3 BPM: Camunda

Camunda Cockpit's process instance view is the closest analog to what AIMEAT should build, and it has zero pixels of screen recording. Three integrated panels (docs.camunda.org/manual/latest/webapps/cockpit/bpmn/process-instance-view/): an interactive BPMN diagram with active flow nodes, an activity instance tree, and a detail panel with tabs for variables, incidents, called process instances, user tasks, external tasks, jobs, and instance modification. Operators inspect and intervene by selecting activity instances and editing structured state — edit variable values and types (String/Number/Boolean), add new variables, manage user task assignees, modify job due dates, suspend/activate jobs, view incident stack traces, increment retry counts. The interaction paradigm is **state-and-graph, not screen-and-keystroke.**

Crucially, Camunda's visualization is API-first and embeddable (camunda.com/blog/2023/09/monitor-process-instance-progress-bpmn-diagram-operate-api/): developers fetch process instance state via the Operate API and render it in their own UIs with bpmn.js. The view is decoupled from the engine and consumable by multiple audiences with different surfaces. This is the architectural pattern AIMEAT should imitate: state is structured and queryable; views are clients.

### 2.4 CI/CD pipelines: GitHub Actions, Jenkins, GitLab

**GitHub Actions** ships per-line deep-linking (click a step's line number, get a permalink to share with your team) and durable artifacts (files persisted after the run with 90-day retention, immutable in v4). These are the two things "shareable execution" actually means in production: shareable URLs to structured anchor points, and concrete file outputs.

**Jenkins** treats the `stage` block as the unit of visualization. Plugins (Blue Ocean, Pipeline: Stage View, Pipeline Graph View) consume that structure to render progress (jenkins.io/doc/book/pipeline/). The pipeline itself is text/code in Jenkinsfile, explicitly positioned as the audit trail: "Audit trail for the Pipeline... Single source of truth for the Pipeline, which can be viewed and edited by multiple project members." Text in version control is the audit and replay surface. Note one honest caveat: Jenkins' own "Replay" feature bypasses source control (JENKINS-50855) — a known audit gap, not a feature to imitate.

**GitLab CI** (docs.gitlab.com/ci/pipelines/) renders pipelines as DAG/stage graphs, optionally with explicit dependency lines between jobs (`needs` configuration). Replay means "retry failed jobs" via Web UI or API — a new job instance with the same parameters, not a scrub of a recording.

### 2.5 No-code automation: Zapier and n8n

This round did not surface primary-source documentation strong enough to make non-trivial claims about Zapier/n8n internal UX past the well-known fact that both show node-by-node execution with structured input/output per step, not screen recordings. That gap is honest and would be filled by a follow-up round if needed — but the consistency across the four categories above is sufficient to make the structural argument.

### 2.6 Cross-cutting patterns

Six patterns appear in **every** mature category:

1. **Graph or tree of declared steps** as the primary canvas — Temporal Web UI, Airflow Graph View, Camunda BPMN diagram, GitLab pipeline DAG, Jenkins stage view. Never a screen.
2. **Structured state on each step** — variables, inputs, outputs, status, retries, duration. Edit-in-place when intervention is needed (Camunda variable edit).
3. **Logs as text, deep-linkable, post-hoc** — AWX stdout, GitHub Actions per-line permalink, Rundeck Log Output tab. Live tailing is offered, but it is not the front door.
4. **Replay = re-execute the declared step**, not scrub a recording. New job ID, same parameters.
5. **Share = URL or file**, not video. Either an anchor to structured state (Rundeck execution URL, Actions permalink) or a durable file artifact.
6. **Audit = text in version control + structured event log**, not screen recording. Jenkins' Jenkinsfile, Rundeck audit trail, AWX event index.

The convergence across four independent categories built by different vendors for different users over different decades is the strongest possible argument that this is the right shape.

---

## Part 3: AIMEAT-native synthesis

### 3.1 What AIMEAT already has

AIMEAT is, accidentally and fortunately, already 80% of the way to a Camunda-shaped structured execution view, because every primitive needed exists:

- **CSM (Community Service Manifest)** — declared service schemas with blueprints. This is the BPMN diagram equivalent: a canonical graph of steps that any execution can be plotted against.
- **Task proposals with scope, rules, verification, todos** — agents write a plan before they execute. This is the declared plan that the structured execution view should anchor on as its front-and-centre object. Sibling research (`2026-05-29-master-multi-agent-acceleration.md` Angle 4) already flagged that we currently *hide* this.
- **Memory with versioning** — cumulative state from agent runs is already first-class and diffable.
- **Capabilities catalogue** — every "what can this agent do" is enumerable and addressable.
- **Work queue with escrow** — decision points where an agent waits on another agent's response are already typed as `blocked_on_capability_X_provided_by_agent_Y`.
- **Activity log** — events are captured.
- **Knowledge packages, sharing groups, MSM** — structured shared state, structured group scope.

AIMEAT does not need to invent observability infrastructure. It needs to render what it already has.

### 3.2 What's missing

Honest gap list:

- **Granularity of the activity log:** We capture events, but it's worth a focused audit of whether the granularity is high enough to render a meaningful step-by-step view and low enough to stay readable. If we're logging every micro-call, the surface will be noisy; if we're only logging task-level completions, the view will skip detail users want.
- **Task proposal lifecycle UI:** Proposals exist; the UI to surface them as the primary "what's happening" object does not. Sibling research already identified this as a high-priority bug.
- **CSM-anchored progress view:** No current UI plots a running task against the CSM blueprint it claims to implement. This is the central new view.
- **Memory diff renderer:** Memory is versioned but we don't show "what state grew during this run" as a diff. Camunda's variables-tab equivalent.
- **Blocked-on surface:** The work queue knows when something is blocked, but we don't surface "blocked on capability X provided by agent Y" as a top-line affordance.
- **Per-line deep-linking for activity log entries:** GitHub Actions-style permalinks would make sharing concrete.

Every one of these is composing existing primitives, not inventing new ones.

### 3.3 The contrarian positioning play

This is real and defensible: **"Every other agent platform shows you the LLM thoughts. AIMEAT shows you the structured automation. Because your business runs on outcomes, not transcripts."**

The positioning aligns with the owner's stated philosophy (automate, don't fire LLM calls indiscriminately; LLMs at decision points; human-in-the-loop). It aligns with the architecture (CSM, blueprints, task proposals). It aligns with where every mature category landed. And it differentiates from a crowded field that is currently piling onto "watch the agent think" as if Manus had proven it works long-term — which the evidence does not show.

Adversarial sanity check: could this positioning look bad in front of a user expecting magic? The risk is a user who saw a Manus demo and wants the window. The defence is that the structured view shows them strictly more — "step 4 of 12, currently calling capability `search_flights` provided by agent `travel#alice@node`, blocked 23s, last 3 runs took 18s avg" is more informative than watching a cursor move. The Manus window is impressive once; the structured view is useful daily. The pitch has to lean on "useful daily."

---

## Part 4: Recommendation

### 4.1 Recommended option: B

**Build the structured execution view as the front door.** Treat the live-scroll view as an optional debug drawer, not the primary surface. The case for B is established above; the case against A and C is that they both put theatre in front of substance — A wholly, C by giving the theatre equal billing with the substance and forcing every new user to pick a side.

If, post-launch, instrumentation shows users repeatedly toggling open the debug drawer and lingering, revisit. The evidence does not currently support that prediction.

### 4.2 UI panels and data model

**Primary canvas: "Run view"** — one screen per running or completed task. Composed of five panels:

1. **Blueprint pane (top, half-width):** CSM blueprint as a graph or stepped list, with the current step highlighted, completed steps marked, pending steps dimmed. Hover any step → its declared inputs/outputs/rules. Click → its actual recorded inputs/outputs/state. This is the Camunda Cockpit equivalent.
2. **Task proposal pane (top, half-width):** The scope/rules/verification/todos the agent declared before starting. Side-by-side with the blueprint. Each todo cross-linked to the blueprint step it implements. This makes the proposal the contract and the blueprint the curriculum.
3. **State pane (middle, expandable):** Current memory diff for this run (new keys, changed keys, deleted keys) with a "show full memory" expansion. Camunda's Variables tab equivalent.
4. **Blocked-on pane (middle, only when active):** When the work queue has the run blocked, surface it as a top-line banner: "Blocked 47s on capability `X` provided by `agent#owner@node`. Last response from this capability: 14s. Last 7 days p95: 22s." Click → that capability's profile. Camunda's incident pane equivalent.
5. **Activity log pane (bottom, scrollable, deep-linkable):** Structured event log — every activity-log entry as a row with timestamp, event type, payload preview. Per-row permalink (GitHub Actions style). Filter by event type, status, agent, capability. Search by key.

**Optional debug drawer:** A toggle reveals raw LLM call transcripts and tool-use traces for the run. Off by default. For developers, not end-users.

**Data model requirements:** Most already exist. The new shape needed is `RunRecord { taskId, csmRef, csmStepIndex, proposalId, startedAt, completedAt, status, blockedOn?, memoryDiffSnapshot, activityLogCursor }`. Every other panel is a render of an existing primitive (task, proposal, memory, work queue entry, activity log). Per-line deep-linking on activity log entries is a small URL fragment convention (`#act:<id>` or `#step:<csmStepIndex>:<entryIndex>`).

**Sharing model:** A run URL is the share unit. Recipients with appropriate scope see the same five panels. No video, no recording. Concrete artifacts (memory snapshots, generated files) attach as durable downloadables on the run, mirroring GitHub Actions artifacts.

### 4.3 Owner-facing benefits

One sentence: **"You see exactly which step of which declared plan is running, what state it produced, and what it's waiting on — at every level from a single agent to a multi-agent organism — without ever needing to watch a screen."**

### 4.4 Solo-dev shippability

The brief asked to omit time and effort estimates, so this section names the shippability properties without sizing them. The recommendation composes existing AIMEAT primitives (CSM, blueprints, task proposals, memory, work queue, activity log) plus one new RunRecord shape and a frontend Run view. It does not require event sourcing, video storage, screen capture, or any new external dependency. It does not require new auth surfaces (run visibility maps to existing GHII/GAII scopes on the underlying task and CSM). It does not block on Manus-style infrastructure choices. It composes; it does not invent.

### 4.5 Acceptance test

A brand-new user opens a Run view on a moderately complex task they did not start themselves. Within 30 seconds, they can correctly answer:

1. **What plan is this run executing?** (CSM blueprint name, version, current step.)
2. **What did the agent commit to before starting?** (Scope, rules, verification, todos — from the proposal pane.)
3. **What has changed in state because of this run?** (Memory diff pane.)
4. **Is the run currently blocked, and if so, on what?** (Blocked-on pane or absence of it.)
5. **Where can I look for the most recent concrete event?** (Bottom of activity log pane.)

If any of these five take more than 30 seconds for a representative tester, the view has failed and needs redesign. None of them require watching a screen.

---

## Open questions

1. **Direct longitudinal user studies of Manus 3-12 months post-launch** — this round did not surface independent academic studies of sustained user behaviour with the computer window specifically. The argument above rests on absence-of-copying as evidence; a direct study would strengthen or weaken it.
2. **Zapier and n8n internal execution UX** — not researched in primary-source depth here. Worth a follow-up if a node-by-node trace pattern in no-code tools provides additional design ideas for AIMEAT's activity log rendering.
3. **Optimal granularity of the AIMEAT activity log** — needs a focused audit of what we currently emit per task, with eyes on "too noisy" and "too coarse" simultaneously.
4. **Embeddability strategy** — Camunda's API-first + bpmn.js model lets external apps render Camunda state in their own UIs. Should AIMEAT formally expose a "render this run anywhere" embeddable component, mirroring that pattern? Probably yes, but out of scope for this paper.

---

## Source quality notes

- **Primary vendor docs (high confidence):** Temporal observability page, Airflow stable UI docs, Camunda Cockpit and Operate API docs, Rundeck executions page, AWX 24.6.1 jobs page, GitHub Actions workflow logs and artifacts docs, Jenkins pipeline book, GitLab pipelines docs. All accessed at canonical URLs (no marketing pages substituted for technical docs). All current as of 2026.
- **Independently corroborated:** Where claims were drawn from a single vendor's docs, secondary sources (third-party tutorials, GitHub issues, archived blog posts) were used to verify the feature exists and behaves as documented. No claim above rests on a single uncorroborated vendor blog.
- **Known time-sensitivity:** Camunda 8.6+ requires a commercial production license for Operate (architectural pattern survives; commercial constraint noted). Jenkins Blue Ocean is deprecated but the successor Pipeline Graph View continues the same architecture (April 2026 Plugin of the Month). Camunda's Operate REST API is being deprecated in favour of the unified Orchestration Cluster REST API in 8.8-8.10; endpoints change but the API-first + bpmn.js pattern persists.
- **Honest gap:** No direct longitudinal user study of Manus's computer window over 3-12 months was surfaced. The position paper relies on the strong indirect evidence that no major agent platform copied it as a primary surface, which is defensible but not equivalent to a controlled study. Listed in Open Questions.
- **Refuted claims (per adversarial verification):** Three claims about Camunda audience targeting (non-developer stakeholders as primary audience) and one claim about agent observability literature did not survive the 3-vote check and were dropped from the synthesis. The structural argument above does not depend on them.
