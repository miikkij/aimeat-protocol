"""
Tests for per-LLM-call usage telemetry -> node ledger (LEDGER TARGET-016).

Exercises the pure payload builder and the bus handler in isolation -- no real crewai bus,
no background thread, no node -- so the mapping "completed LLM call -> /v1/agents/:name/telemetry
llm_call body" is pinned deterministically. Mirrors what the node reads in
aimeat/src/services/usage-metering.ts (extractUsageFields): model (required), prompt_tokens,
completion_tokens, optional provider, and run_id as the top-level task_id.
"""
from __future__ import annotations

from aimeat_crewai.usage_telemetry import (
    build_llm_call_payload,
    usage_run,
    _make_handler,
)


class _CallType:
    """Duck-typed stand-in for crewai's LLMCallType enum (handler compares .value)."""

    def __init__(self, value: str) -> None:
        self.value = value


class _Event:
    """Duck-typed stand-in for LLMCallCompletedEvent."""

    def __init__(self, call_type: str, model, usage) -> None:
        self.call_type = _CallType(call_type)
        self.model = model
        self.usage = usage


def test_payload_full_shape_with_provider_and_run_id() -> None:
    p = build_llm_call_payload(
        "anthropic/claude-sonnet-4",
        {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        "task-1",
    )
    assert p == {
        "type": "llm_call",
        "task_id": "task-1",
        "data": {
            "model": "anthropic/claude-sonnet-4",
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "provider": "anthropic",
            "run_id": "task-1",
        },
    }


def test_payload_bare_model_no_run_id_defaults_tokens() -> None:
    p = build_llm_call_payload("gpt-4o", {}, None)
    assert "task_id" not in p
    assert p["data"] == {"model": "gpt-4o", "prompt_tokens": 0, "completion_tokens": 0}


def test_payload_coerces_bad_token_values() -> None:
    p = build_llm_call_payload("gpt-4o", {"prompt_tokens": None, "completion_tokens": -3}, None)
    assert p["data"]["prompt_tokens"] == 0
    assert p["data"]["completion_tokens"] == 0


def _collect() -> tuple[list, "callable"]:
    """A 2-arg (agent, payload) enqueue sink that records (agent, payload) tuples."""
    got: list[tuple] = []

    def sink(agent, payload) -> None:
        got.append((agent, payload))

    return got, sink


def test_handler_emits_within_usage_run() -> None:
    got, sink = _collect()
    handler = _make_handler(sink)
    with usage_run("task-x", "agent-x"):
        handler(None, _Event("llm_call", "openai/gpt-4o", {"prompt_tokens": 3, "completion_tokens": 7}))
    assert len(got) == 1
    agent, payload = got[0]
    assert agent == "agent-x"
    assert payload["task_id"] == "task-x"
    assert payload["data"]["provider"] == "openai"
    assert payload["data"]["completion_tokens"] == 7


def test_handler_attributes_each_agent_in_a_fleet() -> None:
    # The bug this fixes: in one process (fleet host) usage must land on the EMITTING agent,
    # not the first-installed one. default_agent is the first installer; the ContextVar wins.
    got, sink = _collect()
    handler = _make_handler(sink, default_agent="agent-first")
    ev = _Event("llm_call", "gpt-4o", {"prompt_tokens": 1, "completion_tokens": 1})
    with usage_run("task-a", "agent-a"):
        handler(None, ev)
    with usage_run("task-b", "agent-b"):
        handler(None, ev)
    assert [a for a, _ in got] == ["agent-a", "agent-b"]
    assert [p["task_id"] for _, p in got] == ["task-a", "task-b"]


def test_handler_falls_back_to_default_agent_for_direct_kickoffs() -> None:
    got, sink = _collect()
    handler = _make_handler(sink, default_agent="agent-default")
    # No usage_run context (a direct kickoff outside run_crew_daemon).
    handler(None, _Event("llm_call", "gpt-4o", {"prompt_tokens": 2, "completion_tokens": 2}))
    assert len(got) == 1
    agent, payload = got[0]
    assert agent == "agent-default"
    assert "task_id" not in payload  # no run id when outside usage_run


def test_handler_skips_tool_calls() -> None:
    got, sink = _collect()
    handler = _make_handler(sink)
    handler(None, _Event("tool_call", "gpt-4o", {"prompt_tokens": 1, "completion_tokens": 1}))
    assert got == []


def test_handler_skips_empty_or_missing_model() -> None:
    got, sink = _collect()
    handler = _make_handler(sink)
    handler(None, _Event("llm_call", "", {"prompt_tokens": 1}))
    handler(None, _Event("llm_call", None, None))
    assert got == []


def test_handler_swallows_sender_errors() -> None:
    def boom(_agent, _payload) -> None:
        raise RuntimeError("node down")

    handler = _make_handler(boom)
    # Must not raise -- metering is best-effort and never breaks the crew's LLM call.
    handler(None, _Event("llm_call", "gpt-4o", {"prompt_tokens": 1, "completion_tokens": 1}))
