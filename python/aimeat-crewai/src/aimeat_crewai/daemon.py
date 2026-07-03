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

import signal
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Iterable

from .liaison import create_liaison_agent, AimeatLiaisonError
from .mcp_client import ensure_serve, serve_params
from .paths import aimeat_home

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `requests` package is required for the daemon. Install: pip install requests"
    ) from exc


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

    def __init__(self, base_url: str, agent_name: str, session: Any = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.agent_name = agent_name
        self.session = session or requests.Session()
        self.session.headers.update({"X-Aimeat-Agent": agent_name})

    def get(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.get(f"{self.base_url}{path}", **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.post(f"{self.base_url}{path}", **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", 15)
        return self.session.patch(f"{self.base_url}{path}", **kwargs)


def _read_token(agent_name: str, owner: str | None = None) -> tuple[str, str]:
    """
    Locate the agent's stored token + node URL from the connector's layout.

    The connector (`aimeat connect add`) writes:
      ~/.aimeat/tokens/{agent}@{owner}.token      -- bearer token (mode 0600)
      ~/.aimeat/agents/{agent}/config.yaml        -- per-agent config (incl. node_url)

    Earlier versions of this helper looked at `~/.aimeat/<agent>/.token` which
    is the SKILL-BUNDLE directory, not the keychain. That layout never matched
    a real connector install, so the daemon could never start. This rewrite
    uses the actual keychain + per-agent config paths.

    If `owner` is provided, looks for `tokens/{agent}@{owner}.token` directly.
    Otherwise globs `tokens/{agent}@*.token` and uses the single match. Errors
    if zero matches or more than one (the latter means the agent name is
    ambiguous and the caller must pass `owner`).

    Returns (token, node_url).
    """
    import glob

    home_dir = aimeat_home()
    tokens_dir = home_dir / "tokens"
    agent_config_path = home_dir / "agents" / agent_name / "config.yaml"

    # Locate the token file.
    if owner:
        token_path = tokens_dir / f"{agent_name}@{owner}.token"
        if not token_path.is_file():
            raise AimeatLiaisonError(
                f"No token at {token_path}. Run: aimeat connect add --agent {agent_name} --owner {owner} ..."
            )
        token_file = token_path
    else:
        pattern = str(tokens_dir / f"{agent_name}@*.token")
        matches = sorted(glob.glob(pattern))
        if not matches:
            raise AimeatLiaisonError(
                f"No token file matching {pattern}. Run: aimeat connect add --agent {agent_name} --owner <owner> --url <node-url>"
            )
        if len(matches) > 1:
            owners = [Path(m).stem.split("@", 1)[1] for m in matches]
            raise AimeatLiaisonError(
                f"Multiple owners have an agent named '{agent_name}' ({', '.join(owners)}). "
                f"Pass `owner=<name>` to disambiguate."
            )
        token_file = Path(matches[0])

    token = token_file.read_text(encoding="utf-8").strip()

    # Best-effort node_url extraction from per-agent config.yaml.
    node_url = "https://aimeat.io"
    if agent_config_path.is_file():
        text = agent_config_path.read_text(encoding="utf-8")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("node_url:"):
                raw = line.split(":", 1)[1].strip().strip('"').strip("'")
                if raw:
                    node_url = raw
                break

    return token, node_url


def _poll_tasks(api: _Api, status: str = "queued") -> list[dict[str, Any]]:
    """Return list of tasks for the agent in the given status, or [] on error."""
    try:
        r = api.get(f"/v1/agents/{api.agent_name}/tasks", params={"status": status})
        if r.status_code != 200:
            return []
        body = r.json()
        return body.get("data", {}).get("tasks", []) or []
    except Exception:
        return []


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
    except Exception:
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
    except Exception:
        pass
    # 2) coordinator-written cancellations. New connectors get these PUSHED over the tunnel
    #    (task.cancelled) and the serve daemon holds the set — a FREE loopback read, no more
    #    owner-scoped `agents.cancel.*` memory scan (100 records) before every dispatch. Fall back to
    #    the legacy scan only if the serve daemon is too old to expose /local/cancelled (404).
    try:
        r = api.get("/local/cancelled", params={"agent": api.agent_name}, timeout=10)
        if r.status_code == 200:
            return task_id in (r.json().get("data", {}).get("cancelled", []) or [])
        if r.status_code != 404:
            return False
    except Exception:
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
                if isinstance(val, dict) and task_id in (str(k) for k in val.keys()):
                    return True
    except Exception:
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
    except Exception:
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
            return ""
        msgs = r.json().get("data", {}).get("messages", []) or []
        for m in msgs:
            if m.get("id") == msg_id:
                return m.get("content", "") or ""
        return ""
    except Exception:
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
    except Exception:
        return False


def _poll_messages(api: _Api) -> list[dict[str, Any]]:
    """Return list of pending inbox messages for the agent, or [] on error.

    Each entry has its full `content` resolved (the /inbox endpoint only carries
    a truncated preview, so we fetch the body per message).
    """
    try:
        r = api.get(f"/v1/agents/{api.agent_name}/inbox")
        if r.status_code != 200:
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
    except Exception:
        return []


def _wait_for_work(
    api: _Api, use_push: bool, seconds: float, stop: dict[str, Any],
    wake_path: str = "/local/tasks/next",
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
            wait_ms = int(min(remaining, 5.0) * 1000)
            try:
                r = api.get(
                    wake_path,
                    params={"wait": wait_ms, "agent": api.agent_name},
                    timeout=wait_ms / 1000 + 10,
                )
                if r.status_code == 200:
                    # push wake -- return the consumed payload so the caller can process queue-only
                    # events (DM / record) that the next cycle's drain would no longer see.
                    try:
                        data = r.json().get("data")
                        return data if isinstance(data, dict) else {}
                    except Exception:
                        return {}
            except Exception:
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
    except Exception:
        return 0


def _drain_records(api: _Api, max_items: int = 50) -> list[dict[str, Any]]:
    """Pull all immediately-available record events off the serve daemon's record queue (wait=0,
    non-blocking), up to `max_items`. Each is a `workspace.record` envelope. [] when none/on error."""
    out: list[dict[str, Any]] = []
    for _ in range(max_items):
        try:
            r = api.get("/local/records/next", params={"wait": 0, "agent": api.agent_name}, timeout=10)
            if r.status_code != 200:
                break
            event = r.json().get("data", {}).get("event")
            if not isinstance(event, dict):
                break
            out.append(event)
        except Exception:
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
            return None
        engs = (r.json().get("data") or {}).get("engagements") or []
    except Exception:
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
                return None
            ots = ((r.json().get("data") or {}).get("manifest") or {}).get("objectTypes") or []
            cache[key] = {
                ot["name"]: ot["contract"]
                for ot in ots
                if isinstance(ot, dict) and ot.get("name") and ot.get("contract")
            }
        except Exception:
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
    except Exception:
        pass


def _drain_dms(api: _Api, max_items: int = 50) -> list[dict[str, Any]]:
    """Pull all immediately-available federated-inbox `dm.inbound` wakes off the serve daemon's DM queue
    (wait=0, non-blocking), up to `max_items`. Each envelope is record-shaped (id, conversationId,
    subject, senderGhii, preview, attachments (count), createdAt). [] when none/on error. Read the full
    body/attachments via aimeat_dm_thread(conversationId)."""
    out: list[dict[str, Any]] = []
    for _ in range(max_items):
        try:
            r = api.get("/local/dm/next", params={"wait": 0, "agent": api.agent_name}, timeout=10)
            if r.status_code != 200:
                break
            event = r.json().get("data", {}).get("event")
            if not isinstance(event, dict):
                break
            out.append(event)
        except Exception:
            break
    return out


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
    except Exception:
        return {}
    return {}


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
                    f"You are the AIMEAT Liaison. AIMEAT task {task_id} is queued for "
                    f"this crew (title: {title}).\n\n"
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
    # Deliverables
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

      PROPOSE: Pick up tasks in status='queued' that the daemon has not
        proposed yet, run the propose-phase crew (which calls
        aimeat_task_propose_todos once and stops). Owner approval (or
        task-runner mode's auto-activation) then flips the task to 'active'.
      EXECUTE: Pick up tasks in status='active' (or 'stalled') the daemon
        has not yet completed, run the caller's build_crew (which should
        finish the work and call aimeat_task_complete).

    For task-runner mode agents the AIMEAT node auto-activates tasks on
    create, so the daemon's PROPOSE phase still runs (idempotent propose
    of todos) and the same task is picked up by EXECUTE in the SAME cycle
    or the next one -- no owner approval required.

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
    api = _Api(loopback_base, agent_name)

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
            result = crew.kickoff()
            print(f"[daemon:{agent_name}] {phase_label} task {task_id} done; first 200 chars: {str(result)[:200]}")
            return True
        except Exception as inner:
            print(f"[daemon:{agent_name}] {phase_label} task {task_id} crashed: {inner}")
            if on_error:
                try:
                    on_error(inner)
                except Exception:
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
                except Exception:
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
                mcp_server_params=serve_params(agent_name=agent_name, **serve_opts),
                agent_name=agent_name,
                tool_filter=resolved_tool_filter,
                llm=llm,
            ) as worker_liaison:
                if _is_cancelled(api, task_id):
                    print(f"[daemon:{agent_name}] EXECUTE task {task_id} cancelled before start -- skipping")
                    _fail_cancelled(api, task_id)
                    return (task_id, "cancelled")
                crew = build_crew(task, worker_liaison)
                result = crew.kickoff()
                print(f"[daemon:{agent_name}] EXECUTE task {task_id} done; first 200 chars: {str(result)[:200]}")
                return (task_id, "ok")
        except Exception as inner:
            print(f"[daemon:{agent_name}] EXECUTE task {task_id} crashed: {inner}")
            if on_error:
                try:
                    on_error(inner)
                except Exception:
                    pass
            try:
                api.post(
                    f"/v1/agents/{agent_name}/tasks/{task_id}/fail",
                    json={"message": f"Crew crashed: {inner}"},
                    timeout=10,
                )
            except Exception:
                pass
            return (task_id, "error")

    def _reap_finished() -> None:
        """Main-thread reap of completed EXECUTE workers (concurrent path)."""
        for f in [f for f in list(futures) if f.done()]:
            tid = futures.pop(f)
            in_flight.discard(tid)
            try:
                _, status = f.result()
            except Exception:
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
        mcp_server_params=serve_params(agent_name=agent_name, **serve_opts),
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
                except Exception as inner:
                    print(f"[daemon:{agent_name}] on_record handler crashed: {inner}")
                    if on_error:
                        try:
                            on_error(inner)
                        except Exception:
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
                build_crew(synthetic_task, liaison).kickoff()
            except Exception as inner:
                print(f"[daemon:{agent_name}] record {rid} crashed: {inner}")
                if on_error:
                    try:
                        on_error(inner)
                    except Exception:
                        pass

        def _handle_dm(event: dict[str, Any]) -> None:
            """Act on one federated-inbox `dm.inbound` wake: the caller's on_dm, else wrap as a synthetic
            task -> crew. The wake is a lightweight summary; the handler reads the full body/attachments
            via aimeat_dm_thread(conversationId)."""
            if on_dm is not None:
                try:
                    on_dm(event)
                except Exception as inner:
                    print(f"[daemon:{agent_name}] on_dm handler crashed: {inner}")
                    if on_error:
                        try:
                            on_error(inner)
                        except Exception:
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
                build_crew(synthetic_task, liaison).kickoff()
            except Exception as inner:
                print(f"[daemon:{agent_name}] dm {did} crashed: {inner}")
                if on_error:
                    try:
                        on_error(inner)
                    except Exception:
                        pass

        while not stop["flag"]:
            dispatched_this_cycle = False

            # P2: a revoked/expired bearer degrades the serve tunnel to 'auth_failed' (the node pushes
            # `auth_revoked`, the connector stops the socket). Detect it via the loopback status (free,
            # not a node call) and exit so the supervisor re-auths instead of looping forever. Replaces
            # the old periodic node auth-liveness probe.
            agent_status = _serve_agent_status(api) if (push_wake or records_on or dms_on) else {}
            if agent_status.get("transport") == "auth_failed":
                print(f"[daemon:{agent_name}] tunnel auth revoked/expired -- run `aimeat connect` to re-auth. Exiting.")
                auth_failed = True
                break

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
                    # PROPOSE phase: queued tasks the daemon hasn't proposed yet.
                    # Owner-created tasks land in 'queued'; the daemon proposes a
                    # plan and waits for owner approval (or for task-runner mode's
                    # auto-active route to flip the task to 'active' directly).
                    for task in _poll_tasks(api, status="queued"):
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
                            crew.kickoff()
                            kickoff_ok = True
                        except Exception as inner:
                            print(f"[daemon:{agent_name}] message {msg_id} crashed: {inner}")
                            if on_error:
                                try:
                                    on_error(inner)
                                except Exception:
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

            except Exception as outer:
                # The poll itself failed (e.g. network blip). Don't exit;
                # let the supervisor decide if a restart is warranted.
                print(f"[daemon:{agent_name}] poll cycle error: {outer}")
                if on_error:
                    try:
                        on_error(outer)
                    except Exception:
                        pass

            if not dispatched_this_cycle and on_idle:
                try:
                    on_idle()
                except Exception:
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
            wake = _wait_for_work(api, push_wake, cycle_sleep, stop, wake_path=wake_path)
            woke_by_push = wake is not None
            # The wake long-poll CONSUMED the event off the serve queue. /local/tasks/next is re-listed
            # from the store next cycle, but /local/dm/next and /local/records/next are queue-only (no
            # store re-list, no catch-up mid-session) -- so process the consumed event HERE or it is lost
            # (a single-DM wake would otherwise be popped and never reach on_dm). The next cycle's drain
            # still picks up any further events that arrived after this one.
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

    # P2: a revoked/expired bearer is a distinct, human-actionable exit (not a crash) -- exit 2 so a
    # supervisor stops restarting and prompts re-auth, instead of crash-looping on a dead credential.
    if auth_failed and not one_shot:
        sys.exit(2)
