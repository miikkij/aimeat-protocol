# aimeat-crewai change log

What each release gives you as a user of the package. Releases up to 0.27.1 are in the repository's
[CHANGELOG.md](../../CHANGELOG.md).

## 0.37.0 - 2026-10-22

- **Python 3.11 or newer is required.** Python 3.10 reaches its end of life in October 2026, and
  Pillow 13, which fixes the critical and high Pillow advisories, does not install on it. A crew on
  Python 3.10 keeps 0.36.0.
- **Group chat.** `open_group()` opens a group with several people or agents of the node and sends
  its first message; `group_members()`, `change_group_members()`, `leave_group()`,
  `group_invitations()` and `answer_group_invitation()` do the rest. A person whose contacts accept
  you joins at once, anybody else is invited and sees the group after accepting; each name you give
  comes back as added, invited or refused with the reason. Write in a group with POST /v1/messages and
  its `conversation_id`. `as_owner=True` acts in your owner's name and needs the
  messages:send-as-owner scope. Needs a node that serves /v1/messages/groups (a release after node 4.1.2).
- **`sse_params()` points at a path the node serves.** Its default path was `/v1/mcp/sse`, which
  the node never served, so a crew built with it could not connect. The default is now `/v1/mcp`.
  The node serves MCP over Streamable HTTP and has no separate SSE endpoint: to reach a node, use
  `http_params()`; `sse_params()` is for an SSE bridge you run in front of one.

## 0.36.0 - 2026-10-19

- **`build_offer()` asks for a `deliverable`, as the node does.** The node refuses an offer without
  one, and its catalogue then left out every offer of that agent, with no message. Now
  `build_offer()` without `deliverable=`, or with one that is not a dict, raises `TypeError`, and a
  deliverable whose `format` the node does not accept raises `ValueError`; both name the field. The smallest one the node accepts
  is `deliverable={"format": "document"}`; add `"location": {"key": "<memory key>"}` to make the
  offer usable in a workflow. The formats are in `aimeat_crewai.offers.DELIVERABLE_FORMATS`.
- **Upgrading:** a call to `build_offer()` without `deliverable=` worked before and raises now.
  Add the deliverable your agent produces. An offers document you write by hand is not checked.

## 0.35.1 - 2026-10-15

- **A retire stops only your own agent.** When two owners each have an agent with the same name in
  one workspace, the daemon now reads only the engagements of its own owner's agent. Before, it
  compared the agent name alone, so one owner retiring their agent could stop the other owner's
  agent of the same name, and an active engagement of one could keep the other running. A daemon
  that runs agents of one owner only works as before.

## 0.35.0 - 2026-10-12

- **A default daemon agent reaches every capability of the node.** `DAEMON_DEFAULT_TOOL_FILTER` has
  30 tools: the 25 it had, plus `aimeat_discover`, `aimeat_invoke`, `aimeat_mcp_list`,
  `aimeat_mcp_tools` and `aimeat_mcp_call`. With `aimeat_discover` the agent finds what the node can
  do, and with `aimeat_invoke` it runs any capability by its id, so it uses a tool that is not in
  its list without loading every description. The three `aimeat_mcp_*` tools do the same for the
  remote MCP servers the owner attached to the node. The call still needs the permission the tool
  needs: `mcp:read` to list, `mcp:use` to call.
- **The new tools cannot stop your daemon from starting.** A tool filter stops the start when it
  names a tool the server did not expose. The five new names are loaded when the server offers
  them and left out, with one printed line, when it does not (`DAEMON_TOOLS_IF_OFFERED`): a
  connector started with `--surface agent`, an agent without the `mcp` permissions on a node's own
  MCP, or a connector older than the tool. The 25 earlier names stay required.
- `create_liaison_agent(tool_filter_if_offered=[...])` gives your own filter the same behaviour for
  the names you choose, and `select_liaison_tools()` is the function that decides. A filter you
  write is required in full, as before.
- With `aimeat` 3.26.1 or older as the connector, 30 node tools answer over MCP and not through
  `/local/call` (contacts, companies, beneficiary splits, exchange work and proposals, organism
  owners and email invitations, `aimeat_notify`, `aimeat_usage_report`, `aimeat_app_tool_invoke`).
  The `aimeat` release after 3.26.1 serves them on both.

## 0.34.0 - 2026-10-11

- **An offer has two values: a money price and a pacing amount.** `build_offer()` takes
  `price_money={"amount": <micro-units>, "currency": "EUR"}` (none means the offer is free) and
  `toll_morsels=n`, the morsels each use by another owner debits from that owner. Part of the
  pacing burns and the rest reaches your owner. A morsel paces use and is never a price.
- **Deprecated:** `build_offer(price={"morsels": n})`. It still works: it warns
  (`DeprecationWarning`) and writes the amount as `tollMorsels`, added to any `toll_morsels`, so
  your offer keeps the same pacing. The node accepts the old field until 4.0.0 and refuses it
  after, so change the call before then.
- `assess_offer()` / `aimeat-offers check`: the "priced" level now means "offered to other owners"
  and passes with a money price or a pacing amount (plus public visibility and a callable). An
  offer stored with the old `price.morsels` still passes.

## 0.33.0 - 2026-10-11

- **The owner can stop your agent, and the daemon respects it.** On a node built after 2026-10-11 a
  stopped agent gets no new task and no message, and its task list and inbox say
  `agent_stopped: true`. The daemon prints the change once and holds the catch-up scan it runs after
  a tunnel reconnect until the owner starts the agent again. Work already running finishes. Against
  an older node nothing changes.
- **`run_crew_daemon(stop_event=...)`** takes a `threading.Event`. Set it and the daemon ends within
  5 seconds, lets a running kickoff finish and exits as it does on SIGTERM. With an event, the
  daemon can also run in a thread that is not the main thread.
- **Fixed:** an agent that listens for messages no longer receives each of its tasks once as an
  empty inbox message.
- **Provenance:** `ask()` and `upload_file()` take `ai_provenance` (how the content was made) or
  `ai_provenance_id` (a record the node already made), and return what the node recorded.
  Declaring needs the `provenance:write` scope. `provenance.py` has `MediaKind` (text, image, audio,
  video) and the `TRANSCRIBED` level, so a label can say what kind of content it describes.
- **Clearer AI errors:** a decision provider's refusal of the key that pays is `INVALID_API_KEY`
  with status 424, in direct mode as well. The error help names `PROVIDER_REJECTED`,
  `CONTENT_REFUSED` and `PROVIDER_NO_CREDIT` as refusals that a retry does not fix, and a
  provider's own rate limit as one that it does.

## 0.32.1 - 2026-10-04

- **Fixed:** an optional field the model left out is no longer sent as null inside a list item, so
  the node no longer refuses a todo with "expected string, received null".
- The daemon's default tools include `aimeat_task_decline`, so a crew that refuses a request with
  its reason ends the task as declined, not failed.
- **Fixed:** an expired stored agent token is never sent. `node_llm` goes through the serve daemon
  first when it serves the agent, because the daemon's credential is always current. `decide()`, the
  rule and register calls, `capabilities()`, `effective_llm_choice()` and `publish_offers()` use the
  daemon when no current token is left; otherwise they fail before sending anything and name the
  token file, its expiry and what renews it.

## 0.32.0 - 2026-10-02

- **A crew can think through the node with the owner's own key.** `llm_for_choice` builds the LLM
  for the owner's crew model choice, and a `{kind: 'node'}` choice uses `node_llm`. An agent with no
  stored token goes through the connector daemon's `/v1/llm` pass-through.
- `effective_llm_choice` reads the model choice that applies to an agent, as the node decides it:
  the agent's own, the owner's default, or the node when the agent may use it.
- `unsafe_choice_reason` applies the node's rule to a model choice on read: the key variable must
  be a provider key, and every address must be public https.
- A PROPOSE task asks the crew to mark a todo that spends money, sends in the owner's name or
  deletes the owner's data, so the owner approves the plan before the work starts.

## 0.31.1 - 2026-09-30

- The liaison's instructions say what to do with classified content: tell the person about a
  `classification_warning` and do not repeat the content outward, do not retry a `CLASSIFIED`
  refusal, and leave an exception to the person, in their Data Wallet.

## 0.31.0 - 2026-09-30

- **A run the node refused is no longer reported as a success.** After each task run the daemon
  asks the node which of the agent's calls it refused for a missing permission. If there are any,
  the run raises `NodeRefusedDuringRun`: it is printed as refused, passed to `on_error`, and an
  EXECUTE task fails with the call and the permission named. A refused PROPOSE is not retried.

## 0.30.1 - 2026-09-28

- `node_llm(role=...)` runs the crew's model calls as one of the owner's AI roles, so the owner's
  role decides the providers and models.

## 0.30.0 - 2026-09-28

- `node_llm()` returns a CrewAI LLM that calls the node's `/v1/llm` with the agent's token, so the
  owner's model policy, key order and budget apply to the crew's calls.
- `capabilities()` reads what AI is available to the agent, which model, and why something is off.

## 0.29.0 - 2026-09-24

- **Required for node 3.20.0 or later.** The serve daemon now answers only its own callers: it
  writes a fresh secret into `serve.json` at each start and refuses a request without it.
  `serve_params()`, the liveness probe behind `ensure_serve()`, `ServeClient` and the daemon's REST
  helpers send it. `serve_auth_headers(doc)` gives the header to a client that builds its own
  session.

## 0.28.0 - 2026-09-23

- **Decision providers.** `decide()` and the rule calls take `provider`, the id of the decision
  provider to ask. Leave it out and the node picks: the rule's, the agent's, the owner's default or
  the node's. A local decision model needs no key and costs nothing. `Decision.provider` says which
  provider answered, the decision list names it on each row, and the quality numbers can be grouped
  by provider.

## 0.27.3 - 2026-09-20

- **Fixed:** `push_direct_log()` writes one memory record per day and sends only the new lines, so
  a long direct-mode run no longer reaches the size limit of a single record.

## 0.27.2 - 2026-09-20

- **Fixed:** a missing confidence in a decision answer is no longer read as zero certainty. The
  outcome is then `ask`, a person's call, instead of `stop`.
