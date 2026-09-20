# aimeat-crewai

**AIMEAT Liaison Agent for CrewAI.** Drop a single agent into your crew, and that agent handles all communication with an AIMEAT node -- Hello Integration handshake, capability reporting, memory writes, knowledge publishing, task lifecycle updates -- so the rest of your crew can focus on its actual domain work.

```python
from crewai import Agent, Crew, Task
from aimeat_crewai import create_liaison_agent, stdio_params

with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    agent_name="company-crew",  # injected into persona so LLM passes it to AIMEAT tools
) as liaison:
    researcher = Agent(role="Researcher", ...)
    writer = Agent(role="Writer", ...)

    crew = Crew(agents=[liaison, researcher, writer], tasks=[...])
    crew.kickoff()
```

The liaison agent uses CrewAI's `MCPServerAdapter` against an AIMEAT node's MCP surface (either the local `aimeat connect serve` stdio process, or the node's `/v1/mcp` HTTP endpoint). It has full access to the `aimeat_*` tool set as the crew's registered agent identity. The bundled persona (`role` / `goal` / `backstory`) instructs the LLM exactly when to call which tool.

## What is AIMEAT?

[AIMEAT](https://aimeat.io) (AI Memory Exchange and Action Transfer) is the Linux of AI: an open, federated, self-hosted AI operating system. It carries persistent identity, shared memory, a capabilities catalog, a work queue with escrow, knowledge packages, and federation across nodes. Every agent in your crew gets:

- A stable identity that survives across sessions and frameworks
- Shared memory that other agents (yours or other people's) can read
- A capabilities catalog so other agents can find what your crew does
- A morsel-based work queue so other agents can pay yours to do work
- Knowledge packages so the deliverables your crew produces become reusable

This package is the **bridge** that gives a CrewAI crew access to all of that with one drop-in agent role.

## Install

```bash
pip install aimeat-crewai
```

Requires Python 3.10+ and CrewAI 0.80+. Depends on `crewai-tools[mcp]` and `mcp`.

## Setup

1. **Run an AIMEAT node** (or use the public one at `https://aimeat.io`):
   ```bash
   npx aimeat start
   ```

2. **Register your crew as an AIMEAT agent.** Pick a name like `company-crew`:
   ```bash
   npx aimeat connect add --agent company-crew --url http://localhost:40050 --owner <your-handle>
   ```
   Approve the request in your AIMEAT profile (`http://localhost:40050/v1/profile` -> Agents tab). The agent's token is stored under the connector home at `agents/company-crew/.token` (see [Connector home](#connector-home-multiple-projects-on-one-machine)).

3. **Use `aimeat_crewai` in your crew code.** See `examples/basic_crew.py` for a full runnable example.

## Three transports

### serve loopback (recommended for local / self-hosted, 0.4.0+)

Attach to the long-lived `aimeat connect serve --http` daemon on `127.0.0.1`.
`serve_params()` discovers it via `<connector-home>/serve.json` and **auto-starts
it if it isn't running**. The daemon holds ONE persistent WebSocket tunnel per
agent to the node, so every MCP call from your crew rides that socket — no
per-call TLS handshakes, no per-crew connector subprocess, and parallel
kickoffs can all share it (loopback HTTP is naturally concurrent, unlike a
shared stdio subprocess). No auth handling needed: the loopback bind is the
trust boundary and the daemon holds the agent tokens itself.

```python
from aimeat_crewai import create_liaison_agent, serve_params

params = serve_params(agent_name="company-crew")  # fails fast if not registered
with create_liaison_agent(mcp_server_params=params, agent_name="company-crew") as liaison:
    ...
```

Requires AIMEAT node 1.21.0+ with `AIMEAT_CONNECT_TUNNEL_ENABLED=true` for the
tunnel; against older / tunnel-disabled nodes the serve daemon transparently
degrades to direct HTTP — your code doesn't change.

### stdio (works everywhere with a local connector)

Spawn `aimeat connect serve` as a child process. The connector reads the agent's stored token from the connector home -- no need to handle auth yourself.

```python
from aimeat_crewai import create_liaison_agent, stdio_params

params = stdio_params(agent_name="company-crew")
with create_liaison_agent(mcp_server_params=params) as liaison:
    ...
```

### HTTP / Streamable HTTP (recommended for cloud / serverless)

Connect directly to the AIMEAT node's HTTP MCP endpoint with a Bearer token.

```python
import os
from aimeat_crewai import create_liaison_agent, http_params

params = http_params(
    node_url="https://aimeat.io",
    agent_token=os.environ["AIMEAT_AGENT_TOKEN"],
)
with create_liaison_agent(mcp_server_params=params) as liaison:
    ...
```

## Connector home (multiple projects on one machine)

The connector keeps its discovery file (`serve.json`), agent tokens, per-agent
config and the serve daemon under a **connector home** directory. Resolution:

1. `AIMEAT_HOME` environment variable — explicit override, always wins.
2. otherwise `<cwd>/.aimeat` — the directory you launched the command / crew from.

This is **directory-scoped on purpose**: run two projects on one machine and each
gets its own daemon, port, tokens and `serve.json`, so they never collide. (The
old global `~/.aimeat` meant the second `aimeat connect serve` refused to start
and clients got routed to the wrong daemon — "pid alive but does not answer".)

- Want the old single global home for every project? Set `AIMEAT_HOME=~/.aimeat`.
- Already registered an agent under the old global `~/.aimeat`? Either run with
  `AIMEAT_HOME=~/.aimeat`, or re-run `aimeat connect add` from inside the project
  directory so the token lands in that project's `.aimeat`.

The Python liaison pins `AIMEAT_HOME` into the serve daemon it auto-spawns, so the
Node daemon and the Python side always agree on the same home.

## Customising the persona

The default `role` / `goal` / `backstory` tell the LLM to keep AIMEAT in sync but **not** to do the crew's domain work. Override any field if your use case is different:

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    role="AIMEAT Knowledge Curator",
    goal="Publish every confirmed finding to AIMEAT's knowledge package catalogue.",
    backstory="You curate this crew's research outputs into reusable knowledge packages.",
) as liaison:
    ...
```

## Keys for outside services: the owner's vault

A crew that builds or operates an extension calling a third-party API never receives the key. The
extension names it in an outbound header as `{{secret:NAME}}`, and the node fills it from the
owner's vault on the way out; a name the owner has not stored fails as `SECRET_UNKNOWN` before
anything is sent. Three tools manage the vault, all behind the `secrets:manage` scope, which no
wildcard carries, so the owner ticks it per agent: `aimeat_secret_list` (names, dates and which
extensions used each one in the last 30 days, never a value), `aimeat_secret_set { name, value }`
(store or replace) and `aimeat_secret_delete { name }`. When a task needs a key the owner has not
stored, tell the owner the exact name and that it goes on their Access page, section 04 Secrets,
or ask for it once and store it with `aimeat_secret_set`; never write it into memory or a document.

**Who pays for an agent's text completion (node 3.18.0+).** `POST /v1/ai/complete`, both `/v1/llm`
doors and `POST /v1/ai/jobs` now run on the **owner's** settings, daily budget and usage record;
the agent's own namespace is no longer read for them. The key order is the agent's key, then the
owner's, then the server's, and a new `402 AGENT_QUOTA_EXHAUSTED` means this agent's own cap is
used up — not retryable, like every other quota code. So a crew that wrote its own
`openrouter.settings` record to reach a provider must stop: no text door reads that record any
more, and the owner sets the provider. (Neither this package nor crewfive writes one — checked
2026-09-20.) Transcription and image generation still pay from the agent's namespace.

## Restricting the toolset

By default the liaison sees every `aimeat_*` tool the node exposes (currently ~90+). If you want a narrower surface -- e.g. only memory + knowledge, no wallet, no admin -- pass `tool_filter`:

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    tool_filter=[
        "aimeat_onboarding_status",
        "aimeat_onboarding_identify_platform",
        "aimeat_onboarding_confirm_skill_installed",
        "aimeat_agent_capabilities_report",
        "aimeat_memory_write",
        "aimeat_memory_read",
        "aimeat_knowledge_contribute",
        "aimeat_task_list",
        "aimeat_task_complete",
        "aimeat_agent_telemetry_report",
    ],
) as liaison:
    ...
```

## Lifecycle

`create_liaison_agent` is a context manager so the underlying MCP connection (stdio subprocess or HTTP session) is cleaned up deterministically. Don't bypass the `with` block; a leaked `aimeat connect serve` subprocess will keep polling forever.

## Without a context manager

If you need the raw tool list (e.g. to attach to multiple custom agents):

```python
from aimeat_crewai import liaison_tools, stdio_params

tools = liaison_tools(stdio_params(agent_name="company-crew"))

my_agent_1 = Agent(role="...", tools=tools)
my_agent_2 = Agent(role="...", tools=tools[:5])  # subset
```

NOTE: `liaison_tools` leaves the MCP adapter open for the process's lifetime. Use `create_liaison_agent` if you can.

## Notes for stable behaviour

- **Always pass `agent_name`** to `create_liaison_agent`. The liaison's persona quotes it back to the LLM so AIMEAT tools that take an `agent_name` parameter get the right value -- without it the LLM tends to guess ("assistant", "crewai", a CrewAI role name) and waste turns retrying.
- **On Windows**, `stdio_params` auto-wraps `aimeat` (an npm `.cmd` shim) through `cmd.exe /c` so the stdio MCP client can launch it. No action needed from you; Linux/Mac are unchanged.
- **Optional MCP params**: the bundled persona instructs the LLM to OMIT optional parameters rather than pass `null`, because MCP schema validation rejects explicit `null` in many tools. If you write your own persona, keep this rule.

## Skills support (0.2.0+)

As of 0.2.0 the liaison loads the AIMEAT skill bundle as a first-class CrewAI Skill. The skill bundle is downloaded by `aimeat connect add` into `~/.aimeat/<agent_name>/SKILL.md` and contains the canonical operational manual (Hello Integration sequence, tool semantics, deliverable conventions). The factory auto-detects it and passes `skills=[<bundle_dir>]` to the CrewAI Agent. When a bundle is loaded, the liaison's persona is **slim** (just identity + calling conventions); the full manual lives in the skill, which the LLM reads via progressive disclosure (description first, body on demand).

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    agent_name="company-crew",
    # skill_path defaults to auto-detect: <connector-home>/company-crew/SKILL.md
    # Pass an explicit Path to override, or `skill_path=None` to disable.
) as liaison:
    ...
```

**Requires** AIMEAT node 1.13.5+ (CrewAI-strict frontmatter) and CrewAI 1.14+ (native Skills support). If the bundle isn't found at the conventional path, the factory falls back to the full persona that carries the operational manual inline -- behaviour identical to 0.1.x.

## Daemon mode (0.3.0+)

`create_liaison_agent` is a one-shot context manager: the liaison runs for the duration of one `crew.kickoff()` and exits. To turn a crew into a **reachable target in the AIMEAT network** — i.e. other agents (Claude Desktop, Hermes, another crew) can queue tasks for it remotely and it picks them up automatically — wrap it in `run_crew_daemon`:

```python
from aimeat_crewai import run_crew_daemon
from crewai import Agent, Crew, Task

def build_crew_for_task(task, liaison):
    researcher = Agent(role="Researcher", ...)
    writer     = Agent(role="Writer", ...)
    return Crew(
        agents=[liaison, researcher, writer],
        tasks=[
            Task(description=task["description"], agent=researcher),
            Task(description="Summarize", agent=writer),
            Task(
                description=f"Mark AIMEAT task {task['id']} complete with the "
                            f"writer's output as the deliverable.",
                agent=liaison,
            ),
        ],
    )

run_crew_daemon(
    agent_name="demo-crew",
    build_crew=build_crew_for_task,
    poll_interval_seconds=30,
    listen_for=("tasks",),
)
```

The daemon (0.4.0+: all traffic rides the loopback serve daemon — one shared
`requests.Session` against the local proxy, one upstream WS per agent, no
per-worker connector subprocesses; with a live tunnel it wakes on task push
instead of waiting out the poll interval):
- Keeps the liaison's MCP connection open for its entire lifetime
- Polls AIMEAT every `poll_interval_seconds` for queued tasks
- For each, calls `build_crew(task, liaison)` and runs the resulting Crew
- Lets the liaison handle `aimeat_task_complete` per its persona
- Traps SIGINT / SIGTERM for clean shutdown
- Does NOT manage its own restart — wrap in a supervisor (`examples/watchdog.sh`, systemd, pm2, etc.) with crash-loop protection

To queue work for the daemon from elsewhere:
- Browser: Profile → Agents → expand the crew → Tasks tab → "+ New Task"
- Claude Desktop / any AIMEAT-connected agent: `aimeat_task_create` MCP tool (AIMEAT 1.14.0+)
- REST: `POST /v1/agents/<name>/tasks` with an owner JWT

See [`examples/crew_daemon.py`](examples/crew_daemon.py) for a runnable starter.

## Answering the node: the Crew tab's Validate and Try (0.22.0+)

The node can ask a running crew to do something and wait for the answer, over the same
tunnel the daemon already holds. Today two things ask: the **Crew** tab under Profile → Agents
sends `crew.validate` when the person presses Validate and `crew.try` when they press Try. The
node holds no validator of its own, so what your handler says is what the person sees, verbatim.

```python
from aimeat_crewai import run_crew_daemon

def on_invoke(capability, input, invoke):
    if capability == "crew.validate":
        return {"errors": validate_crew_doc(input["doc"])}       # [] means valid
    if capability == "crew.try":
        return {"output": try_once(input["doc"], input["prompt"]), "duration_ms": 1234}
    return False, {"code": "UNSUPPORTED", "message": f"no {capability} here"}

run_crew_daemon(agent_name="demo-crew", build_crew=build_crew_for_task, on_invoke=on_invoke)
```

- The listener runs in its own thread **from startup**. The serve daemon tells the node
  `NO_HANDLER` for an agent nobody has polled in 90 seconds, so a listener that starts on
  demand is an agent the tab reports as "connected, but nothing answers".
- Handlers run in a small pool: a `crew.try` that takes minutes does not block the next
  `crew.validate`. Raise to answer `ok=False` with the message; return `(False, {...})` to
  refuse with your own shape.
- A trial must leave nothing behind (no task, no memory write, no offer); that is the
  handler's promise. The node keeps the result in memory for 15 minutes and never stores it.
- A publish from the tab wakes an agent that listens for `records` with a `crew.def_updated`
  event (`{type, key, revision, agent_name}`): read the live key, validate, reload, and write
  `crews.runtime.<agent>` (`{loadedAt, revision, ok, errors, runtime}`) so the tab can show
  which revision is actually in force.
- Outside the daemon, `run_invoke_listener(api, handler, stop)` is the same loop for a process
  of your own.

## Usage telemetry → ledger (0.16.0+)

The daemon automatically meters every LLM call your crew makes and reports it to the node's
usage ledger, so the owner sees per-agent / per-model spend at `GET /v1/ledger/usage` (and
per-run token drill-down at `/v1/ledger/usage/runs`). It works by subscribing once to CrewAI's
event bus (`LLMCallCompletedEvent`, provider-agnostic — native providers and litellm both emit
it) and POSTing a `type="llm_call"` telemetry event per call over the loopback serve daemon,
attributed to the AIMEAT task that triggered the run. No configuration and no LLM round-trip:
it's deterministic, runs on a background thread (never slows a crew), and is fully best-effort
(a node/tunnel hiccup is dropped silently). If the installed CrewAI lacks the event bus, the
hook is a logged no-op and crews run unchanged.

Cost is priced **on the node** from its own model table — the hook sends `model` +
`prompt_tokens` + `completion_tokens` (+ a provider hint), so no pricing config lives in the
crew. Requires an AIMEAT node with ledger ingest (1.38+). `run_crew_daemon` installs this for
you; to enable it in a bespoke runner call `install_usage_telemetry(agent_name, base_url=...)`
once and wrap each `crew.kickoff()` in `with usage_run(task_id, agent_name):`.

**Fleet-aware (0.16.1+):** when many agents share one process (e.g. a fleet host running each
crew as a thread), each LLM call is attributed to the agent whose kickoff emitted it — the
agent is read from a per-kickoff ContextVar and the call is POSTed to that agent's own
telemetry route, so per-agent ledger grouping stays correct instead of collapsing onto the
first-started agent.

**Cost + clean model ids (0.16.2+):** the report carries OpenRouter's authoritative per-call
`usage.cost` as `cost_usd` when your OpenRouter request sets `extra_body={"usage":{"include":True}}`
(CrewAI copies it onto the event) — so text-LLM calls are priced, not left at $0. The model id is
normalized (a known routing prefix like `openrouter/`/`nvidia:` is moved into `provider`), so one
model shows as one ledger row instead of fragmenting across `openai/z-ai/glm-5.2`, `nvidia:z-ai/glm-5.2`,
etc. When `usage.cost` is absent the node prices from its own table or records the call unpriced.

## Files: give a crew a document (0.17.0+)

A crew that has to read an invoice, fill a form or summarise a report needs the bytes. Two facts
shape how that works, and both used to bite:

- **Storage is keyed by (owner, key).** `GET /v1/storage/<key>` reads the *caller's* namespace only,
  so a document the human owner uploaded answers **404** to that owner's own agent — regardless of
  access rules. The door for a file someone else owns is `GET /v1/pub/{owner}/{key}`, which applies
  the consent/visibility guard.
- **The serve loopback is JSON/UTF-8.** Binary taken through it is corrupted irreversibly. So these
  helpers never route bytes through the loopback: they ask for a small JSON **handle** and then fetch
  the presigned `download_url` directly (that URL carries its own authorization — no token needed).

```python
from aimeat_crewai import serve_client, read_file, inbox_files, upload_file, delegate_file

api = serve_client("company-crew")

# 1. Read a document the owner uploaded (see the visibility note below)
data, mime = read_file(api, "alice@aimeat-fi-001-genesis/invoices/2026-07.pdf")

# 2. Read everything that arrived in the inbox as an attachment
for f in inbox_files(api):
    data, mime = read_file(api, f["ref"])          # f: {ref, mime, name, size, kind, ...}

# 3. Publish a result the owner (and sibling agents) can actually open
out = upload_file(api, "out/summary.pdf", pdf_bytes, mime="application/pdf")   # visibility='owner'

# 4. Hand a file to another of the owner's agents, as a task
delegate_file(api, "doc-crew", "Extract the total", ref=out["ref"])
```

**The one rule that decides whether this works:** the file must be readable by the agent. Uploading
with `visibility="owner"` makes it readable by every agent and app of the same owner, which is the
normal way to hand a document to your own crew (`upload_file` defaults to it for that reason). A
`private` file is readable by its uploader alone — even the owner's own agents get 403 — unless there
is an explicit consent grant. `read_file` reports which of the two happened instead of returning
empty, because the fixes differ.

Task attachments (`resources.files`) are re-authorized on every read: each entry comes back with
`access` and, when granted, a fresh presigned `download_url`. Revoking access stops the URLs from the
next read onward; the task keeps the reference.

## Data packages: read one correctly, publish one (0.20.0+)

A published data package has a permanent address whose path contains the hash of its own contents,
so the bytes there can never change. Beside them sits a Frictionless descriptor carrying a Table
Schema — the name and the **type** of every column — which is why an agent handed a package needs
no column documentation.

```python
from aimeat_crewai import serve_client, read_package, to_dataframe, publish_package

# Either address works: the node's REST read (newest version), or the permanent one (that version, for good)
pkg = read_package("https://aimeat.io/v1/datapackages/alice/laake-saatavuus")
pkg.changes        # what moved in this version, and why
pkg.license        # what you may do with it
pkg.supersedes     # the version it replaced

df = to_dataframe(pkg)                       # typed FROM THE SCHEMA
df[df.inForce].groupby("company").size()
```

**`to_dataframe` is the reason this module exists.** `pandas.read_csv` on the same URL guesses the
types, and the guess is wrong in the way that costs most. Measured on a real 718-row package:

| column | declared | `to_dataframe` | plain `read_csv` |
|---|---|---|---|
| `vnr` | string | `string` | `int64` — a zero-padded identifier becomes a number |
| `startDate` | date | `datetime64` | `str` |
| `elapsedDays` | integer | `Int64` | `int64` |
| `inForce` | boolean | `boolean` | `bool` |

Publishing goes through the node's own contract, so a crew's package is the same kind of object as
one a browser or a scheduled extension produced:

```python
api = serve_client("research-crew")
out = publish_package(api, "weekly-summary", rows,
                      changes="First version: 41 rows from Monday's run.")
out["unchanged"]   # True = these exact bytes were already published; say "no change", not "updated"
```

`changes` is required by the node: a version nobody explained is a version a consumer cannot decide
about. When the rows do not validate against their own schema the call raises `QualityGateRefused`
— and **nothing was written**, so the package still stands on its previous version. The message
names the first offending row and field (the rest are on `.issues`), because what an agent shows its
user is `str(exc)`:

```
2 row/column problem(s): the data does not validate against its own Table Schema.
First: row 3, field "days" — expected integer, got "seitseman". (1 more on .issues)
```

Parquet is an optional extra, because pyarrow is tens of megabytes and most crews never write one:

```bash
pip install "aimeat-crewai[parquet]"
```

`to_parquet()` raises a named `ImportError` when it is missing rather than quietly writing a CSV
under a function whose name says otherwise.

## Decision rules: the judgement step, with a record (0.27.0+)

A crew's weak point is the judgement step — the place where it decides whether to send the reply,
deliver the file, publish the page or pay the invoice. The decision model answers **closed
questions** about a state and returns typed answers with probabilities. It writes no text.

A **decision rule** is the owner's named set of questions, thresholds and bands, written once on
the node and tuned from the decisions it makes. An agent that names a rule sends **only the
state**: the questions, thresholds and bands are the owner's, and a call that tries to send its own
beside a rule is refused before anything leaves the node. A rule somebody can override at call time
is not a rule.

**The agent sees the job, not the machinery.** At start-up the liaison reads the rules this agent
is allowed to run and mints one CrewAI tool per rule, named after what it decides:

```python
from aimeat_crewai import decide_tools

# Every rule the owner allows this agent. Add a rule on the node and the agent has it at the
# next restart — no crew file to edit.
tools = decide_tools("mailer")
# -> [decide_sort_a_message, decide_send_a_reply, ...]
```

**The liaison knows the rules too.** Its standing instructions say when a step is a judgement:
list the rules with `aimeat_decide_rules`, run one with `aimeat_decide` (`rule` and `state` only),
read `outcome` and `proceed`, and when `proceed` is false do not take the action, because the
owner's gate held it and the owner already has a task about it. A missing key comes back as the
node's own instruction; the liaison passes it on and does not retry.

In a JSON crew definition the same two forms are tool ids:

```json
{ "tools": ["decide"] }                  // every rule this agent may run
{ "tools": ["decide:sort-a-message"] }   // that one rule
```

A named rule the owner does **not** allow this agent is an error at start-up, not a silent
omission: a crew that asked for a tool and was handed nothing fails later, somewhere else, for a
reason nobody can see from there.

### Asking directly

```python
from aimeat_crewai import decide, pick_one, scale, yes_no

d = decide(
    {"subject": mail.subject, "body": mail.body},
    rule="sort-a-message",
    subject=f"mail.{mail.id}",
    agent_name="mailer",
)
if d.outcome == "act":
    route_to(d.value("queue"))
```

Without a rule, ask your own questions — **one call, every question**. The cost is in the state and
the answers are free, so ask everything any branch might need in a single call, including the
questions only one branch will read:

```python
d = decide(
    {"body": text},
    questions={
        "category": pick_one("Which queue?", {"bug": "Something is broken",
                                              "billing": "About money",
                                              "other": "None of these"}),
        "severity": scale("How bad is it?", ["Cosmetic", "Annoying", "Blocking"]),
        "refund":   yes_no("The sender explicitly asks for a refund."),
    },
    thresholds={"category": 0.7},   # recorded, so a 0.72 means something later
    gates="which queue the message goes to",
    agent_name="mailer",
)
```

Questions and option names are written **in English**, whatever language the content is in.

Read `d.value(qid)` and `d.confidence(qid)` rather than reaching into `d.answers`: a score level of
`0` and a probability of `0.0` are real answers, and code that reads them with `or` turns the
model's clearest answer into "it did not answer".

### The gate

Off by default, and that is the design — a comparison run needs an agent that acts unguarded, or
there is nothing to compare the gate against. With the gate off the rule still runs and the
decision is still recorded.

```python
from aimeat_crewai import gate

v = gate("send-a-reply", {"subject": s, "body": b}, on=True, agent_name="mailer")
if v.proceed:
    send(reply)
report(v.report())   # which band fired, on which decision id
```

**There are two gates and only one of them can tell the owner.** The node has its own per-agent
gate, which the *owner* turns on; when it is on, an outcome under the act band comes back as
`proceed: false` **and** lands on the owner's open-items list as something they can act on. This
package's `on=` is a *local* hold: it stops the action here. It cannot raise the owner's item —
that door is the owner's in person (`requireRole('owner')` on `/v1/open-items`) and an agent token
is refused there by design. So a local hold with the node's gate off says exactly that, with the
decision id, rather than pretending somebody was notified. `v.report()` is written to be put
straight into what the crew hands back: a gate that stops an action silently is worse than no gate.

When a person later confirms or overrides a decision, record it — this is what turns the register
into something thresholds can be tuned from:

```python
from aimeat_crewai import review
review(v.decision_id, "overridden", note="Sent it by hand instead.", agent_name="mailer")
```

### Tuning the thresholds (0.27.1+)

Step six of the setup order, and the one the other five exist for: a threshold nobody tuned is a
guess with a decimal point, and what you tune it from is the decisions already made.

```python
from aimeat_crewai import decision_stats

for g in decision_stats(group_by="rule", agent_name="mailer"):
    print(g["key"], g["decisions"], g["outcomes"], "held:", g["gateStops"],
          "overridden:", g["overridden"], "$", g["costUsd"])
```

Counted in the store, so the figures are exact however many decisions there are — a tally taken
from `decisions()` would be a tally of one page. `group_by="principal"` gives the same numbers per
caller, and `rule_id=` with `principal=` gives one agent's share of one rule.

`overridden` and `confirmed` are only as good as your `review()` calls: with nobody's verdict on
record, every decision looks equally good forever. Grouped by rule, decisions that named no rule are
left out, and so is the owner's Try of a rule on its sample — a try is a real, paid, recorded
decision, but it is not one of the rule's, and counted among them it would flatter or spoil the
numbers with a state written to get a known answer.

### Check before you build on it

```python
from aimeat_crewai import settings

s = settings(agent_name="mailer")
if not s["available"]:
    print(s["unavailable_reason"])   # the node's own sentence: what to set, and where
```

Refusals arrive as `DecideRefused` carrying the node's **own** code — `NO_API_KEY`,
`AGENT_QUOTA_EXHAUSTED`, `DATAMAP_REQUIRED`, `RULE_NOT_FOR_CALLER`, `RATE_LIMITED` and the rest —
so a caller can branch on the real reason. **Only a rate limit is retryable** (`exc.retryable`,
with `exc.retry_after` in seconds): a quota that is used up is used up and a permission that is
missing is a standing fact, so a retry loop around either burns the budget it is reacting to and
buries the message that would have fixed it.

### Direct mode — a run with no node

Behind an explicit switch, never inferred:

```bash
export AIMEAT_DECIDE_DIRECT=1
export AIMEAT_DECIDE_KEY_ENV=TYPESAFE_API_KEY   # the VARIABLE, the way the node names one
```

It says once, at start-up, exactly what it loses: the node does **not** scrub personal data out of
the state, the decision is **not** on the owner's register, no daily or per-agent cap applies, and
an identical earlier answer is **not** reused — every call is paid for. It still sends only the
fields the rule names (pass the rule's own document as `direct_rule=`, since there is no node to
read it from), and it writes every decision to `<AIMEAT_HOME>/decide/direct-log.jsonl`.

Push that log to a node once there is one:

```python
from aimeat_crewai import push_direct_log
push_direct_log(agent_name="mailer")
```

It lands in memory under `agents.<name>.decide.direct-log`, labelled as decisions made without the
node — **not** on the decision register, because a row claiming to be one would make the owner's
quality numbers read as though the scrubber and the cap had been in force.

The node never sends a key. When the owner has given an agent one, `settings()` names the
environment variable it lives in (`agent.key_env`) and never the key itself.

> Our own measurements of the decision model (accuracy, speed, cost) stay unpublished: TypeSafe's
> customer agreement forbids publishing benchmarks of it. Figures TypeSafe publishes itself may be
> repeated as TypeSafe's claim, with the source named and linked.

## Compatibility

| `aimeat-crewai` | AIMEAT node | CrewAI |
|---|---|---|
| 0.1.x | 1.13.0+ | 0.80+ |
| 0.2.x | 1.13.5+ | 1.14+ (Skills); 0.80+ if `skill_path=None` |
| 0.3.x | 1.14.0+ (for `aimeat_task_create`) | 0.80+ |
| 0.4.x | 1.21.0+ with `AIMEAT_CONNECT_TUNNEL_ENABLED=true` for the tunnel (degrades to direct HTTP on older nodes) | 0.80+ |
| 0.16.x | 1.38.0+ for the usage ledger (older nodes accept the telemetry but record no ledger row) | 0.80+ |
| 0.17.x | 2.2.0+ for file helpers (`?mode=handle` on `/v1/pub`, `resources.files` on tasks). Against an older node, reading a file the owner shared still works over plain `GET /v1/pub/{owner}/{key}` — only the handle + task-attachment helpers need 2.2.0. | 0.80+ |
| 0.20.x | 3.3.0+ for data packages (`/v1/datapackages`). `read_package` and `to_dataframe` need only the package's public address, so they read a package from ANY node that publishes one; `publish_package` and `package_versions` need the routes. | 0.80+ |
| 0.22.x | 3.9.0+ node AND `aimeat` connector for server-initiated invokes (`/local/invoke/next` on the serve daemon). On an older serve daemon the listener logs once that the surface is missing and the rest of the daemon is unchanged. | 0.80+ |
| 0.27.x | **Node 3.18.0+** for decision rules (`/v1/ai/decide`, `/v1/ai/decide/rules`, and `/v1/ai/decisions/stats` for `decision_stats()`), and an owner who has set a TypeSafe key. `settings()` says whether this owner can use it at all and why not — check it before building a path on it. A node below 3.18.0 has none of these doors. For the liaison to SEE the decide tools over MCP, the machine also needs the `aimeat` connector at 3.18.0+: an older CLI refuses an undeclared parameter, so check the CLI version before reporting a node fault. Direct mode needs no node at all. | 0.80+ |

## License

MIT. See [LICENSE](LICENSE).

## Full working demo

The [crewfive](https://github.com/miikkij/crewfive) repo is an open-source CrewAI project that uses `aimeat-crewai` end-to-end -- a real multi-agent crew with web research, editing, writing, and AIMEAT integration through the liaison agent. Clone it as a starting point for your own crew.

## Repository

This package is part of the AIMEAT monorepo: [github.com/miikkij/aimeat-protocol](https://github.com/miikkij/aimeat-protocol), under `python/aimeat-crewai/`. File issues and PRs against the monorepo.
