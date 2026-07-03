"""
Unit tests for the contract-engagement gate (docs/agent-workspace-contracts.md §7d) — the deterministic
half of "Retire actually stops the agent". Covers the pure decision (`_engagement_verdict`) and the
loopback REST helpers (`_agent_engagements`, `_space_contract`, `_backfill_engagement`) against a fake
`_Api`. No node / no network.
"""
from __future__ import annotations

from typing import Any

from aimeat_crewai.daemon import (
    _agent_engagements,
    _backfill_engagement,
    _engagement_verdict,
    _space_contract,
)


class _FakeResp:
    def __init__(self, status_code: int, payload: dict[str, Any]):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeApi:
    """Duck-typed stand-in for daemon._Api: records calls, returns canned responses by path."""

    def __init__(self, agent_name: str = "web-researcher", responses: dict[str, Any] | None = None):
        self.agent_name = agent_name
        self._responses = responses or {}
        self.gets: list[tuple[str, dict]] = []
        self.posts: list[tuple[str, dict]] = []

    def get(self, path: str, **kwargs: Any) -> _FakeResp:
        self.gets.append((path, kwargs))
        r = self._responses.get(path)
        if isinstance(r, Exception):
            raise r
        return r if r is not None else _FakeResp(404, {})

    def post(self, path: str, **kwargs: Any) -> _FakeResp:
        self.posts.append((path, kwargs))
        return _FakeResp(200, {"success": True})


# ── _engagement_verdict: the pure decision ──────────────────────────────────────────────────────────

def _eng(contract: str, state: str) -> dict[str, Any]:
    return {"contract": contract, "state": state, "agentName": "web-researcher"}


def test_verdict_known_contract_active_processes():
    assert _engagement_verdict([_eng("research", "active")], "research") == "process"


def test_verdict_known_contract_retired_skips():
    assert _engagement_verdict([_eng("research", "retired")], "research") == "skip"


def test_verdict_known_contract_absent_backfills():
    # market-scan has an engagement, but the record's space maps to 'research' which has none yet.
    assert _engagement_verdict([_eng("market-scan", "active")], "research") == "backfill"


def test_verdict_mixed_is_per_contract():
    mine = [_eng("research", "retired"), _eng("market-scan", "active")]
    # A record in the retired contract's space is skipped even though another contract is active.
    assert _engagement_verdict(mine, "research") == "skip"
    assert _engagement_verdict(mine, "market-scan") == "process"


def test_verdict_no_space_mapping_any_active_processes():
    assert _engagement_verdict([_eng("research", "retired"), _eng("x", "active")], None) == "process"


def test_verdict_no_space_mapping_only_retired_skips():
    # The whole-agent Retire case (retireAll): every engagement retired, no space->contract map -> skip.
    assert _engagement_verdict([_eng("research", "retired"), _eng("market-scan", "retired")], None) == "skip"


def test_verdict_no_engagements_processes():
    assert _engagement_verdict([], None) == "process"
    assert _engagement_verdict([], "research") == "backfill"


# ── _agent_engagements: read + filter, fail-open on error ────────────────────────────────────────────

def test_agent_engagements_filters_to_this_agent():
    path = "/v1/organisms/org1/workspace/engagements"
    payload = {"data": {"engagements": [
        {"agentName": "web-researcher", "contract": "research", "state": "active"},
        {"agentName": "other-agent", "contract": "research", "state": "active"},
    ]}}
    api = _FakeApi("web-researcher", {path: _FakeResp(200, payload)})
    out = _agent_engagements(api, "org1", "ws1", "web-researcher")
    assert out is not None and len(out) == 1 and out[0]["agentName"] == "web-researcher"
    # passes ws as a query param
    assert api.gets[0][1]["params"]["ws"] == "ws1"


def test_agent_engagements_non_200_returns_none():
    path = "/v1/organisms/org1/workspace/engagements"
    api = _FakeApi("web-researcher", {path: _FakeResp(500, {})})
    assert _agent_engagements(api, "org1", "ws1", "web-researcher") is None


def test_agent_engagements_exception_returns_none():
    path = "/v1/organisms/org1/workspace/engagements"
    api = _FakeApi("web-researcher", {path: RuntimeError("boom")})
    assert _agent_engagements(api, "org1", "ws1", "web-researcher") is None


# ── _space_contract: manifest map + caching ─────────────────────────────────────────────────────────

def test_space_contract_reads_and_caches():
    path = "/v1/organisms/org1/workspace"
    payload = {"data": {"manifest": {"objectTypes": [
        {"name": "research-request", "contract": "research"},
        {"name": "notes"},  # no contract stamp
    ]}}}
    api = _FakeApi("web-researcher", {path: _FakeResp(200, payload)})
    cache: dict[str, dict[str, str]] = {}
    assert _space_contract(api, "org1", "ws1", "research-request", cache) == "research"
    assert _space_contract(api, "org1", "ws1", "notes", cache) is None
    # second lookup is served from cache -> only ONE manifest GET total
    assert sum(1 for p, _ in api.gets if p == path) == 1


def test_space_contract_read_error_not_cached():
    path = "/v1/organisms/org1/workspace"
    api = _FakeApi("web-researcher", {path: _FakeResp(500, {})})
    cache: dict[str, dict[str, str]] = {}
    assert _space_contract(api, "org1", "ws1", "research-request", cache) is None
    assert "org1/ws1" not in cache  # a failed read must be retryable


# ── _backfill_engagement: POST shape ────────────────────────────────────────────────────────────────

def test_backfill_posts_active_engagement_with_contract():
    api = _FakeApi("web-researcher")
    _backfill_engagement(api, "org1", "ws1", "web-researcher", "research")
    assert len(api.posts) == 1
    path, kwargs = api.posts[0]
    assert path == "/v1/organisms/org1/workspace/engagements"
    assert kwargs["json"] == {"ws": "ws1", "agent": "web-researcher", "contract": "research"}
