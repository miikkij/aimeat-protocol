"""
Per-LLM-call usage telemetry -> AIMEAT ledger (LEDGER / TARGET-016).

CrewAI runs every LLM call through its event bus, emitting one `LLMCallCompletedEvent`
per call (model + token usage), provider-agnostic -- the litellm path AND the native
providers both emit it. This module subscribes once, and for each real LLM call POSTs a
`type="llm_call"` telemetry event to the node over the loopback `aimeat connect serve`
daemon (no bearer token needed -- the daemon holds it). The node records a priced,
append-only usage row (extractUsageFields -> recordUsageEvent) so the owner sees spend at
`/v1/ledger/usage`. Cost is NOT computed here (litellm is optional and often absent): we
send model + tokens and let the node price it from its own table.

`run_id` is stamped from a ContextVar the daemon sets around each `crew.kickoff()`, so
each usage row is attributed to the AIMEAT task that caused it. The daemon calls
`install_usage_telemetry(agent_name, base_url=...)` once at startup and wraps every
kickoff with `usage_run(task_id)`.

Everything here is best-effort: metering never blocks a crew (a background thread does the
HTTP) and never raises into crew code (all failures are swallowed). If the installed crewai
lacks the event bus, install is a logged no-op and crews run unchanged.

Mirrors the node contract in aimeat/src/routes/agent-telemetry.ts +
aimeat/src/services/usage-metering.ts (the node schema wins on any mismatch).

Changelog:
  0.16.0 -- New: deterministic per-LLM-call usage telemetry feeding the node ledger
    (LEDGER TARGET-016). Adds install_usage_telemetry() + usage_run() + build_llm_call_payload().
    Requires an AIMEAT node with the ledger ingest (node >= 1.38).
"""
from __future__ import annotations

import contextlib
import queue
import threading
from contextvars import ContextVar
from typing import Any, Callable

# The AIMEAT task id (-> ledger run_id) for the crew kickoff running on this context.
# Set by usage_run() around each crew.kickoff(); read by the LLM-call handler. Defaults
# to None -- the node accepts an llm_call telemetry event without a run_id (it groups as
# unattributed), so liaison/onboarding LLM calls outside a task still get metered.
_current_run_id: ContextVar[str | None] = ContextVar("aimeat_usage_run_id", default=None)


@contextlib.contextmanager
def usage_run(task_id: str | None):
    """Bind the AIMEAT task id for the duration of a crew.kickoff() so per-LLM-call usage
    events are stamped with run_id=task_id. Reset on exit (safe to nest)."""
    token = _current_run_id.set(task_id)
    try:
        yield
    finally:
        _current_run_id.reset(token)


def _int(v: Any) -> int:
    """Coerce a usage token count to a non-negative int (0 on anything odd)."""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    return n if n >= 0 else 0


def _extract_provider(model: str) -> str | None:
    """Derive a provider from a namespaced model id: "anthropic/claude-..." -> "anthropic".
    A bare "gpt-4o" returns None; the node then defaults provider and prices by model
    substring, so this is a best-effort hint only."""
    if "/" in model:
        head = model.split("/", 1)[0].strip()
        return head or None
    return None


def build_llm_call_payload(model: str, usage: dict[str, Any], run_id: str | None) -> dict[str, Any]:
    """Build the telemetry POST body for one LLM call. Shape matches the node's
    extractUsageFields: data.model (required), data.prompt_tokens / completion_tokens, an
    optional data.provider, and run_id both in data and as the top-level task_id (the node
    falls back to task_id when data.run_id is absent)."""
    data: dict[str, Any] = {
        "model": model,
        "prompt_tokens": _int(usage.get("prompt_tokens")),
        "completion_tokens": _int(usage.get("completion_tokens")),
    }
    provider = _extract_provider(model)
    if provider:
        data["provider"] = provider
    if run_id:
        data["run_id"] = run_id
    payload: dict[str, Any] = {"type": "llm_call", "data": data}
    if run_id:
        payload["task_id"] = run_id
    return payload


def _make_handler(enqueue: Callable[[dict[str, Any]], None]) -> Callable[[Any, Any], None]:
    """Build the `(source, event)` bus handler that turns a completed LLM call into a queued
    telemetry payload. Filters out tool calls and model-less events; never raises."""

    def _on_llm_completed(source: Any, event: Any) -> None:
        try:
            call_type = getattr(event, "call_type", None)
            # LLMCallType.LLM_CALL.value == "llm_call"; compare by value to stay robust to
            # enum identity / crewai version drift. Skip TOOL_CALL and anything else.
            if getattr(call_type, "value", call_type) != "llm_call":
                return
            model = (getattr(event, "model", None) or "").strip()
            if not model:
                return  # no model -> the node can't price it; don't record a ledger row
            usage = getattr(event, "usage", None) or {}
            enqueue(build_llm_call_payload(model, usage, _current_run_id.get()))
        except Exception:
            # Best-effort: a malformed event must never break the crew's LLM call.
            pass

    return _on_llm_completed


class _UsageSender:
    """Single background daemon thread draining a bounded queue of llm_call payloads and
    POSTing them to the node over the loopback serve daemon. Best-effort: full queue drops,
    POST failures are swallowed, so metering never slows or breaks a crew."""

    def __init__(self, agent_name: str, base_url: str | None) -> None:
        self._agent_name = agent_name
        self._base_url = base_url
        self._q: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=1000)
        self._client: Any = None
        self._thread = threading.Thread(
            target=self._run, name=f"aimeat-usage-{agent_name}", daemon=True
        )
        self._thread.start()

    def enqueue(self, payload: dict[str, Any]) -> None:
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            pass  # drop under backpressure -- telemetry is best-effort

    def _client_or_none(self) -> Any:
        if self._client is None:
            try:
                from .messaging import serve_client  # local import: keep module crewai-free
                self._client = serve_client(self._agent_name, base_url=self._base_url)
            except Exception:
                return None
        return self._client

    def _run(self) -> None:
        while True:
            payload = self._q.get()
            if payload is None:  # sentinel (unused today; here for a clean shutdown hook)
                return
            client = self._client_or_none()
            if client is None:
                continue
            try:
                client.post(
                    f"/v1/agents/{self._agent_name}/telemetry",
                    json=payload,
                    timeout=10,
                )
            except Exception:
                # Node down, tunnel revoked, transient network -- drop and keep the session
                # (a later call recovers). Never surface to the crew.
                pass


# One-time install state (the crewai event bus is a process-wide singleton).
_install_lock = threading.Lock()
_installed = False
_sender: _UsageSender | None = None
_listener: Any = None


def install_usage_telemetry(
    agent_name: str,
    base_url: str | None = None,
    *,
    enqueue: Callable[[dict[str, Any]], None] | None = None,
) -> bool:
    """Install the per-LLM-call usage -> ledger telemetry hook. Idempotent (safe to call
    once at daemon startup) and best-effort: returns True if active, False (logged no-op) if
    the installed crewai lacks the event bus. Pass `base_url` to reuse the daemon's already
    discovered loopback serve endpoint; pass `enqueue` to inject a sink (testing)."""
    global _installed, _sender, _listener
    with _install_lock:
        if _installed:
            return True
        try:
            from crewai.events.base_event_listener import BaseEventListener
            from crewai.events.types.llm_events import LLMCallCompletedEvent
        except Exception as exc:  # crewai event API absent or changed -> degrade gracefully
            print(f"[usage-telemetry] disabled (crewai event API unavailable): {exc}")
            return False

        if enqueue is None:
            _sender = _UsageSender(agent_name, base_url)
            enqueue = _sender.enqueue

        handler = _make_handler(enqueue)

        class _UsageListener(BaseEventListener):
            def setup_listeners(self, crewai_event_bus: Any) -> None:
                crewai_event_bus.on(LLMCallCompletedEvent)(handler)

        try:
            _listener = _UsageListener()  # __init__ registers on the bus
        except Exception as exc:
            print(f"[usage-telemetry] disabled (listener registration failed): {exc}")
            return False

        _installed = True
        print(f"[usage-telemetry] active for {agent_name} (per-LLM-call -> ledger)")
        return True
