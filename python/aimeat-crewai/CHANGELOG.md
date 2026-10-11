# aimeat-crewai change log

What each release gives you as a user of the package. Releases up to 0.27.1 are in the repository's
[CHANGELOG.md](../../CHANGELOG.md).

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
