"""
Long-running crew daemon: keeps the liaison alive, polls AIMEAT for queued
tasks (and optionally inbox messages), kicks off the crew for each, and lets
the liaison report results back to AIMEAT.

This is the second half of the AIMEAT-CrewAI integration story:
  - `create_liaison_agent` (one-shot): proves a single crew invocation can do
    Hello Integration + AIMEAT-side coordination. Useful for testing.
  - `run_crew_daemon` (always-on): keeps a Python process alive that listens
    for AIMEAT tasks/messages and runs the crew per arrival. This is what
    turns a CrewAI crew into a citizen of an AIMEAT network -- other agents
    (Claude Desktop, Hermes, another crew) can queue tasks for it via the
    `aimeat_task_create` MCP tool (AIMEAT >= 1.14.0), and the daemon picks
    them up automatically.

Changelog:
  0.26.0 -- A refusal stops being indistinguishable from an empty result. Five node calls read the
    status, threw it away and returned a neutral value -- `_poll_tasks` [], the message body "",
    `_poll_messages` [], `_agent_engagements` None, `_space_contract` None -- so an agent whose
    owner had not granted the scope looked exactly like an agent with nothing to do. 401 and 403
    are now separated from every other non-200 by `_Api.refused()`, which records the node's own
    error code and prints it once per (call, code) and again when it changes. Reported by
    crewaimeat on 2026-09-06, after two hours spent looking for the bug in the wrong place.
    NO EXCEPTION IS RAISED, and that is the design rather than caution: the poll loop wraps its
    whole body in one `except Exception`, `_drain_records`/`_drain_dms` have already taken their
    events off the loopback queue by the time one could be raised, and a 403 does not clear
    itself -- so raising would drop those events and abandon the rest of the cycle, every cycle,
    for as long as the scope was missing. The return contracts are unchanged; what changed is
    that the daemon now says which door was shut and which scope shuts it.
    The engagement gate keeps its documented fail-OPEN (§7d): failing closed on a refusal would
    skip every record in every workspace, which stops the agent for a reason it cannot report.
    The other node calls are left alone on purpose. `_is_cancelled` is a deliberate, documented
    fail-safe; `_mark_message_delivered` returns a bool the next cycle retries; the remaining
    status checks are `/local/*` loopback calls, which carry no scopes.
  0.25.1 -- The two call sites that build the liaison's MCP session now pass `identity.gaii`,
    not the bare `agent_name`. 0.25.0 taught the SESSION to carry an identity and this file kept
    handing it the credential's NAME, so a two-owner daemon refused every liaison it opened --
    correctly, and with a message naming exactly what to send. The daemon resolved the identity
    at the top of `run_crew_daemon` and used it everywhere else (the `_Api` header, every
    `/local/*` `agent=` param) and then dropped it at the one door that needed it most. Two sites,
    not one: the long-lived liaison and the per-task EXECUTE worker. `test_serve_params_identity`
    pins both by reading this module's source, because the next call site added will look like
    the two that were wrong.

  0.25.0 -- The MCP session says who it is. `serve_params()` sent only the placeholder
    `Authorization` header the daemon never validates, and no `X-Aimeat-Agent` at all, on the
    documented assumption that "the daemon uses its primary agent" when none is named. That default
    is gone: `primary` became per-owner, so a daemon holding two owners has two correct answers and
    refuses rather than guessing. Every liaison opened an anonymous session, the daemon refused it,
    and the MCP adapter -- waiting on a socket rather than reading a status -- timed out after 30
    seconds having reported nothing, while the refusal that named the fix went unread. The resolved
    GAII is now sent on the session, never the bare name.
    MINOR, NOT PATCH: `serve_params()` now RAISES where it used to return, when the identity is
    ambiguous -- a bare name two owners share, or none given with several loaded. That is a
    contract change even though the path it replaces did not work. The refusal is immediate and
    names the candidates, in the same words the connector registry and the daemon's own MCP
    endpoint use; a half-minute of silence is worse than being told which identity to send.
    The stdio and direct-HTTP param builders are untouched -- they are for environments with no
    local connector, and the loopback's identity is not their problem. (Naming them in full here
    would break test_no_per_task_subprocess_churn, which greps this module for the stdio builder
    to prove the worker path never spawns one per task.)
  0.24.0 -- The credential's NAME and the routing IDENTITY are two values. This package drove both
    from one `agent_name`, and in a two-owner home they diverge: the filename is
    `keys/crew-forge@isoalice.key` and routing wants
    `X-Aimeat-Agent: crew-forge#isoalice@aimeat-iso-001-a`. Passing a GAII where a name belonged
    searched for `keys/crew-forge#isoalice@node@*.key` and found nothing; passing a name where a
    GAII belonged routed to whichever owner matched first, or -- since the connector started
    refusing an ambiguous bare name -- to nothing. `AgentIdentity` + `resolve_agent_identity()` now
    carry both, and THE GAII IS READ, NOT ASSEMBLED: out of the v2 key file's own field or the v1
    bearer's `sub`. Building it from parts would be a fourth place that has to agree about the node
    id. `_Api` routes by `identity.gaii` (header and every `/local/*` `agent=` param) and builds
    `/v1/agents/{name}/...` from `identity.name`; a bare string is still accepted and behaves
    exactly as before, which is correct on a single-owner daemon.
    Also `serve_params()` matches a row by EITHER `agent` or `gaii`. serve.json has carried `gaii`
    since schema 2 and this compared only the bare name, so an agent addressed by its full identity
    -- the only unambiguous way on a two-owner daemon -- was called "not registered" by the daemon
    holding its socket, and the error then listed the bare names: it printed the halves it had not
    compared.
  0.23.1 -- The per-agent config is read from the path the connector actually uses. It moved to
    `agents/{owner}/{agent}/config.yaml` on 2026-09-01 (one shared file gave two owners with a
    `concierge` a single node_url and a single runner command between them). This still read the old
    shared path only, found nothing on any current install, and fell through to the default --
    which is aimeat.io, so a LOCAL test agent reported PRODUCTION as its node. Nothing calls it,
    because calls go through the loopback, but a runtime that trusted it would. New path first, old
    path still read for an install that has not migrated.
  0.23.0 -- A v2 agent can start. `_read_token` looked only in `tokens/`, so every agent the
    basic-agents button creates -- all of them v2, holding a KEY rather than a bearer -- was refused
    before anything else ran: `No token file matching .../tokens/concierge@*.token`, for a
    credential sitting on disk one directory across in `keys/`. Either family now satisfies the
    check. Nothing else changes, because nothing consumed the token: this call is a FAST FAILURE so
    that an agent this machine was never connected for says so at once, and the real credential is
    held by the loopback serve daemon, which routes by `X-Aimeat-Agent`. That fast failure is kept
    and now names both places it looked. Ambiguity is judged by OWNER rather than by file, so one
    owner holding both a token and a key -- what a v1 agent that migrated to a key leaves behind --
    is no longer a conflict.
  0.22.1 -- The onboarding driver reads the tool's answer (onboarding.py). A tool returns a failure
    as a VALUE, it does not raise, and the driver logged the attempt before the call and nothing
    after it: a new agent's accept_test_task failed 15 times in a row with the same call and no line
    said why. Now every call logs `ok` or `FAILED: <the node's message verbatim>`, an identical call
    that fails with the same code twice ends the run (OnboardingError.last_error / last_step carry
    the cause), a step_args override is logged as such, and a `{test_task_id}` the node did not fill
    is never sent as an empty id.
  0.22.0 -- Server-initiated invokes (the Crew tab's Validate and Try). The node can now ask a running
    crew to do something and wait for the answer over the connector tunnel's `invoke` frame; the serve
    daemon queues each one on `GET /local/invoke/next` and takes the reply on
    `POST /local/invoke/<id>/result` (AIMEAT >= 3.9). `run_invoke_listener(agent_name, handler)` is the
    consumer: a thread that polls from the moment it starts (the serve daemon answers NO_HANDLER for an
    agent nobody has polled in 90 s, so a listener that only starts on demand is an agent that cannot be
    asked), runs each handler in a small pool so a minutes-long `crew.try` does not block the next
    `crew.validate`, and answers HANDLER_ERROR when the handler raises. `run_crew_daemon(on_invoke=...)`
    starts one alongside the poll loop and stops it with the loop. The two capabilities the Crew tab
    sends are `crew.validate` ({doc} -> {errors: [...]}) and `crew.try` ({doc, prompt} -> {output, ...}).
    A publish also wakes a records-parked agent with a `crew.def_updated` event on /local/records/next.
  0.21.0 -- PROPOSE also picks up PLAN-LESS ACTIVE tasks. It polled 'queued' only, and a task-runner
    agent has no queued tasks -- the node auto-activates them on create, and the Hello Integration
    test task is born active for every mode. So the plan was never proposed and EXECUTE completed the
    task with an empty TODO list. On the test task that stranded Hello Integration at 6/7 for good
    (accept_test_task needs todos; complete_test_task passed regardless; a done task refuses a plan).
    See `_has_no_live_plan` + the PROPOSE phase in the poll loop.
  0.16.5 -- Unified wake (the general event-responsiveness fix). When the serve daemon exposes it, the
    idle wait parks on /local/wake/next, which resolves the instant ANY push source (task/record/dm/
    message) arrives -- without consuming -- so a multi-source agent wakes on EVERY source instead of
    only its single parked queue. Supersedes 0.16.4's tasks-quick-check for supported serves and also
    closes the remaining ≤30s dm-latency (records+dms+tasks) and ≤poll-interval message-latency
    (messages+tasks) gaps. Falls back to the 0.16.4 per-queue park on an older serve (404 -> latched).
    See `_wait_unified` + the `wake_unified` gate.
  0.16.4 -- Task pushes wake a records/dms-parked agent (the real event-responsiveness fix). An agent
    listening for BOTH records (or dms) AND tasks parks its idle wait on the records/dm queue (those have
    park-priority), so a task push -- which lands in /local/tasks/next -- never answered that park and
    tasks were only re-listed on the ~5-min safety net (offer/approve orders sat for minutes even with a
    live tunnel; e.g. image-maker, a records+tasks contract agent). `_wait_for_work` now quick-checks
    /local/tasks/next (wait=0, consume-safe: the next cycle re-lists tasks from the store) each slice when
    parked off the tasks queue, so a task push starts EXECUTE within a slice. 0.16.3's push_wake fix was a
    real but DIFFERENT latent bug (startup latch); this is what image-maker actually hit.
  0.16.3 -- Live transport re-evaluation (event-responsiveness fix). push_wake was latched ONCE at
    startup from the discovery-time transport; in a fleet the shared serve daemon brings each agent's
    tunnel up asynchronously, so an agent that started before its tunnel was ready stayed in interval
    polling for its whole life and never went event-driven (tasks picked up ~a poll tick late instead
    of on the create/approve push). The loop now re-derives push_wake from a fresh /local/status each
    cycle (loopback-only, not a node call) via the pure `_resolve_push_wake`: a direct agent upgrades to
    push the moment its tunnel connects (and forces one catch-up re-list), and downgrades if it drops.
    /local/status is now fetched every cycle (previously only when push was already on) — still free.
  0.14.0 -- Contract-engagement gate (docs/agent-workspace-contracts.md §7d). A pushed workspace-record
    wake is now dropped when this agent's engagement for that workspace/contract is RETIRED — the
    deterministic half of "Retire actually stops the agent" (retired -> skip; active/absent -> process;
    legacy ws with a known contract -> process + backfill an active engagement). Fail-open on any read
    error. See _engagement_verdict / _agent_engagements / _space_contract / _backfill_engagement.
  0.9.0 -- Interactive messages (federated AskUserQuestion). The dm.inbound wake now carries
    `interactive` ("questions" | "answers" | None) so an on_dm handler can tell a question it should
    answer from an answer to one it asked. New crew helpers in aimeat_crewai.messaging: ask() sends a
    structured question, read_answers()/answers_from_dm() fetch the human's machine-readable picks,
    build_question() shapes one, serve_client() builds a loopback REST client. Requires AIMEAT >= 1.31.
  0.8.1 -- Fix the DM wake-consume bug (0.8.0 lost DMs with listen_for="dms" + on_dm). The idle wait
    long-polls the wake queue (`_wait_for_work` on /local/dm/next for a dms agent), which CONSUMES the
    event off the serve queue. Tasks were fine (the next cycle re-lists from the store), but the DM and
    record queues are the ONLY source -- the wake popped the dm.inbound event and discarded the body, so
    the following _drain_dms found nothing and on_dm never fired (a single DM = one wake = lost).
    `_wait_for_work` now RETURNS the consumed payload instead of a bare bool, and the loop hands a dm /
    record wake event straight to _handle_dm / _handle_record; the next cycle's drain still collects any
    further events. (Same latent issue fixed for records.) No node/connector change -- 1.30.2 still fine.
  0.8.0 -- Federated-inbox DM push. `run_crew_daemon` gains listen_for="dms": when a direct message
    addressed to this agent arrives, the node pushes a `dm.inbound` wake over the connector tunnel and
    the daemon drains it from the new /local/dm/next long-poll (a queue separate from tasks + records,
    so wakes never intermix) -- via an `on_dm(event)` callback, or wrapped into a synthetic task ->
    build_crew. A dms-driven agent parks its idle wait on the DM long-poll: event-based, no DM poller.
    The wake is record-shaped (id, conversationId, subject, senderGhii, preview, attachments (count),
    createdAt); read the full body/attachments via aimeat_dm_thread(conversationId) and reply in-thread
    with aimeat_dm_send. Requires AIMEAT >= 1.30.2 (node push + /local/dm/next); older serve daemons
    simply return 204.
  0.7.1 -- Stop the per-cycle tunnel polling (prod showed ~600 MB / 5 min of /v1/connect/tunnel
    from daemons re-listing tasks every cycle). Two changes: (1) when the agent has a live tunnel,
    the cycle re-lists tasks from the node ONLY when a push woke it (`_wait_for_work` now returns
    whether a push arrived) + a rare safety-net interval (max(poll_interval, 300s)); idle cycles do
    NOT re-poll. With no tunnel it polls every cycle as before. Future-reaping stays local + every
    cycle. (2) `_is_cancelled` no longer scans owner-scoped `agents.cancel.*` memory before every
    dispatch -- the node pushes `task.cancelled` and the serve daemon holds the set, so it's a free
    loopback `/local/cancelled` read (legacy memory scan kept only as a fallback for an old connector
    without that endpoint). Net: an idle records-only agent makes ZERO periodic node calls.
  0.7.0 -- Workspace record push (P1). `run_crew_daemon` gains listen_for="records":
    given `record_spaces` (lists of {organism_id, ws, space}), it subscribes them with
    the serve daemon (POST /local/subscribe -> a `subscribe` frame over the tunnel, re-sent
    on reconnect) and acts on each pushed `workspace.record` event drained from the new
    /local/records/next long-poll -- via an `on_record(event)` callback, or wrapped into a
    synthetic task -> build_crew. The idle wait parks on the record long-poll, so a
    records-only contract agent makes ZERO periodic node calls. A tunnel reconnect (tracked
    via /local/status `reconnects`) fires one synthetic catch-up event (op="catchup") per
    space so the handler re-scans for writes missed while disconnected. Requires an AIMEAT
    node + connector that support record push; older serve daemons simply return 204/no subs.
  0.6.0 -- Directory-scoped connector home. The connector home (serve.json,
    agent tokens, per-agent config, the serve daemon) now defaults to
    `<cwd>/.aimeat` instead of the global `~/.aimeat`, resolved by the new
    `paths.aimeat_home()` (single source of truth across the package, mirroring
    the Node connector's getConfigDir). `AIMEAT_HOME` still overrides and always
    wins. This isolates each project: two crews / two `aimeat connect serve`
    daemons on one machine no longer collide on a single global serve.json
    (which caused refused-daemon / wrong-agent routing / "pid alive but does not
    answer"). `ensure_serve` pins `AIMEAT_HOME` into the serve daemon it spawns,
    so the Node daemon and the Python side always resolve the same home
    regardless of spawn cwd. MIGRATION: agents registered under the old global
    `~/.aimeat` are not moved -- run with `AIMEAT_HOME=~/.aimeat`, or re-run
    `aimeat connect add` from inside the project directory.
  0.4.0 -- Loopback serve rewiring (Connector Forward Tunnel, Phase 5). The
    daemon now talks to the long-lived `aimeat connect serve --http` loopback
    daemon (auto-started via the serve.json discovery file) instead of the node
    directly: every REST helper goes through ONE shared `requests.Session`
    against `http://127.0.0.1:<port>` with the `X-Aimeat-Agent` header (the
    serve daemon holds the bearer token and one persistent WS tunnel per agent
    to the node -- loopback keep-alive is effectively free, and there is no
    per-call TLS handshake). The liaison's MCP likewise targets the loopback
    `/v1/mcp` via `serve_params()`. Concurrent EXECUTE workers NO LONGER spawn
    an `aimeat connect serve` stdio subprocess each -- loopback HTTP is
    naturally concurrent, so every per-worker liaison shares the one daemon
    (zero subprocess churn). When the agent's transport is 'tunnel', the idle
    wait between cycles parks on the serve long-poll (`/local/tasks/next`)
    and wakes the instant a task is delivered -- true push instead of a fixed
    poll interval. Degraded mode (node tunnel off/too old) is transparent:
    the serve daemon falls back to direct HTTP itself and the daemon keeps
    the classic interval sleep (the long-poll would always time out).
  0.3.8 -- `max_concurrent_tasks` (#16). run_crew_daemon gained a
    `max_concurrent_tasks` arg: `None` (default) reads the owner-configured value
    from the AIMEAT integration kit (`watchdog_spec.max_concurrent_tasks`, set in
    the profile Tasks tab; needs AIMEAT >= 1.16.2); an int overrides it. 1 =
    serial (unchanged behaviour, one shared liaison). >1 runs EXECUTE tasks on a
    bounded thread pool where EACH task gets its OWN liaison + MCP connection (a
    shared stdio MCP can't be driven by parallel kickoffs). PROPOSE and inbox
    messages stay serial on the shared liaison. In-flight tracking prevents
    double-dispatch; cooperative cancellation is re-checked per worker just
    before kickoff; crashes still fail the task. Drains the pool (waits for
    running kickoffs) on shutdown.
  0.3.7 -- Cooperative cancellation. Before each (blocking) EXECUTE kickoff the
    daemon re-checks whether the subtask is still wanted: it skips + fails the
    task if its status is no longer active/stalled (owner paused/deleted it) OR
    if its id appears in any `agents.cancel.*` memory marker visible to the
    owner (owner_scope) -- markers a coordinator or the owner writes to cancel
    work it delegated. Stops abandoned/speculative subtasks from ever starting
    (circuit breaker for the "coordinator over-delegated to one crew" case).
    Running kickoffs are not interrupted (cooperative, not preemptive).
  0.3.6 -- Fix inbox message dispatch. _poll_messages() read the non-existent
    data.messages key (the node returns data.pending_messages / data.items), so
    message-triggered crews never ran. Also: inbox items carry only a ~100-char
    preview, so we now fetch full content per message via
    GET /v1/agents/<agent>/messages?thread_id=, and PATCH the message to
    status=delivered after a successful kickoff so it is not re-dispatched every
    poll cycle (plus a process-local done_ids guard).

Usage:

    from aimeat_crewai import run_crew_daemon
    from crewai import Agent, Crew, Task

    def build_crew_for_task(task, liaison):
        researcher = Agent(role="Researcher", goal="...", backstory="...")
        writer     = Agent(role="Writer",     goal="...", backstory="...")
        return Crew(
            agents=[liaison, researcher, writer],
            tasks=[
                Task(description=task["description"], agent=researcher),
                Task(description="Write up the research as a summary.", agent=writer),
                Task(
                    description=(
                        f"Mark AIMEAT task {task['id']} complete with the writer's "
                        f"output as the deliverable. Use aimeat_task_complete."
                    ),
                    agent=liaison,
                ),
            ],
        )

    run_crew_daemon(
        agent_name="demo-crew",
        build_crew=build_crew_for_task,
    )

Wrap the invocation in your favourite supervisor (systemd, pm2, a small Bash
loop) to restart on crash. The daemon itself does NOT manage its own
restart -- that is intentionally the supervisor's job, and a thrash-detector
in the supervisor should prevent crash loops.
"""
from __future__ import annotations

import base64
import binascii
import json
import signal
import sys
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .liaison import AimeatLiaisonError, create_liaison_agent
from .mcp_client import ensure_serve, serve_params
from .paths import aimeat_home
from .usage_telemetry import install_usage_telemetry, usage_run

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `requests` package is required for the daemon. Install: pip install requests"
    ) from exc


def _refusal_detail(r: Any) -> tuple[str, str]:
    """The node's own `error.code` and `error.message` from a refused response.

    The AIMEAT envelope carries both and the message names the missing scope in words
    ("Scope \\"messages:read\\" required. Agent scopes: [memory:read, memory:write]"), which is
    the one line that turns "the agent is quiet" into a thing the owner can act on. A body that
    is not the envelope (a proxy's HTML, a truncated read) falls back to the status alone rather
    than raising -- this runs on the reporting path, and a reporter that throws reports nothing.
    """
    try:
        err = (r.json() or {}).get("error") or {}
        if isinstance(err, dict):
            return str(err.get("code") or f"HTTP_{r.status_code}"), str(err.get("message") or "")
    except Exception:  # noqa: BLE001, S110 -- the body was not the envelope; the status alone is still worth printing, and a reporter that raises reports nothing
        pass
    return f"HTTP_{r.status_code}", ""


class _Api:
    """Shared HTTP context for the daemon's REST helpers (0.4.0+).

    `base_url` is the LOOPBACK serve daemon (`http://127.0.0.1:<port>`), not
    the node: the serve daemon proxies any `/v1/...` path over its persistent
    WS tunnel (or direct HTTP when degraded) and holds the agent's bearer
    token itself, so no Authorization header is needed here. The
    `X-Aimeat-Agent` header picks which registered agent the call runs as.
    One `requests.Session` is shared by every helper -- loopback keep-alive
    makes the 30s poll cycle effectively free.
    """

    def __init__(self, base_url: str, identity: AgentIdentity | str, session: Any = None) -> None:
        # ROUTING TAKES THE GAII, PATHS TAKE THE NAME. On a daemon holding two owners a bare name
        # is ambiguous and the connector refuses it by design, so the header must carry the full
        # identity; the node's `/v1/agents/{name}/...` routes are scoped by the caller the header
        # just named, so the bare name is right there and reads better in a log.
        # A plain string is still accepted for callers that predate AgentIdentity: it is used for
        # both, which is exactly the old behaviour and correct on a single-owner daemon.
        if isinstance(identity, str):
            self.agent_name = identity
            self.gaii = identity
        else:
            self.agent_name = identity.name
            self.gaii = identity.gaii
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update({"X-Aimeat-Agent": self.gaii})
        # Permission refusals this credential has collected, newest wins: {call label: error code}.
        # Kept rather than counted -- a refusal is a standing fact, not an event rate.
        self.refusals: dict[str, str] = {}

    def refused(self, r: Any, call: str) -> bool:
        """True when the node refused `call` because this credential may not make it.

        401 and 403 are separated from every other non-200 ON PURPOSE, and the separation is the
        whole point of this method. A timeout, a 502 or a dropped socket is a blip: the caller's
        neutral answer ("no tasks this cycle") is an honest reading of the cycle it just had, and
        the next cycle fixes it. A refusal is not that. It is a standing fact about this
        credential -- it does not clear itself, it will still be there in thirty seconds, and the
        owner has to grant the scope before it changes. Flattened into the same empty list, it
        reads as "nothing to do", and a fleet built on that conclusion sits idle looking healthy.

        Reported by crewaimeat on 2026-09-06: three calls answered with an empty list at the same
        moment the same call over REST answered 403 SCOPE_DENIED, and two hours went into looking
        for the bug in the wrong place.

        The caller keeps its return contract -- this records and reports, it does not raise. That
        is deliberate: the poll loop wraps its whole body in one `except Exception`, so a raise
        would abandon the rest of the cycle, and `_drain_records`/`_drain_dms` have already taken
        their events off the loopback queue by then (queue-only, no re-list, no catch-up), so the
        events after the raise would be lost. A 403 does not go away, so that would happen on
        every cycle for as long as the scope is missing: a fleet that never finishes a cycle
        again, which is the failure this is meant to make visible rather than a new one.

        Printed once per (call, code) and again the moment the code changes -- so the owner's
        grant shows up in the log, and a 30 s poll loop does not bury it under identical lines.
        """
        if r.status_code not in (401, 403):
            return False
        code, message = _refusal_detail(r)
        if self.refusals.get(call) != code:
            self.refusals[call] = code
            detail = f": {message}" if message else ""
            print(
                f"[daemon:{self.agent_name}] {call}: the node refused this credential -- "
                f"HTTP {r.status_code} {code}{detail}. This is not a blip and it does not clear "
                f"itself; the owner grants the scope."
            )
        return True

    def get(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.get(f"{self.base_url}{path}", **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.post(f"{self.base_url}{path}", **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.patch(f"{self.base_url}{path}", **kwargs)


def _locate_credential(agent_name: str, owner: str | None = None) -> Path:
    """
    The credential file this machine holds for `agent_name`, of either family.

    `agent_name` is the BARE NAME here, always: the file is `{name}@{owner}`, so handing this a
    GAII produces a search for `keys/crew-forge#isoalice@node@*.key`, which matches nothing and
    reports the agent as unknown when its key is sitting right there.
    """
    import glob

    home_dir = aimeat_home()
    tokens_dir = home_dir / "tokens"
    keys_dir = home_dir / "keys"

    if owner:
        token_path = tokens_dir / f"{agent_name}@{owner}.token"
        key_path = keys_dir / f"{agent_name}@{owner}.key"
        if token_path.is_file():
            return token_path
        if key_path.is_file():
            return key_path
        raise AimeatLiaisonError(
            f"No credential for {agent_name}@{owner} on this machine "
            f"(looked for {token_path} and {key_path}). "
            f"Run: aimeat connect add --agent {agent_name} --owner {owner} ..."
        )

    matches = sorted(
        glob.glob(str(tokens_dir / f"{agent_name}@*.token"))
        + glob.glob(str(keys_dir / f"{agent_name}@*.key"))
    )
    if not matches:
        raise AimeatLiaisonError(
            f"No credential for '{agent_name}' on this machine (looked in {tokens_dir} and {keys_dir}). "
            f"Run: aimeat connect add --agent {agent_name} --owner <owner> --url <node-url>"
        )
    owners = sorted({Path(m).stem.split("@", 1)[1] for m in matches})
    if len(owners) > 1:
        raise AimeatLiaisonError(
            f"Multiple owners have an agent named '{agent_name}' ({', '.join(owners)}). "
            f"Pass `owner=<name>` to disambiguate."
        )
    return Path(matches[0])


@dataclass(frozen=True)
class AgentIdentity:
    """
    An agent's NAME and its IDENTITY, which are not the same string and must not be driven from
    one value.

    This package used a single `agent_name` for two jobs, and in a two-owner home they diverge:

      name   what the CREDENTIAL FILE is called -- `keys/crew-forge@isoalice.key`
      gaii   what ROUTING wants -- `X-Aimeat-Agent: crew-forge#isoalice@aimeat-iso-001-a`

    Passing a GAII where a name belonged produced a search for
    `keys/crew-forge#isoalice@aimeat-iso-001-a@*.key`, and passing a name where a GAII belonged
    routed to whichever owner's agent happened to match first -- or, since the connector started
    refusing an ambiguous bare name, to nothing at all.

    THE GAII IS READ, NOT ASSEMBLED. It comes out of the credential itself: a v2 key file carries
    it as a field, a v1 bearer carries it as the `sub` claim. Building `f"{agent}#{owner}@{node}"`
    would be a fourth place that has to agree about the node id, and the three that already exist
    are the reason this class is here.
    """

    name: str
    owner: str
    gaii: str


def _gaii_from_credential(credential_file: Path) -> str | None:
    """The identity the credential itself carries. None when it carries none we can read."""
    try:
        raw = credential_file.read_text(encoding="utf-8").strip()
    except OSError:
        return None

    if credential_file.suffix == ".key":
        try:
            value = json.loads(raw).get("gaii")
        except (ValueError, AttributeError):
            return None
        return value if isinstance(value, str) and value else None

    # A bearer: the identity is the `sub` claim of an unverified read. Verification is the node's
    # job and happens on every call; all that is wanted here is the name to route by.
    parts = raw.split(".")
    if len(parts) < 2:
        return None
    try:
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)
        value = json.loads(base64.urlsafe_b64decode(payload)).get("sub")
    # Named rather than blind: this is a decode of one untrusted string and the ways it can fail are
    # knowable. binascii.Error is padding or an illegal character, ValueError covers JSON, and
    # AttributeError is a payload that decodes to something with no .get. Anything else here is a
    # real defect and should reach the caller instead of turning into a quiet None.
    except (binascii.Error, ValueError, AttributeError):
        return None
    return value if isinstance(value, str) and value else None


def resolve_agent_identity(agent_name: str, owner: str | None = None) -> AgentIdentity:
    """
    Read this machine's identity for `agent_name`: the credential's own name and its GAII.

    Raises AimeatLiaisonError when there is no credential here, or when the credential carries no
    identity this package can read -- guessing one would put the wrong agent on the wire.
    """
    credential_file = _locate_credential(agent_name, owner)
    resolved_owner = credential_file.stem.split("@", 1)[1]
    gaii = _gaii_from_credential(credential_file)
    if not gaii:
        raise AimeatLiaisonError(
            f"The credential at {credential_file} carries no identity this package can read. "
            f"Re-run: aimeat connect add --agent {agent_name} --owner {resolved_owner} ..."
        )
    return AgentIdentity(name=agent_name, owner=resolved_owner, gaii=gaii)


def _read_token(agent_name: str, owner: str | None = None) -> tuple[str, str]:
    """
    Check this machine HAS a credential for the agent, and read its node URL.

    The connector writes one of two credential families, and both are the agent's
    identity on this machine:
      ~/.aimeat/tokens/{agent}@{owner}.token     -- v1: a bearer token (mode 0600)
      ~/.aimeat/keys/{agent}@{owner}.key         -- v2: a signing key
      ~/.aimeat/agents/{agent}/config.yaml       -- per-agent config (incl. node_url)

    THIS FUNCTION DOES NOT SUPPLY THE CREDENTIAL, and it never did. The caller
    discards the first element: real calls go through the loopback serve daemon,
    which holds the credential itself and routes by `X-Aimeat-Agent`. What this
    is for is the FAST FAILURE -- an agent this machine was never connected for
    should say so at once, in the connector's own words, instead of failing later
    somewhere less obvious.

    Which is why looking only in `tokens/` was wrong. Every agent the
    basic-agents button creates is v2 and has a key, not a token, so the liaison
    refused all three of them before anything else ran -- `No token file matching
    .../tokens/concierge@*.token` -- for a credential that was on disk the whole
    time, one directory across. Either family satisfies the check.

    Earlier versions looked at `~/.aimeat/<agent>/.token`, which is the
    SKILL-BUNDLE directory rather than the keychain, and matched no real install
    at all.

    With `owner`, looks for that owner's credential directly; without, globs both
    families and requires exactly one match. Two owners sharing an agent name is
    ambiguous and the caller must pass `owner` -- the same rule the connector's
    own registry applies to a bare name.

    Returns (token, node_url). The token is "" for a v2 agent, because there is
    no bearer on disk to return and nothing consumes it.
    """
    credential_file = _locate_credential(agent_name, owner)

    # A key is the agent's private signing material and is not a bearer: read the file only when it
    # IS one. The distinction is the suffix, and the caller wants neither.
    token = (
        credential_file.read_text(encoding="utf-8").strip()
        if credential_file.suffix == ".token"
        else ""
    )

    # Best-effort node_url from the per-agent config. TWO PATHS, new one first: the connector moved
    # to `agents/{owner}/{agent}/config.yaml` on 2026-09-01, because one shared
    # `agents/{agent}/config.yaml` gave two owners with a `concierge` a single file -- one node_url
    # and one runner command between them. Reading only the old path found nothing on any current
    # install and fell through to the default below, which is aimeat.io: a local test agent would
    # have reported PRODUCTION as its node. Nothing calls it, but a runtime that trusted it would.
    home_dir = aimeat_home()
    credential_owner = credential_file.stem.split("@", 1)[1]
    config_paths = [
        home_dir / "agents" / credential_owner / agent_name / "config.yaml",
        home_dir / "agents" / agent_name / "config.yaml",   # pre-2026-09-01, still read
    ]

    node_url = "https://aimeat.io"
    for agent_config_path in config_paths:
        if not agent_config_path.is_file():
            continue
        text = agent_config_path.read_text(encoding="utf-8")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("node_url:"):
                raw = line.split(":", 1)[1].strip().strip('"').strip("'")
                if raw:
                    node_url = raw
                break
        break

    return token, node_url


def _poll_tasks(api: _Api, status: str = "queued") -> list[dict[str, Any]]:
    """Return list of tasks for the agent in the given status, or [] on error.

    A refusal is reported before the empty list goes back: without it, an agent whose owner has
    not granted `task:read` is indistinguishable from an agent with nothing queued.
    """
    try:
        r = api.get(f"/v1/agents/{api.agent_name}/tasks", params={"status": status})
        if r.status_code != 200:
            api.refused(r, f"tasks (status={status})")
            return []
        body = r.json()
        return body.get("data", {}).get("tasks", []) or []
    except Exception:  # noqa: BLE001 -- the node did not answer; an empty task list is the honest reading
        return []


def _has_no_live_plan(task: dict[str, Any]) -> bool:
    """True when this task carries no TODO that is still part of its plan.

    Mirrors the node's own rule (`canProposeTodos`, src/services/agent-task-rules.ts): a todo marked
    'outdated' is history, anything else is a live plan, and a plan may be proposed on a queued, a
    revision_requested or a PLAN-LESS ACTIVE task. That last case is the one this predicate is for --
    see the PROPOSE phase in the poll loop.

    Pure, so it is unit-testable without a node.
    """
    todos = task.get("todos") or []
    return not any(
        isinstance(t, dict) and t.get("status") != "outdated"
        for t in todos
    )


def _fetch_max_concurrent(api: _Api) -> int:
    """Read the owner-configured concurrency from the AIMEAT integration kit.

    AIMEAT (>= 1.16.2) exposes the per-agent runner config at
    `GET /v1/agents/<agent>/integration-kit` under
    `data.kit.watchdog_spec.max_concurrent_tasks`. The owner edits it in the
    profile Tasks tab. Default 1 (serial) on any error or if the node is older.
    """
    try:
        r = api.get(f"/v1/agents/{api.agent_name}/integration-kit")
        if r.status_code == 200:
            v = (
                r.json()
                .get("data", {})
                .get("kit", {})
                .get("watchdog_spec", {})
                .get("max_concurrent_tasks")
            )
            if isinstance(v, int) and v >= 1:
                return v
    except Exception:  # noqa: BLE001, S110 -- no watchdog spec is the normal case; the default below is the answer
        pass
    return 1


def _is_cancelled(api: _Api, task_id: str) -> bool:
    """Cooperative cancellation check, run just before a (blocking) kickoff.

    A subtask counts as cancelled when EITHER:
      * its status is no longer active/stalled (e.g. the owner paused/deleted it
        from the UI, or it was already failed/completed), OR
      * its id appears in any `agents.cancel.*` memory marker visible to this
        owner. A coordinator (agent) or the owner writes a memory entry with key
        prefix `agents.cancel.` whose value is a list of cancelled task ids;
        we read them across the whole owner namespace (owner_scope=true) so a
        marker written by ANY same-owner agent, or by the owner, is honoured.
        This is what lets one agent cancel work it delegated to another.

    On a transient read error we return False (don't drop a task on a hiccup).
    """
    # 1) status re-check (catches owner-side pause/delete)
    try:
        r = api.get(f"/v1/agents/{api.agent_name}/tasks/{task_id}")
        if r.status_code == 200:
            status = (r.json().get("data", {}).get("task", {}) or {}).get("status")
            if status not in ("active", "stalled"):
                return True
    except Exception:  # noqa: BLE001, S110 -- the status read failed; the cancel markers below are the second opinion
        pass
    # 2) coordinator-written cancellations. New connectors get these PUSHED over the tunnel
    #    (task.cancelled) and the serve daemon holds the set — a FREE loopback read, no more
    #    owner-scoped `agents.cancel.*` memory scan (100 records) before every dispatch. Fall back to
    #    the legacy scan only if the serve daemon is too old to expose /local/cancelled (404).
    try:
        r = api.get("/local/cancelled", params={"agent": api.gaii}, timeout=10)
        if r.status_code == 200:
            return task_id in (r.json().get("data", {}).get("cancelled", []) or [])
        if r.status_code != 404:
            return False
    except Exception:  # noqa: BLE001 -- no /local//cancelled on an older connector; the legacy scan below answers
        return False
    # Legacy fallback (old connector without /local/cancelled): the owner-scoped marker scan.
    try:
        r = api.get(
            "/v1/memory",
            params={"owner_scope": "true", "prefix": "agents.cancel.", "per_page": "100"},
        )
        if r.status_code == 200:
            for item in r.json().get("data", {}).get("items", []) or []:
                val = item.get("value")
                if isinstance(val, list) and task_id in (str(x) for x in val):
                    return True
                if isinstance(val, dict) and task_id in (str(k) for k in val):
                    return True
    except Exception:  # noqa: BLE001, S110 -- the marker scan failed; not-cancelled is the safe reading of silence
        pass
    return False


def _fail_cancelled(api: _Api, task_id: str) -> None:
    """Mark a not-yet-started, cancelled subtask failed so it leaves the queue."""
    try:
        api.post(
            f"/v1/agents/{api.agent_name}/tasks/{task_id}/fail",
            json={"message": "Cancelled before start (cancel marker or status change)"},
            timeout=10,
        )
    except Exception:  # noqa: BLE001, S110 -- the task is being abandoned anyway; a failed /fail changes nothing here
        pass


def _fetch_message_content(api: _Api, thread_id: str, msg_id: str) -> str:
    """Return the full body of a single message, or "" on error.

    The /inbox endpoint only returns a ~100-char preview, so we fetch the full
    message from the thread listing (GET /v1/agents/<agent>/messages?thread_id=)
    and pick out the matching id. That endpoint returns complete records,
    including the `content` field.
    """
    try:
        r = api.get(
            f"/v1/agents/{api.agent_name}/messages",
            params={"thread_id": thread_id, "per_page": 100},
        )
        if r.status_code != 200:
            # The caller falls back to the ~100-char preview, so a refusal here degrades the crew's
            # input silently unless it is said out loud: the message arrives truncated for a reason
            # nobody can see in the message.
            api.refused(r, "message body")
            return ""
        msgs = r.json().get("data", {}).get("messages", []) or []
        for m in msgs:
            if m.get("id") == msg_id:
                return m.get("content", "") or ""
        return ""
    except Exception:  # noqa: BLE001 -- the message body did not come back; the caller falls back to its preview
        return ""


def _mark_message_delivered(api: _Api, msg_id: str) -> bool:
    """Mark an inbox message delivered so it stops being re-dispatched.

    listPendingMessages only returns status=='pending' inbound messages, so
    PATCHing to 'delivered' after a successful kickoff removes it from the next
    poll cycle. Returns True on success.
    """
    try:
        r = api.patch(
            f"/v1/agents/{api.agent_name}/messages/{msg_id}",
            json={"status": "delivered"},
        )
        return r.status_code == 200
    except Exception:  # noqa: BLE001 -- marking delivered failed; the node keeps offering it and the next cycle retries
        return False


def _poll_messages(api: _Api) -> list[dict[str, Any]]:
    """Return list of pending inbox messages for the agent, or [] on error.

    Each entry has its full `content` resolved (the /inbox endpoint only carries
    a truncated preview, so we fetch the body per message).
    """
    try:
        r = api.get(f"/v1/agents/{api.agent_name}/inbox")
        if r.status_code != 200:
            api.refused(r, "inbox")
            return []
        data = r.json().get("data", {})
        # The node returns inbox items under `pending_messages` (and a unified
        # `items`); there is no `messages` key. Fall back to `items` for safety.
        stubs = data.get("pending_messages") or data.get("items") or []
        out: list[dict[str, Any]] = []
        for s in stubs:
            msg_id = s.get("id")
            thread_id = s.get("thread_id")
            content = ""
            if msg_id and thread_id:
                content = _fetch_message_content(api, thread_id, msg_id)
            out.append({
                "id": msg_id,
                "thread_id": thread_id,
                "from": s.get("from"),
                # Fall back to the preview if the full fetch failed, so the crew
                # still gets *something* rather than "(empty)".
                "content": content or s.get("preview", ""),
            })
        return out
    except Exception:  # noqa: BLE001 -- the inbox read failed; an empty list means this cycle simply has no messages
        return []


def _wait_unified(api: _Api, seconds: float, stop: dict[str, Any]) -> str:
    """Park on the serve daemon's UNIFIED wake signal (/local/wake/next). Returns:
      "woke"        -- a push source (task/record/dm/message) arrived; the caller re-lists + drains.
      "timeout"     -- `seconds` elapsed with nothing.
      "unsupported" -- the serve daemon is too old to expose the endpoint (404); the caller falls back
                       to the legacy per-queue park (wake_path + also_wake_tasks).

    Unlike the per-queue long-polls this does NOT consume anything -- it is a pure signal, so the woken
    cycle drains records/dms and re-lists tasks/messages exactly as on a timeout (nothing to hand back).
    Long-polled in <=5s chunks so SIGINT/SIGTERM get a look-in; a transient serve hiccup degrades to a
    short sleep slice (same shape as _wait_for_work)."""
    deadline = time.monotonic() + seconds
    while not stop["flag"]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "timeout"
        wait_ms = int(min(remaining, 5.0) * 1000)
        try:
            r = api.get(
                "/local/wake/next",
                params={"wait": wait_ms, "agent": api.gaii},
                timeout=wait_ms / 1000 + 10,
            )
            if r.status_code == 200:
                return "woke"
            if r.status_code == 404:
                return "unsupported"
            # 204 -- this chunk timed out with nothing; loop for the next chunk.
        except Exception:  # noqa: BLE001 -- the long poll dropped; sleep out the remaining slice and ask again
            time.sleep(min(1.0, max(remaining, 0.1)))
    return "timeout"


def _wait_for_work(
    api: _Api, use_push: bool, seconds: float, stop: dict[str, Any],
    wake_path: str = "/local/tasks/next", also_wake_tasks: bool = False,
) -> dict[str, Any] | None:
    """Idle wait between poll cycles. Returns the wake long-poll's `data` dict if a PUSH woke it (new work
    arrived), or None if it timed out / slept with nothing. The caller treats a non-None result as "woke".

    With `use_push` (the agent's serve transport is 'tunnel'), this long-polls
    the serve daemon's push surface (`wake_path`, default `/local/tasks/next`;
    records watch `/local/records/next`, federated DMs `/local/dm/next`) in
    <=5s chunks: an event answers the long-poll the instant the tunnel delivers
    it, so the next cycle starts immediately (true push, zero upstream traffic)
    while SIGINT/SIGTERM handlers still get a look-in every few seconds.

    IMPORTANT: the wake long-poll CONSUMES the event from the serve queue. For
    /local/tasks/next that is fine — the next cycle re-lists tasks from the store
    (the source of truth). But /local/dm/next and /local/records/next are
    queue-only (no store re-list / no catch-up between reconnects), so the caller
    MUST process the returned event or it is lost (a single-DM wake would
    otherwise be popped here and never reach on_dm). Hence this returns the
    consumed `data` (with its `event`/`task`), not just a bool.

    `also_wake_tasks`: when the park is on a NON-tasks queue (records/dm has priority) but this agent
    ALSO triggers on tasks, a task push lands in /local/tasks/next and would never answer the parked
    queue's long-poll -- so tasks would only be re-listed on the ~5-min safety net. With this flag on,
    each slice first quick-checks /local/tasks/next (wait=0) and returns an empty-dict wake if a task is
    queued, so a task push wakes within one short slice. Safe to consume here (unlike records/dms, the
    next cycle re-lists tasks from the store), hence the bare `{}` marker (no queue-only event to hand
    back; the caller just needs `woke` truthy to re-list).

    Without push (transport 'direct'/'auth_failed' -- node tunnel off or too
    old), the serve long-poll would always time out, so this falls back to the
    classic 1s-incremental sleep.
    """
    deadline = time.monotonic() + seconds
    while not stop["flag"]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        if use_push:
            if also_wake_tasks:
                try:
                    rt = api.get(
                        "/local/tasks/next",
                        params={"wait": 0, "agent": api.gaii},
                        timeout=10,
                    )
                    if rt.status_code == 200:
                        return {}
                except Exception:  # noqa: BLE001, S110 -- the drain is best effort; the wait below is what actually paces the loop
                    pass
            wait_ms = int(min(remaining, 5.0) * 1000)
            try:
                r = api.get(
                    wake_path,
                    params={"wait": wait_ms, "agent": api.gaii},
                    timeout=wait_ms / 1000 + 10,
                )
                if r.status_code == 200:
                    # push wake -- return the consumed payload so the caller can process queue-only
                    # events (DM / record) that the next cycle's drain would no longer see.
                    try:
                        data = r.json().get("data")
                        return data if isinstance(data, dict) else {}
                    except Exception:  # noqa: BLE001 -- a wake body that will not parse is still a wake; the caller re-reads the queue
                        return {}
            except Exception:  # noqa: BLE001 -- serve daemon hiccup; degrade to a plain sleep slice for this round
                # serve hiccup: degrade to a plain sleep slice for this round
                time.sleep(min(1.0, max(remaining, 0.1)))
        else:
            time.sleep(min(1.0, remaining))
    return None


def _subscribe_records(api: _Api, spaces: list[dict[str, Any]]) -> int:
    """Register record-push subscriptions with the serve daemon. Returns the count it accepted
    (which it forwards over the tunnel and re-sends on every reconnect), or 0 on error."""
    try:
        r = api.post("/local/subscribe", json={"spaces": spaces}, timeout=10)
        if r.status_code != 200:
            return 0
        return int(r.json().get("data", {}).get("subscribed", 0))
    except Exception:  # noqa: BLE001 -- subscribe failed; zero spaces means this run polls instead of being pushed
        return 0


def _drain_records(api: _Api, max_items: int = 50) -> list[dict[str, Any]]:
    """Pull all immediately-available record events off the serve daemon's record queue (wait=0,
    non-blocking), up to `max_items`. Each is a `workspace.record` envelope. [] when none/on error."""
    out: list[dict[str, Any]] = []
    for _ in range(max_items):
        try:
            r = api.get("/local/records/next", params={"wait": 0, "agent": api.gaii}, timeout=10)
            if r.status_code != 200:
                break
            event = r.json().get("data", {}).get("event")
            if not isinstance(event, dict):
                break
            out.append(event)
        except Exception:  # noqa: BLE001 -- the event drain ends where it stops answering; what arrived is returned
            break
    return out


def _agent_engagements(api: _Api, org: str, ws: str, agent_name: str) -> list[dict[str, Any]] | None:
    """This agent's contract engagements (active + retired) in one workspace, or None on read error.

    Uses the member-gated by-workspace endpoint (the agent's owner is a member, so the agent token can
    read it) and filters to this agent. None signals "could not read" so callers fail OPEN — a transient
    node hiccup must never wedge processing. See docs/agent-workspace-contracts.md §7d.
    """
    try:
        r = api.get(f"/v1/organisms/{org}/workspace/engagements", params={"ws": ws}, timeout=10)
        if r.status_code != 200:
            # The gate's fail-open STAYS (§7d): failing closed on a refusal would skip every record
            # in every workspace, which stops the agent for a reason it cannot report. What changes
            # is that the refusal is no longer indistinguishable from the node hiccup the fail-open
            # was written for -- the gate keeps letting work through, and says why it could not check.
            api.refused(r, f"engagements ({org}/{ws})")
            return None
        engs = (r.json().get("data") or {}).get("engagements") or []
    except Exception:  # noqa: BLE001 -- no engagement list is the same answer as an unreachable node: nothing to do
        return None
    return [e for e in engs if isinstance(e, dict) and e.get("agentName") == agent_name]


def _space_contract(api: _Api, org: str, ws: str, space: str, cache: dict[str, dict[str, str]]) -> str | None:
    """The contract id the workspace manifest stamps on ``space``'s objectType, or None if the manifest
    doesn't declare one. Cached per workspace for the daemon's lifetime (the manifest is stable). Read
    failures are not cached (so a later retry can succeed)."""
    key = f"{org}/{ws}"
    if key not in cache:
        try:
            r = api.get(f"/v1/organisms/{org}/workspace", params={"ws": ws}, timeout=10)
            if r.status_code != 200:
                api.refused(r, f"workspace manifest ({org}/{ws})")
                return None
            ots = ((r.json().get("data") or {}).get("manifest") or {}).get("objectTypes") or []
            cache[key] = {
                ot["name"]: ot["contract"]
                for ot in ots
                if isinstance(ot, dict) and ot.get("name") and ot.get("contract")
            }
        except Exception:  # noqa: BLE001 -- the contract read failed; None keeps the caller on its own default
            return None
    return cache.get(key, {}).get(space)


def _engagement_verdict(mine: list[dict[str, Any]], space_contract: str | None) -> str:
    """Pure decision for the contract-engagement gate (§7d), split out so it is unit-testable.

    ``mine`` = this agent's engagements in the workspace (each a dict with ``contract`` + ``state``).
    ``space_contract`` = the contract the triggering record's space belongs to, or None when the manifest
    doesn't map it. Returns one of:
      • ``"process"``  — act on the record
      • ``"skip"``     — the relevant contract is retired; do nothing
      • ``"backfill"`` — process AND register an active engagement (legacy ws, contract now known)
    """
    if space_contract is not None:
        for e in mine:
            if (e.get("contract") or "") == space_contract:
                return "skip" if e.get("state") == "retired" else "process"
        return "backfill"
    # No space->contract mapping: decide at the workspace level.
    if any(e.get("state") == "active" for e in mine):
        return "process"
    if any(e.get("state") == "retired" for e in mine):
        return "skip"
    return "process"


def _backfill_engagement(api: _Api, org: str, ws: str, agent_name: str, contract: str) -> None:
    """Best-effort: register an ACTIVE engagement for an agent already working a workspace that has none
    yet (§7d backfill-on-first-process), so the contract becomes visible on the agent + workspace views.
    Only called with a KNOWN contract id — never a bare marker, which a per-contract Retire couldn't
    later target. Silent on any failure (visibility is a nicety, not a correctness requirement)."""
    try:
        api.post(
            f"/v1/organisms/{org}/workspace/engagements",
            json={"ws": ws, "agent": agent_name, "contract": contract},
            timeout=10,
        )
    except Exception:  # noqa: BLE001, S110 -- recording the engagement is a courtesy; the work does not depend on it
        pass


def _drain_dms(api: _Api, max_items: int = 50) -> list[dict[str, Any]]:
    """Pull all immediately-available federated-inbox `dm.inbound` wakes off the serve daemon's DM queue
    (wait=0, non-blocking), up to `max_items`. Each envelope is record-shaped (id, conversationId,
    subject, senderGhii, preview, attachments (count), createdAt). [] when none/on error. Read the full
    body/attachments via aimeat_dm_thread(conversationId)."""
    out: list[dict[str, Any]] = []
    for _ in range(max_items):
        try:
            r = api.get("/local/dm/next", params={"wait": 0, "agent": api.gaii}, timeout=10)
            if r.status_code != 200:
                break
            event = r.json().get("data", {}).get("event")
            if not isinstance(event, dict):
                break
            out.append(event)
        except Exception:  # noqa: BLE001 -- the event drain ends where it stops answering; what arrived is returned
            break
    return out


InvokeHandler = Callable[[str, Any, dict[str, Any]], Any]
"""An invoke handler: (capability, input, invoke) -> result. Return the result value the node
should receive (any JSON-serializable value); raise to answer ok=False. Returning a tuple
(ok: bool, result) sets the ok flag explicitly -- the way to refuse without an exception."""


def _next_invoke(api: _Api, wait_ms: int) -> dict[str, Any] | None | str:
    """One long-poll on the serve daemon's invoke queue. Returns the invoke dict (id, capability, input,
    caller, timeout_ms, received_at), None when nothing arrived in `wait_ms`, or "unsupported" when the
    serve daemon predates the endpoint (404) so the caller can stop polling instead of spinning."""
    r = api.get(
        "/local/invoke/next",
        params={"wait": wait_ms, "agent": api.gaii},
        timeout=wait_ms / 1000 + 10,
    )
    if r.status_code == 404:
        return "unsupported"
    if r.status_code != 200:
        return None
    data = r.json().get("data")
    return data if isinstance(data, dict) and data.get("id") else None


def _answer_invoke(api: _Api, invoke_id: str, ok: bool, result: Any) -> bool:
    """Hand the answer back; the serve daemon forwards it over the tunnel as `invoke_result`. False when
    the daemon no longer knows the id (already answered, or the node stopped waiting)."""
    r = api.post(
        f"/local/invoke/{invoke_id}/result",
        params={"agent": api.gaii},
        json={"ok": ok, "result": result},
        timeout=10,
    )
    return r.status_code == 200


def _run_invoke_handler(handler: InvokeHandler, invoke: dict[str, Any]) -> tuple[bool, Any]:
    """Run one handler and shape its outcome as (ok, result). A raised exception becomes HANDLER_ERROR
    with the message, so the person at the Crew tab reads the reason instead of a timeout."""
    capability = str(invoke.get("capability") or "")
    try:
        out = handler(capability, invoke.get("input"), invoke)
    except Exception as exc:  # noqa: BLE001 -- the handler is the crew's code; report, do not die
        return False, {"code": "HANDLER_ERROR", "message": f"{type(exc).__name__}: {exc}"}
    if isinstance(out, tuple) and len(out) == 2 and isinstance(out[0], bool):
        return out[0], out[1]
    return True, out


def run_invoke_listener(
    api: _Api,
    handler: InvokeHandler,
    stop: dict[str, Any],
    *,
    wait_seconds: float = 25.0,
    max_workers: int = 2,
    label: str | None = None,
) -> str:
    """Serve the node's server-initiated invokes for one agent until `stop["flag"]` is set.

    This is what makes the Crew tab's Validate and Try buttons work: the node sends `invoke` over the
    tunnel, the serve daemon queues it, and this loop collects it, runs `handler(capability, input,
    invoke)` and posts the answer back. Poll from startup, not on demand: the serve daemon answers the
    node with NO_HANDLER when nobody has polled an agent's queue in 90 s, which is the right thing for
    an agent with no runtime and the wrong thing for one whose listener starts late.

    Handlers run in a pool of `max_workers` so a `crew.try` that takes minutes does not block the next
    `crew.validate`; the poll itself keeps going between them. Returns "stopped" on the stop flag, or
    "unsupported" when the serve daemon predates the endpoint (an older `aimeat` package) -- the caller
    logs that once rather than spinning on 404s.
    """
    name = label or f"invoke:{api.agent_name}"
    pool = ThreadPoolExecutor(max_workers=max(1, max_workers), thread_name_prefix=name)
    outcome = "stopped"

    def _serve_one(invoke: dict[str, Any]) -> None:
        ok, result = _run_invoke_handler(handler, invoke)
        try:
            if not _answer_invoke(api, str(invoke["id"]), ok, result):
                print(f"[{name}] answer for {invoke.get('capability')} #{invoke['id']} was no longer wanted")
        except Exception as exc:  # noqa: BLE001 -- loopback hiccup; the node times out on its own
            print(f"[{name}] could not answer {invoke.get('capability')} #{invoke['id']}: {exc}")

    try:
        while not stop["flag"]:
            wait_ms = int(max(0.5, min(wait_seconds, 25.0)) * 1000)
            try:
                got = _next_invoke(api, wait_ms)
            except Exception:  # noqa: BLE001 -- serve daemon restarting; try again shortly
                time.sleep(1.0)
                continue
            if got == "unsupported":
                outcome = "unsupported"
                break
            if isinstance(got, dict):
                pool.submit(_serve_one, got)
    finally:
        pool.shutdown(wait=True)
    return outcome


def _serve_agent_status(api: _Api) -> dict[str, Any]:
    """This agent's serve-daemon status entry (transport, reconnects, ...) from `/local/status`, or {}
    on error. Loopback-only -- NOT a node call -- so polling it per cycle keeps an idle agent quiet."""
    try:
        r = api.get("/local/status", timeout=10)
        if r.status_code != 200:
            return {}
        for a in r.json().get("data", {}).get("agents", []):
            if a.get("agent") == api.agent_name:
                return a
    except Exception:  # noqa: BLE001 -- the agent list did not come back; an empty profile is what the caller expects
        return {}
    return {}


def _resolve_push_wake(agent_status: dict[str, Any], current: bool) -> bool:
    """Re-derive whether this cycle should push-wake (park on the serve long-poll) vs interval-poll.

    push_wake is seeded once at startup from the transport at discovery time — but in a FLEET the shared
    serve daemon brings each agent's tunnel up ASYNCHRONOUSLY, so an agent that started before its tunnel
    was ready latched push_wake=False for its whole life (interval polling, never event-driven — the
    "waits ~a poll tick to start" symptom). Re-deriving from a fresh /local/status each cycle lets a
    direct/polling agent UPGRADE to push the moment its tunnel connects (and downgrade if it drops).

    Pure + unit-testable. `transport=='tunnel'` -> True; any OTHER known transport -> False; an empty
    status or a missing transport field keeps `current` (a transient empty read must never flap an
    already-established transport)."""
    if not agent_status:
        return current
    transport = agent_status.get("transport")
    if not transport:
        return current
    return transport == "tunnel"


# Type alias: function the caller provides to build a Crew for one task.
# Receives the AIMEAT task dict (id, title, description, ...) and the
# already-instantiated liaison Agent. Must return a crewai.Crew instance.
BuildCrewCallback = Callable[[dict[str, Any], Any], Any]


def _default_propose_crew(task: dict[str, Any], liaison: Any) -> Any:
    """
    Default PROPOSE-phase crew used by run_crew_daemon when the caller
    does not supply `build_propose_crew`. The liaison alone, one task:
    call `aimeat_task_propose_todos` ONCE with a TODO plan for the AIMEAT
    task, then stop. The crew does NOT start work, mark TODOs done, or
    complete the task -- those happen later, in the EXECUTE phase, after
    the owner has approved the proposed plan (or auto-approval kicks in
    for task-runner mode agents).

    Defined lazily so importing aimeat_crewai does not force a CrewAI
    import at module load time -- CrewAI is only required when actually
    spinning up a crew.
    """
    from crewai import Crew, Task  # local import keeps module-load light

    task_id = task.get("id", "(unknown id)")
    title = task.get("title", "(no title)")
    description = task.get("description") or title

    return Crew(
        agents=[liaison],
        tasks=[
            Task(
                description=(
                    f"You are the AIMEAT Liaison. AIMEAT task {task_id} is waiting for a "
                    f"plan from this crew (title: {title}).\n\n"
                    f"---\n{description}\n---\n\n"
                    f"Propose a TODO plan for completing this task. Call "
                    f"`aimeat_task_propose_todos` ONCE with task_id='{task_id}' and a "
                    f"todos array of 2-6 concrete steps that this crew will take to "
                    f"deliver. Each todo should be one specific action with a clear "
                    f"verification criterion.\n\n"
                    f"After the propose call returns successfully, your job for this "
                    f"phase is done -- report the proposed plan and stop. Do not start "
                    f"working on the task, do not mark todos done, and do not call "
                    f"`aimeat_task_complete`. Those happen in the next phase, after "
                    f"the owner approves the plan (or auto-approval activates the task "
                    f"for task-runner mode agents)."
                ),
                expected_output="Confirmation that aimeat_task_propose_todos was called and the proposed TODO plan.",
                agent=liaison,
            ),
        ],
        verbose=False,
    )


# Curated subset of AIMEAT MCP tools that a daemon-mode liaison actually
# needs. Loading all ~95 AIMEAT tools into a CrewAI agent overflows some LLM
# adapters (litellm / smaller models choke on the schema package) and slows
# down even the ones that don't. This list covers the canonical liaison flow:
# Hello Integration, capability self-reporting, task lifecycle (read + take a
# task, propose+update TODOs, complete/fail), deliverable persistence
# (memory + knowledge), telemetry, and handbook self-reference. Wallet,
# admin, consent, cortex, extension, organism, board, app, and group tools
# are excluded because a default liaison doesn't need them.
#
# Override by passing `tool_filter=[...]` explicitly to run_crew_daemon, or
# `tool_filter=None` for the unfiltered ~95-tool set.
DAEMON_DEFAULT_TOOL_FILTER: tuple[str, ...] = (
    # Onboarding (Hello Integration)
    "aimeat_handbook_get",
    "aimeat_onboarding_status",
    "aimeat_onboarding_identify_platform",
    "aimeat_onboarding_confirm_skill_installed",
    "aimeat_onboarding_confirm_directives_read",
    "aimeat_onboarding_declare_services",
    # Capabilities + identity (what this crew can do, who it is)
    "aimeat_agent_capabilities_report",
    "aimeat_agents_list",
    # Task lifecycle (the daemon's core loop)
    "aimeat_task_list",
    "aimeat_task_get",
    "aimeat_task_propose_todos",
    "aimeat_task_todo",
    "aimeat_task_event",
    "aimeat_task_complete",
    "aimeat_task_fail",
    "aimeat_task_create",  # for crew-to-crew delegation
    # Deliverables.
    #
    # AI PROVENANCE (TARGET-058): each of these write tools takes an optional
    # `ai_provenance` block. A daemon crew publishes on a schedule with NO
    # REVIEWER, so the node's default is the correct record for it —
    # `ai-generated` / `humanInvolvement: "none"` — and the daemon does not
    # override it. There is no step in this loop where a person reads the
    # substance and could reject it: the owner queued a task, which is not the
    # same as reading what came back. Use aimeat_crewai.provenance.declare()
    # when the crew knows better, above all when it is RELAYING TEXT A PERSON
    # WROTE (level="original") — that is the one thing silence gets wrong.
    "aimeat_memory_write",
    "aimeat_memory_read",
    "aimeat_memory_list",
    "aimeat_knowledge_contribute",
    "aimeat_knowledge_get",
    # Telemetry
    "aimeat_agent_telemetry_report",
    # Messages (so the daemon can listen for owner messages too)
    "aimeat_message_inbox",
    "aimeat_message_send",
)


# Sentinel marker. `run_crew_daemon(..., tool_filter=<SENTINEL>)` (the
# default) means "use DAEMON_DEFAULT_TOOL_FILTER". Passing `None` explicitly
# means "no filter, give me every tool the connector exposes". Passing a
# concrete iterable uses that exact set.
_USE_DAEMON_DEFAULT_FILTER = object()


def run_crew_daemon(
    *,
    agent_name: str,
    build_crew: BuildCrewCallback,
    build_propose_crew: BuildCrewCallback | None = None,
    owner: str | None = None,
    llm: Any = None,
    tool_filter: Any = _USE_DAEMON_DEFAULT_FILTER,
    poll_interval_seconds: int = 30,
    max_concurrent_tasks: int | None = None,
    listen_for: Iterable[str] = ("tasks",),
    record_spaces: Iterable[dict[str, Any]] | None = None,
    on_record: Callable[[dict[str, Any]], None] | None = None,
    on_dm: Callable[[dict[str, Any]], None] | None = None,
    on_invoke: InvokeHandler | None = None,
    on_idle: Callable[[], None] | None = None,
    on_error: Callable[[Exception], None] | None = None,
    one_shot: bool = False,
    serve_options: dict[str, Any] | None = None,
) -> None:
    """
    Run a long-lived daemon that polls AIMEAT for work and dispatches it to
    a crew built fresh per task.

    Since 0.4.0 all AIMEAT traffic goes through the LOCAL loopback serve
    daemon (`aimeat connect serve --http`, auto-started on demand): the
    liaison's MCP targets the loopback `/v1/mcp` and every REST helper rides
    one shared `requests.Session` against the loopback proxy. The serve
    daemon holds a single persistent WS tunnel per agent to the node, so the
    poll cycle below is loopback-cheap and there is no per-call TLS storm and
    no per-worker connector subprocess.

    The daemon runs the AIMEAT task lifecycle in two phases per poll cycle:

      PROPOSE: Pick up every task with no plan yet -- status='queued', and
        status='active' whose TODO list is empty -- that the daemon has not
        proposed on, and run the propose-phase crew (which calls
        aimeat_task_propose_todos once and stops). Owner approval (or
        task-runner mode's auto-activation) then flips a queued task to
        'active'.
      EXECUTE: Pick up tasks in status='active' (or 'stalled') the daemon
        has not yet completed, run the caller's build_crew (which should
        finish the work and call aimeat_task_complete).

    For task-runner mode agents the AIMEAT node auto-activates tasks on
    create, so they are never 'queued' at all -- PROPOSE catches them on
    the plan-less-active side, and EXECUTE picks the same task up in the
    SAME cycle with the plan already on it. No owner approval required.

    Args:
        agent_name: The AIMEAT agent name (e.g. "demo-crew"). Must have a
            stored token from `aimeat connect add`.
        build_crew: Callback that takes (task_dict, liaison_agent) and
            returns a `crewai.Crew` instance for the EXECUTE phase. The
            Crew should have the liaison as one of its agents and at least
            one Task that asks the liaison to mark each todo done with
            aimeat_task_todo and then call aimeat_task_complete (the
            liaison's persona explains this).
        build_propose_crew: Optional override for the PROPOSE phase crew.
            Defaults to a liaison-only crew that calls
            aimeat_task_propose_todos once with a 2-6 step TODO plan and
            stops. Override if you want a richer plan (e.g. the same
            domain agents from build_crew running in 'plan only' mode).
        owner: Optional. If two or more owners have an agent with the same
            name in your local connector, pass `owner` to disambiguate.
            With a single-owner install you can omit it.
        llm: CrewAI-compatible LLM to use for the liaison's reasoning.
            Forwarded to create_liaison_agent. When None, CrewAI's default
            LLM resolution applies -- which falls back to the OpenAI native
            provider and crashes the daemon's finalize step if
            OPENAI_API_KEY is not set. Pass an explicit LLM
            (e.g. crewai.LLM(model="openrouter/...", api_key=...)) for any
            non-OpenAI runtime.
        tool_filter: Which AIMEAT MCP tools the liaison should load.
            Defaults to `DAEMON_DEFAULT_TOOL_FILTER` (a curated ~25-tool
            set covering Hello Integration, task lifecycle, memory,
            knowledge, telemetry, and messages). Pass `None` for the
            unfiltered ~95-tool set (some LLM adapters choke on it). Pass
            a list of tool names to use that exact subset.
        poll_interval_seconds: How often to check AIMEAT for new work
            when idle. Default 30s; raise for low-priority crews, lower
            for snappy interactive feel (but mind rate limits).
        max_concurrent_tasks: How many EXECUTE-phase tasks the daemon runs in
            parallel. `None` (default) reads the owner-configured value from the
            AIMEAT integration kit (`watchdog_spec.max_concurrent_tasks`, set in
            the profile Tasks tab; default 1). Pass an int to override locally.
            1 = serial (the original behaviour, one shared liaison). >1 runs a
            bounded thread pool where EACH concurrent task gets its OWN liaison
            and MCP connection (a shared stdio MCP cannot be used by parallel
            kickoffs). PROPOSE-phase and inbox messages stay serial on the shared
            liaison. The value is read once at startup -- restart to apply a
            change. Mind LLM rate limits: N parallel crews fan out further
            internally, so start conservative (3-5).
        listen_for: Iterable of "tasks", "messages", "records" and/or "dms".
            Default ("tasks",). When "messages" is included, inbox messages
            also become triggers (wrapped into a synthetic task dict with the
            message body as description). When "records" is included, workspace
            record-change events PUSHED over the connector tunnel become
            triggers -- the daemon subscribes the `record_spaces` and acts on
            each event instead of idle-polling the served spaces. With push
            active the idle wait long-polls `/local/records/next`, so a
            records-only contract agent makes ZERO periodic node calls.
            When "dms" is included, federated-inbox direct messages addressed to
            this agent become triggers: the node pushes a `dm.inbound` wake over
            the tunnel and the daemon drains it from `/local/dm/next` (a queue
            separate from tasks + records). A dms-driven agent parks its idle
            wait on the DM long-poll -- no DM poller. Reply in-thread with
            aimeat_dm_send; read full body/attachments via aimeat_dm_thread.
        record_spaces: With "records" in listen_for, the list of spaces to
            subscribe to -- each a dict {"organism_id", "ws", "space"} where
            `space` is the workspace records-space key segment (the manifest
            objectType's namespace, e.g. "task"). The serve daemon holds these
            and re-subscribes on every tunnel reconnect.
        on_record: With "records" in listen_for, a callback invoked with each
            record event envelope {type, organism_id, ws, space, id, op, ts}.
            A reconnect (or startup) fires one synthetic catch-up event per
            subscribed space (op="catchup") so the handler re-scans for writes
            missed while disconnected. When omitted, each event is wrapped into
            a synthetic task dict and routed to build_crew (like messages).
        on_dm: With "dms" in listen_for, a callback invoked with each pushed
            `dm.inbound` event (record-shaped: id, conversationId, subject,
            senderGhii, preview, attachments (count), createdAt, and
            `interactive`: "questions" | "answers" | None for a federated
            AskUserQuestion). When omitted, each wake is wrapped into a synthetic
            task dict and routed to build_crew (like records/messages). The wake
            is a lightweight summary -- read the full thread via
            aimeat_dm_thread(conversationId), or use messaging.read_answers /
            answers_from_dm to pull structured answers for an "answers" wake.
        on_invoke: A handler `(capability, input, invoke) -> result` for the node's
            server-initiated invokes (0.22.0, AIMEAT >= 3.9): the Crew tab's
            Validate sends `crew.validate` with {doc} and expects {errors: [...]};
            Try sends `crew.try` with {doc, prompt} and expects {output, ...}.
            Runs in its own listener thread from startup (see run_invoke_listener),
            so answering never waits for the poll cycle or a running kickoff. Raise
            to answer ok=False with the message; return (False, {...}) to refuse
            with your own shape. Without it, the node is told this agent has no
            handler and the tab says so.
        on_idle: Optional callback fired once per poll cycle when no work
            arrived. Useful for heartbeat logging.
        on_error: Optional callback fired with any unhandled exception
            during a poll/dispatch cycle. The daemon does NOT exit on
            errors -- it logs and continues so the supervisor's
            crash-loop detector doesn't get spurious restarts.
        one_shot: If True, return after the first dispatched task (or
            after one idle cycle if no work). Useful for testing the
            wiring without a long-running process.
        serve_options: Extra kwargs forwarded to `ensure_serve()` /
            `serve_params()` (e.g. `aimeat_command` / `spawn_cwd` for a repo
            checkout of the AIMEAT CLI, or `start_timeout`). Usually omitted.

    The daemon traps SIGINT and SIGTERM cleanly so Ctrl+C and `kill`
    shut it down with the liaison's MCP connection properly closed.
    """
    # Fail fast with the connector's own guidance if the agent was never
    # registered locally -- the serve daemon needs the same home dir. The
    # node_url is informational only; actual calls go through the loopback.
    # Read the identity once, here, and carry it. `agent_name` is the credential's NAME; `identity
    # .gaii` is what routing wants, and on a daemon holding two owners those cannot be one string.
    identity = resolve_agent_identity(agent_name, owner=owner)
    _token, node_url = _read_token(agent_name, owner=owner)
    listen_set = set(listen_for)
    serve_opts = dict(serve_options or {})

    # Normalise the record-push spaces (only meaningful with "records" in listen_for).
    record_space_list: list[dict[str, Any]] = []
    for s in (record_spaces or ()):
        if isinstance(s, dict) and s.get("organism_id") and s.get("ws") and s.get("space"):
            record_space_list.append({"organism_id": s["organism_id"], "ws": s["ws"], "space": s["space"]})

    # Discover (or auto-start) the shared loopback serve daemon, then bind the
    # shared Session to it. The daemon proxies /v1/* over its tunnel and holds
    # the bearer token itself; X-Aimeat-Agent routes to the right identity.
    discovery = ensure_serve(**serve_opts)
    loopback_base = f"http://127.0.0.1:{discovery['port']}"
    api = _Api(loopback_base, identity)

    # Per-LLM-call usage -> node ledger (LEDGER TARGET-016). Subscribes once to CrewAI's
    # event bus and POSTs an llm_call telemetry event per call over this same loopback, so
    # the owner sees spend at /v1/ledger/usage. Best-effort + graceful no-op if unavailable;
    # each kickoff below is wrapped in usage_run(task_id) to attribute the run.
    install_usage_telemetry(agent_name, base_url=loopback_base)

    # Push-driven idle wait when the serve daemon holds a live tunnel for this
    # agent: instead of sleeping a full poll interval, the daemon parks on the
    # serve long-poll and wakes the moment a task is delivered. Degraded
    # transports keep the classic sleep (the long-poll would always 204).
    agent_transport = next(
        (a.get("transport") for a in discovery.get("agents", []) if a.get("agent") == agent_name),
        "direct",
    )
    push_wake = agent_transport == "tunnel"

    # Record push (P1): subscribe the served spaces with the serve daemon (it forwards a `subscribe`
    # frame over the tunnel and re-sends on reconnect). A records-driven contract agent parks its idle
    # wait on the record long-poll. `last_reconnects` tracks the tunnel (re)connect count so a reconnect
    # triggers one catch-up scan. Initialised so startup itself counts as the first catch-up.
    records_on = "records" in listen_set and bool(record_space_list)
    # Federated-inbox DM push: a `dms`-driven agent parks its idle wait on the DM long-poll. (Records take
    # priority for the park when both are on; the other queue still drains every cycle / on wake.)
    dms_on = "dms" in listen_set
    wake_path = "/local/records/next" if records_on else ("/local/dm/next" if dms_on else "/local/tasks/next")
    last_reconnects = -1
    if records_on:
        n = _subscribe_records(api, record_space_list)
        print(f"[daemon:{agent_name}] subscribed {n}/{len(record_space_list)} record space(s) for push")

    stop = {"flag": False}

    def _handle_signal(signum: int, _frame: Any) -> None:  # pragma: no cover -- OS signals
        print(f"[daemon:{agent_name}] received signal {signum}, shutting down...")
        stop["flag"] = True

    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)

    # Server-initiated invokes (Crew tab Validate/Try) are collected by their own thread from the
    # start, because the serve daemon reports NO_HANDLER for an agent nobody has polled in 90 s and
    # a poll that waited for the idle cycle would miss the first click after every kickoff.
    invoke_thread: threading.Thread | None = None
    if on_invoke is not None:
        def _invoke_main() -> None:
            outcome = run_invoke_listener(api, on_invoke, stop, label=f"invoke:{agent_name}")
            if outcome == "unsupported":
                print(f"[daemon:{agent_name}] this serve daemon has no /local/invoke surface (aimeat < 3.9); "
                      "Validate/Try from the Crew tab will not reach this agent until it is updated")
        invoke_thread = threading.Thread(target=_invoke_main, name=f"invoke:{agent_name}", daemon=True)
        invoke_thread.start()

    print(
        f"[daemon:{agent_name}] starting against {node_url} via loopback serve "
        f"{loopback_base} (transport: {agent_transport}"
        f"{', push-wake long-poll' if push_wake else ', interval polling'}), "
        f"cycle {poll_interval_seconds}s, listening for {sorted(listen_set)}"
    )

    # Resolve tool_filter:
    #   sentinel (default) -> DAEMON_DEFAULT_TOOL_FILTER (curated ~25 tools)
    #   None               -> no filter, every MCP tool the connector exposes
    #   iterable           -> use as-is
    if tool_filter is _USE_DAEMON_DEFAULT_FILTER:
        resolved_tool_filter: Iterable[str] | None = DAEMON_DEFAULT_TOOL_FILTER
    else:
        resolved_tool_filter = tool_filter

    if resolved_tool_filter is not None:
        try:
            count = len(list(resolved_tool_filter))  # iterable -> list (consumes generators)
            # Re-create as tuple for re-use below; lists are also fine.
            resolved_tool_filter = tuple(resolved_tool_filter) if not isinstance(resolved_tool_filter, (list, tuple)) else resolved_tool_filter
            print(f"[daemon:{agent_name}] loading liaison with {count} tool(s) via tool_filter")
        except TypeError:
            pass  # not a sized iterable, let create_liaison_agent surface the error
    else:
        print(f"[daemon:{agent_name}] loading liaison with NO tool_filter (every available MCP tool)")

    # Resolve concurrency: explicit override, else the owner-configured value
    # from the integration kit (default 1 = serial). Read once at startup.
    if max_concurrent_tasks is None:
        effective_max = _fetch_max_concurrent(api)
    else:
        effective_max = max(1, int(max_concurrent_tasks))
    if effective_max > 1:
        print(f"[daemon:{agent_name}] EXECUTE concurrency: up to {effective_max} tasks in parallel (per-task liaison)")
    else:
        print(f"[daemon:{agent_name}] EXECUTE concurrency: serial (1)")

    # Resolve PROPOSE crew builder: caller's override or the package default.
    propose_builder: BuildCrewCallback = build_propose_crew or _default_propose_crew

    # Idempotency sets, process-local. A task is proposed at most once and
    # executed at most once per daemon lifetime. Server-side the AIMEAT task
    # has a single lifecycle (queued -> active -> done|failed), so re-running
    # the same phase on the same task would just churn the LLM. On daemon
    # restart these sets are lost; the persona's "trust every success
    # response" rule + the server's idempotent propose/complete semantics
    # cover the small remaining churn surface.
    proposed_ids: set[str] = set()
    done_ids: set[str] = set()
    auth_failed = False  # set True if the serve tunnel reports the bearer was revoked/expired (P2)

    # Poll-gate (the tunnel's promise for tasks): when the agent has a live tunnel, the node PUSHES
    # new tasks (deliver/backlog) and the idle wait parks on the loopback wake long-poll. So re-listing
    # tasks from the node every cycle is pure waste — do it ONLY when a push woke us, plus a rare
    # safety-net re-list to catch anything missed (a dropped frame, a status flip with no push). With
    # no tunnel (direct/degraded) the wake always times out, so we keep polling every cycle as before.
    woke_by_push = False
    next_poll_due = 0.0  # monotonic deadline for the safety-net re-list; 0 => poll on the first cycle
    safety_net_s = max(poll_interval_seconds, 300)
    # Unified-wake support (serve >= the /local/wake/next release): None = untested, True = park on the
    # unified signal (wakes on task/record/dm/message alike), False = serve too old -> legacy per-queue park.
    wake_unified: bool | None = None

    # Concurrent-EXECUTE state (only used when effective_max > 1). Mutated by the
    # MAIN thread only: workers just run and return, the main thread reaps their
    # futures and updates done_ids, so no lock is needed.
    in_flight: set[str] = set()        # EXECUTE task ids currently in the pool
    futures: dict[Future, str] = {}    # Future -> task_id

    def _dispatch(phase_label: str, task: dict[str, Any], builder: BuildCrewCallback) -> bool:
        """Run one crew against one task. Returns True on success, False on error."""
        task_id = task.get("id", "(unknown id)")
        title = task.get("title", "(no title)")
        print(f"[daemon:{agent_name}] {phase_label} task {task_id}: {title}")
        crew = builder(task, liaison)
        try:
            with usage_run(task_id, agent_name):
                result = crew.kickoff()
            print(f"[daemon:{agent_name}] {phase_label} task {task_id} done; first 200 chars: {str(result)[:200]}")
            return True
        except Exception as inner:  # noqa: BLE001 -- the crew is the user's own code; report it and keep the daemon alive
            print(f"[daemon:{agent_name}] {phase_label} task {task_id} crashed: {inner}")
            if on_error:
                try:
                    on_error(inner)
                except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                    pass
            # Only mark failed during the EXECUTE phase. A PROPOSE-phase crash
            # is recoverable -- the task is still queued, the next poll cycle
            # will retry. Marking it failed would close it off prematurely.
            if phase_label == "EXECUTE":
                try:
                    api.post(
                        f"/v1/agents/{agent_name}/tasks/{task_id}/fail",
                        json={"message": f"Crew crashed: {inner}"},
                        timeout=10,
                    )
                except Exception:  # noqa: BLE001, S110 -- the task already crashed; a failed /fail leaves it queued for the next cycle
                    pass
            return False

    def _execute_worker(task: dict[str, Any]) -> tuple[str, str]:
        """Run one EXECUTE task in its OWN liaison (for the concurrent path).

        Each worker gets a fresh liaison whose MCP session targets the SAME
        loopback serve daemon -- loopback HTTP is naturally concurrent, so no
        per-worker connector subprocess is spawned (the pre-0.4.0 "shared
        stdio MCP can't be driven by parallel kickoffs" constraint is gone).
        Cooperative cancellation is re-checked just before kickoff. On crash
        the task is marked failed server-side. Returns (task_id, status)
        where status is "ok" | "cancelled" | "error".
        """
        task_id = task.get("id", "(unknown id)")
        title = task.get("title", "(no title)")
        print(f"[daemon:{agent_name}] EXECUTE(worker) task {task_id}: {title}")
        try:
            with create_liaison_agent(
                mcp_server_params=serve_params(agent_name=identity.gaii, **serve_opts),
                agent_name=agent_name,
                tool_filter=resolved_tool_filter,
                llm=llm,
            ) as worker_liaison:
                if _is_cancelled(api, task_id):
                    print(f"[daemon:{agent_name}] EXECUTE task {task_id} cancelled before start -- skipping")
                    _fail_cancelled(api, task_id)
                    return (task_id, "cancelled")
                crew = build_crew(task, worker_liaison)
                with usage_run(task_id, agent_name):
                    result = crew.kickoff()
                print(f"[daemon:{agent_name}] EXECUTE task {task_id} done; first 200 chars: {str(result)[:200]}")
                return (task_id, "ok")
        except Exception as inner:  # noqa: BLE001 -- the crew is the user's own code; report it and keep the daemon alive
            print(f"[daemon:{agent_name}] EXECUTE task {task_id} crashed: {inner}")
            if on_error:
                try:
                    on_error(inner)
                except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                    pass
            try:
                api.post(
                    f"/v1/agents/{agent_name}/tasks/{task_id}/fail",
                    json={"message": f"Crew crashed: {inner}"},
                    timeout=10,
                )
            except Exception:  # noqa: BLE001, S110 -- the task already crashed; a failed /fail leaves it queued for the next cycle
                pass
            return (task_id, "error")

    def _reap_finished() -> None:
        """Main-thread reap of completed EXECUTE workers (concurrent path)."""
        for f in [f for f in list(futures) if f.done()]:
            tid = futures.pop(f)
            in_flight.discard(tid)
            try:
                _, status = f.result()
            except Exception:  # noqa: BLE001 -- the worker already reported; the future only says whether it got that far
                status = "error"
            # ok/cancelled leave the active queue for good -> guard against
            # re-dispatch. "error" already POSTed /fail (so the task is no longer
            # active); mirror the serial path and DON'T add it, so a transient
            # /fail failure still lets the next cycle retry.
            if status in ("ok", "cancelled"):
                done_ids.add(tid)

    # The shared liaison's MCP connection stays open for the daemon's lifetime;
    # it serves PROPOSE, inbox messages, and (serial mode) EXECUTE. When
    # effective_max > 1, EXECUTE tasks run on a bounded thread pool instead, each
    # on its own liaison (see _execute_worker). The pool spawns no threads until
    # the first submit, so leaving it unused in serial mode costs nothing.
    executor: ThreadPoolExecutor | None = (
        ThreadPoolExecutor(max_workers=effective_max, thread_name_prefix=f"{agent_name}-exec")
        if effective_max > 1 else None
    )

    # The liaison's MCP connection (loopback Streamable HTTP -> serve daemon)
    # stays open for the whole daemon's lifetime. Each crew.kickoff() reuses
    # the same liaison instance.
    with create_liaison_agent(
        mcp_server_params=serve_params(agent_name=identity.gaii, **serve_opts),
        agent_name=agent_name,
        tool_filter=resolved_tool_filter,
        llm=llm,
    ) as liaison:
        print(f"[daemon:{agent_name}] liaison ready, entering poll loop")

        # Per-workspace {space: contract} map from the manifest, for the engagement gate below. Cached
        # for the daemon's lifetime (manifests are stable); populated lazily on the first record per ws.
        _space_contract_cache: dict[str, dict[str, str]] = {}

        def _engagement_gate(event: dict[str, Any]) -> bool:
            """Contract-engagement off-switch (docs/agent-workspace-contracts.md §7d). Return False to
            SKIP a record for a workspace/contract this agent has been RETIRED from — the deterministic
            half of "Retire actually stops the agent". Rules, fail-OPEN throughout:

              • read error / no org+ws  -> process (never wedge on a transient hiccup)
              • the record's space maps to a contract (manifest stamps it):
                    that contract retired -> SKIP;  active/absent -> process (+ backfill if absent)
              • space->contract unknown -> workspace-level: any active -> process;
                    only retired -> SKIP;  none -> process
            A legacy workspace (agent working via record traces, no engagement yet) is processed AND, when
            the contract is known, backfilled to `active` so it becomes visible on both views.
            """
            org, ws, space = event.get("organism_id"), event.get("ws"), event.get("space")
            if not org or not ws:
                return True
            mine = _agent_engagements(api, org, ws, agent_name)
            if mine is None:
                return True  # read failed -> fail open
            space_contract = _space_contract(api, org, ws, space, _space_contract_cache) if space else None
            verdict = _engagement_verdict(mine, space_contract)
            if verdict == "skip":
                where = f"{org}/{ws}" + (f"/{space}" if space_contract else "")
                print(f"[daemon:{agent_name}] skip record in {where}: contract engagement retired")
                return False
            if verdict == "backfill" and space_contract:
                _backfill_engagement(api, org, ws, agent_name, space_contract)
            return True

        def _handle_record(event: dict[str, Any]) -> None:
            """Act on one record event: the caller's on_record, else wrap as a synthetic task -> crew.
            Gated by contract engagements — a retired workspace/contract is skipped (§7d)."""
            if not _engagement_gate(event):
                return
            if on_record is not None:
                try:
                    on_record(event)
                except Exception as inner:  # noqa: BLE001 -- the record handler is the user's own code; report it and keep the daemon alive
                    print(f"[daemon:{agent_name}] on_record handler crashed: {inner}")
                    if on_error:
                        try:
                            on_error(inner)
                        except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                            pass
                return
            rid = f"record-{event.get('ws')}-{event.get('space')}-{event.get('id')}"
            synthetic_task = {
                "id": rid,
                "title": f"Workspace record {event.get('op', 'updated')}",
                "description": (
                    f"A record was {event.get('op', 'updated')} in "
                    f"{event.get('organism_id')}/{event.get('ws')}/{event.get('space')} (id: {event.get('id')}). "
                    f"Read it and run your contract handler for that space."
                ),
                "_source": "record",
                "_original": event,
            }
            try:
                with usage_run(rid, agent_name):
                    build_crew(synthetic_task, liaison).kickoff()
            except Exception as inner:  # noqa: BLE001 -- the crew is the user's own code; report it and keep the daemon alive
                print(f"[daemon:{agent_name}] record {rid} crashed: {inner}")
                if on_error:
                    try:
                        on_error(inner)
                    except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                        pass

        def _handle_dm(event: dict[str, Any]) -> None:
            """Act on one federated-inbox `dm.inbound` wake: the caller's on_dm, else wrap as a synthetic
            task -> crew. The wake is a lightweight summary; the handler reads the full body/attachments
            via aimeat_dm_thread(conversationId)."""
            if on_dm is not None:
                try:
                    on_dm(event)
                except Exception as inner:  # noqa: BLE001 -- the DM handler is the user's own code; report it and keep the daemon alive
                    print(f"[daemon:{agent_name}] on_dm handler crashed: {inner}")
                    if on_error:
                        try:
                            on_error(inner)
                        except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                            pass
                return
            did = f"dm-{event.get('id')}"
            synthetic_task = {
                "id": did,
                "title": f"Direct message from {event.get('senderGhii')}",
                "description": (
                    f"A direct message arrived (subject: {event.get('subject') or '-'}, "
                    f"from: {event.get('senderGhii')}). Preview: {event.get('preview', '')}. "
                    f"Read the full thread via aimeat_dm_thread (conversation_id: "
                    f"{event.get('conversationId')}) and reply in-thread with aimeat_dm_send."
                ),
                "_source": "dm",
                "_original": event,
            }
            try:
                with usage_run(did, agent_name):
                    build_crew(synthetic_task, liaison).kickoff()
            except Exception as inner:  # noqa: BLE001 -- the crew is the user's own code; report it and keep the daemon alive
                print(f"[daemon:{agent_name}] dm {did} crashed: {inner}")
                if on_error:
                    try:
                        on_error(inner)
                    except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                        pass

        while not stop["flag"]:
            dispatched_this_cycle = False

            # P2: a revoked/expired bearer degrades the serve tunnel to 'auth_failed' (the node pushes
            # `auth_revoked`, the connector stops the socket). Detect it via the loopback status (free,
            # not a node call) and exit so the supervisor re-auths instead of looping forever. Replaces
            # the old periodic node auth-liveness probe. Fetched EVERY cycle now (not just when push is
            # already on) so a direct/polling agent can observe its tunnel coming up and upgrade to push.
            agent_status = _serve_agent_status(api)
            if agent_status.get("transport") == "auth_failed":
                print(f"[daemon:{agent_name}] tunnel auth revoked/expired -- run `aimeat connect` to re-auth. Exiting.")
                auth_failed = True
                break

            # Live transport re-evaluation: flip push_wake if the serve daemon's tunnel for this agent
            # came up (or dropped) since startup. On a direct->tunnel upgrade, force one re-list now
            # (next_poll_due=0) to catch a task queued while we were interval-polling, then rely on push.
            new_push_wake = _resolve_push_wake(agent_status, push_wake)
            if new_push_wake and not push_wake:
                print(f"[daemon:{agent_name}] tunnel came up -> switching to push-wake long-poll")
                next_poll_due = 0.0
            elif push_wake and not new_push_wake:
                print(f"[daemon:{agent_name}] tunnel dropped -> falling back to interval polling")
            push_wake = new_push_wake

            # Re-list from the node only when a push woke us (or on the rare safety-net interval).
            # With no tunnel, push_wake is False so this is always True — unchanged polling.
            should_poll = (not push_wake) or woke_by_push or (time.monotonic() >= next_poll_due)

            try:
                # Reaping finished EXECUTE workers is LOCAL (no node call) and must run every cycle so
                # a long task's slot frees even on idle, push-less cycles — independent of should_poll.
                if executor is not None:
                    _reap_finished()

                if "tasks" in listen_set and should_poll:
                    next_poll_due = time.monotonic() + safety_net_s
                    # PROPOSE phase: every task with no plan yet, in either state it
                    # can be in.
                    #
                    #   'queued'                -- owner-created and waiting for a plan
                    #                              and the owner's approval.
                    #   'active' with no plan   -- nobody is going to queue it. A
                    #      task-runner agent's tasks are auto-activated on create, and
                    #      the Hello Integration test task is born active for EVERY
                    #      mode. Polling 'queued' alone therefore never saw them, so
                    #      the plan was never proposed and EXECUTE completed the task
                    #      unplanned. On the test task that jammed Hello Integration
                    #      at 6/7 forever: onboarding step accept_test_task passes
                    #      only when the task carries todos, complete_test_task passed
                    #      anyway, and a done task refuses a plan -- no call could get
                    #      the agent out. Every task-runner crew hit it.
                    #
                    # The node permits exactly this set (canProposeTodos, node
                    # src/services/agent-task-rules.ts), and since AIMEAT 1.x it
                    # REFUSES to complete a plan-less onboarding test task, so a
                    # runner that skips PROPOSE now hears about it instead of
                    # silently stranding itself.
                    #
                    # EXECUTE re-polls below, so a task planned in this cycle is
                    # picked up in the SAME cycle with its todos already on it.
                    plan_needed = _poll_tasks(api, status="queued") + [
                        t for t in _poll_tasks(api, status="active") if _has_no_live_plan(t)
                    ]
                    for task in plan_needed:
                        if stop["flag"]:
                            break
                        task_id = task.get("id")
                        if not task_id or task_id in proposed_ids:
                            continue
                        _dispatch("PROPOSE", task, propose_builder)
                        proposed_ids.add(task_id)
                        dispatched_this_cycle = True

                    # EXECUTE phase: tasks the owner has approved (active) and any
                    # the stall detector flagged (stalled -- the owner can resume by
                    # re-starting in the dashboard, which keeps them as 'active'
                    # again, but we also pick them up here so a daemon restart
                    # mid-task doesn't lose the task).
                    #
                    # Serial (effective_max == 1) keeps the original shared-liaison,
                    # blocking-kickoff path. Concurrent (>1) submits up to the free
                    # pool slots -- each task on its own per-task liaison/MCP (a
                    # shared stdio MCP can't be driven by parallel kickoffs).
                    if effective_max <= 1:
                        for task_status in ("active", "stalled"):
                            for task in _poll_tasks(api, status=task_status):
                                if stop["flag"]:
                                    break
                                task_id = task.get("id")
                                if not task_id or task_id in done_ids:
                                    continue
                                # Cooperative cancellation: re-check right before the
                                # blocking kickoff. The daemon dispatches from a list
                                # fetched at cycle start, so a subtask cancelled
                                # mid-cycle (e.g. a coordinator timed out and gave up
                                # on speculative branches, or the owner paused it) is
                                # still in that list. This guard stops abandoned work
                                # from ever starting -- circuit breaker for the
                                # "coordinator over-delegated to one crew" case.
                                if _is_cancelled(api, task_id):
                                    print(f"[daemon:{agent_name}] EXECUTE task {task_id} cancelled before start -- skipping")
                                    _fail_cancelled(api, task_id)
                                    done_ids.add(task_id)
                                    dispatched_this_cycle = True
                                    continue
                                ok = _dispatch("EXECUTE", task, build_crew)
                                if ok:
                                    done_ids.add(task_id)
                                dispatched_this_cycle = True
                    else:
                        for task_status in ("active", "stalled"):
                            if len(in_flight) >= effective_max:
                                break
                            for task in _poll_tasks(api, status=task_status):
                                if stop["flag"] or len(in_flight) >= effective_max:
                                    break
                                task_id = task.get("id")
                                if not task_id or task_id in done_ids or task_id in in_flight:
                                    continue
                                # Pre-submit cancellation check -- cheap, and avoids
                                # building a per-task liaison + MCP session for work
                                # that's already been cancelled. The worker re-checks
                                # again just before its kickoff (authoritative).
                                if _is_cancelled(api, task_id):
                                    print(f"[daemon:{agent_name}] EXECUTE task {task_id} cancelled before start -- skipping")
                                    _fail_cancelled(api, task_id)
                                    done_ids.add(task_id)
                                    dispatched_this_cycle = True
                                    continue
                                fut = executor.submit(_execute_worker, task)
                                futures[fut] = task_id
                                in_flight.add(task_id)
                                dispatched_this_cycle = True

                if "messages" in listen_set and should_poll:
                    messages = _poll_messages(api)
                    for msg in messages:
                        if stop["flag"]:
                            break
                        msg_id = msg.get("id")
                        # Guard against re-dispatch within this process even if
                        # the mark-delivered call below fails or races a poll.
                        if not msg_id or msg_id in done_ids:
                            continue
                        body = msg.get("content") or msg.get("body") or "(empty)"
                        print(f"[daemon:{agent_name}] dispatching message {msg_id}: {str(body)[:100]}")
                        synthetic_task = {
                            "id": f"msg-{msg_id}",
                            "title": "Inbox message",
                            "description": body,
                            "_source": "message",
                            "_original": msg,
                        }
                        crew = build_crew(synthetic_task, liaison)
                        kickoff_ok = False
                        try:
                            with usage_run(f"msg-{msg_id}", agent_name):
                                crew.kickoff()
                            kickoff_ok = True
                        except Exception as inner:  # noqa: BLE001 -- the crew is the user's own code; report it and leave the message undelivered
                            print(f"[daemon:{agent_name}] message {msg_id} crashed: {inner}")
                            if on_error:
                                try:
                                    on_error(inner)
                                except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                                    pass
                        # Mark delivered so the node stops returning it as pending;
                        # only after a successful kickoff so a crash leaves it for
                        # retry. Track locally regardless to avoid tight re-loops.
                        if kickoff_ok:
                            _mark_message_delivered(api, msg_id)
                            done_ids.add(msg_id)
                        dispatched_this_cycle = True

                if records_on:
                    # Catch-up on (re)connect: a change in the tunnel connect count (or the very first
                    # cycle, last_reconnects = -1) fires one synthetic catch-up event per subscribed
                    # space so the handler re-scans for writes missed while the socket was down.
                    cur_reconnects = int(agent_status.get("reconnects", 0))
                    if cur_reconnects != last_reconnects:
                        last_reconnects = cur_reconnects
                        for sp in record_space_list:
                            if stop["flag"]:
                                break
                            _handle_record({"type": "workspace.record", **sp, "id": None, "op": "catchup"})
                            dispatched_this_cycle = True

                    # Drain any pushed record events that arrived since the last cycle.
                    for event in _drain_records(api):
                        if stop["flag"]:
                            break
                        _handle_record(event)
                        dispatched_this_cycle = True

                if dms_on:
                    # Drain federated-inbox DM wakes pushed since the last cycle. No catch-up re-list:
                    # DMs aren't backlogged on reconnect (the agent can aimeat_dm_inbox on demand if it
                    # missed a window) — keeps an idle agent quiet, no DM poller.
                    for event in _drain_dms(api):
                        if stop["flag"]:
                            break
                        _handle_dm(event)
                        dispatched_this_cycle = True

            except Exception as outer:  # noqa: BLE001 -- one poll cycle failed; the supervisor decides about a restart, not this loop
                # The poll itself failed (e.g. network blip). Don't exit;
                # let the supervisor decide if a restart is warranted.
                print(f"[daemon:{agent_name}] poll cycle error: {outer}")
                if on_error:
                    try:
                        on_error(outer)
                    except Exception:  # noqa: BLE001, S110 -- the error callback is the user's code too; a reporter that fails has nothing left to report with
                        pass

            if not dispatched_this_cycle and on_idle:
                try:
                    on_idle()
                except Exception:  # noqa: BLE001, S110 -- the idle callback is the user's code; an idle tick is not worth ending the run for
                    pass

            if one_shot:
                print(f"[daemon:{agent_name}] one_shot=True, exiting after one cycle")
                break

            # Idle wait, interruptible by signals. While concurrent EXECUTE work
            # is in flight, come back sooner (<=5s) so freed pool slots refill
            # without waiting a full poll interval. With a live tunnel this
            # parks on the serve long-poll and wakes instantly on a delivered
            # task (push); otherwise it is the classic incremental sleep.
            cycle_sleep = min(poll_interval_seconds, 5) if in_flight else poll_interval_seconds
            # Idle wait. PREFERRED: the unified wake (/local/wake/next) resolves the instant ANY push
            # source (task/record/dm/message) arrives WITHOUT consuming, so this agent wakes on every
            # source rather than only its single parked queue. It's a pure signal -- the cycle body above
            # already drains records/dms and re-lists tasks/messages -- so nothing is processed inline.
            # An older serve answers 404 once; we latch `wake_unified=False` and drop to the legacy park.
            woke_by_push = False
            used_unified = False
            if push_wake and wake_unified is not False:
                outcome = _wait_unified(api, cycle_sleep, stop)
                if outcome == "unsupported":
                    wake_unified = False
                else:
                    wake_unified = True
                    used_unified = True
                    woke_by_push = outcome == "woke"
            if not used_unified:
                # Legacy per-queue park (serve without /local/wake/next, or transport not 'tunnel'). A
                # records/dms-parked agent that ALSO runs tasks must still wake on task pushes (they land
                # in /local/tasks/next, not the parked queue), so quick-check tasks inside the park.
                also_wake_tasks = push_wake and "tasks" in listen_set and wake_path != "/local/tasks/next"
                wake = _wait_for_work(api, push_wake, cycle_sleep, stop, wake_path=wake_path, also_wake_tasks=also_wake_tasks)
                woke_by_push = wake is not None
                # This per-queue park CONSUMED the event. /local/tasks/next is re-listed from the store
                # next cycle, but /local/dm/next and /local/records/next are queue-only (no store re-list,
                # no catch-up mid-session) -- so process the consumed event HERE or it is lost (a single-DM
                # wake would otherwise be popped and never reach on_dm).
                if wake:
                    ev = wake.get("event")
                    if isinstance(ev, dict) and not stop["flag"]:
                        if dms_on and wake_path == "/local/dm/next":
                            _handle_dm(ev)
                        elif records_on and wake_path == "/local/records/next":
                            _handle_record(ev)

        print(f"[daemon:{agent_name}] poll loop ended, releasing liaison")

    # Drain the EXECUTE pool: let running kickoffs finish (cooperative, not
    # preemptive -- matches the cancellation policy), then reap their results.
    # Each worker owns its liaison, so it closes independently of the shared one.
    if executor is not None:
        if in_flight:
            print(f"[daemon:{agent_name}] waiting for {len(in_flight)} in-flight task(s) to finish...")
        executor.shutdown(wait=True)
        _reap_finished()

    # The invoke listener parks in <=25 s long-polls; the stop flag is already set, so it returns
    # after its current poll. A bounded join so shutdown never hangs on a stuck loopback call.
    if invoke_thread is not None:
        invoke_thread.join(timeout=30)

    # P2: a revoked/expired bearer is a distinct, human-actionable exit (not a crash) -- exit 2 so a
    # supervisor stops restarting and prompts re-auth, instead of crash-looping on a dead credential.
    if auth_failed and not one_shot:
        sys.exit(2)
