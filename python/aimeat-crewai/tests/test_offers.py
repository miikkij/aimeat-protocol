"""
Offers + workflow-compatibility tests (no node / LLM required).

Mirror of the node contract (offer-schemas.ts / workflow-schemas.ts): a valid
level-3 offer passes; a level-1-only offer is flagged "not workflow-compatible";
"none" is a valid required_to_function; a leaf with both key and key_glob is
rejected.
"""
from __future__ import annotations

import json

import pytest

from aimeat_crewai import (
    NONE,
    OfferValidationError,
    Sig,
    SignalError,
    assess_offer,
    build_offer,
    build_offers_doc,
    is_workflow_compatible,
    validate_offers_doc,
    validate_signal,
)


# ── signal builder ──────────────────────────────────────────────────────────

def test_sig_builders_are_valid() -> None:
    validate_signal(Sig.exists(key="a"))
    validate_signal(Sig.nonempty(key_glob="a.*"))
    validate_signal(Sig.count_nonempty(key_glob="r.*", min=2))
    validate_signal(Sig.json_field(key="x", path="status", equals="ok"))
    validate_signal(Sig.all(Sig.exists(key="a"), Sig.nonempty(key="b")))
    validate_signal(Sig.when(Sig.exists(key="a"), Sig.json_valid(key="a")))
    validate_signal(Sig.llm(key="a", ask="is it good?"))


def test_leaf_must_target_exactly_one() -> None:
    with pytest.raises(SignalError):
        Sig.exists(key="a", key_glob="a.*")
    with pytest.raises(SignalError):
        Sig.exists()
    # And the structural validator catches a hand-rolled bad leaf.
    with pytest.raises(SignalError):
        validate_signal({"kind": "deterministic", "op": "exists", "key": "a", "key_glob": "b"})


def test_unknown_op_rejected() -> None:
    with pytest.raises(SignalError):
        validate_signal({"kind": "deterministic", "op": "bogus", "key": "a"})


# ── offer level assessment ────────────────────────────────────────────────────

def _level3_offer() -> dict:
    return build_offer(
        id="research",
        title="Research a topic",
        ask="Ask me to research. I do NOT fetch real-time prices.",
        deliverable={"format": "document", "location": {"key": "research.out"}},
        success_signal=Sig.count_nonempty(key_glob="research.*", min=1),
        required_to_function=NONE,
        price={"morsels": 10, "unit": "per-call"},
        visibility="public",
        callable={"action_id": "research-run"},
    )


def test_level3_offer_is_workflow_compatible_and_priced() -> None:
    v = assess_offer(_level3_offer())
    assert v["offering"] and v["workflow_compatible"] and v["priced"]
    assert v["missing"] == {}
    assert is_workflow_compatible(_level3_offer())


def test_none_is_valid_required_to_function() -> None:
    offer = _level3_offer()
    assert offer["required_to_function"] == "none"
    assert assess_offer(offer)["workflow_compatible"]


def test_level1_only_offer_flags_missing_workflow_bits() -> None:
    offer = build_offer(id="hello", title="Hello", ask="Ask me anything. I won't do X.")
    v = assess_offer(offer)
    assert v["offering"] is True
    assert v["workflow_compatible"] is False
    reasons = " ".join(v["missing"]["workflow_compatible"])
    assert "success_signal" in reasons
    assert "required_to_function" in reasons
    assert "deliverable.location" in reasons


def test_priced_requires_public_and_callable() -> None:
    offer = build_offer(
        id="x", title="X", ask="do x; not y",
        price={"morsels": 5}, visibility="unlisted", callable={"action_id": "x"},
    )
    v = assess_offer(offer)
    assert v["priced"] is False
    assert any("public" in r for r in v["missing"]["priced"])


def test_build_offer_drops_none() -> None:
    offer = build_offer(id="x", title="X", ask="do x; not y")
    assert "price" not in offer and "success_signal" not in offer
    assert offer == {"id": "x", "title": "X", "ask": "do x; not y"}


# ── document validation ───────────────────────────────────────────────────────

def test_validate_offers_doc_require_gate() -> None:
    doc = build_offers_doc([build_offer(id="x", title="X", ask="do x; not y")])
    # offering passes
    validate_offers_doc(doc, require="offering")
    # but workflow_compatible should raise
    with pytest.raises(OfferValidationError):
        validate_offers_doc(doc, require="workflow_compatible")


def test_validate_offers_doc_needs_offers_list() -> None:
    with pytest.raises(SignalError):
        validate_offers_doc({"version": 1}, require=None)


# ── publish guardrails (no network) ───────────────────────────────────────────

def test_publish_requires_node_url(monkeypatch) -> None:
    from aimeat_crewai import publish_offers

    monkeypatch.delenv("AIMEAT_NODE_URL", raising=False)
    monkeypatch.delenv("AIMEAT_AGENT_TOKEN", raising=False)
    monkeypatch.setenv("AIMEAT_HOME", "/nonexistent-aimeat-home-xyz")
    doc = build_offers_doc([_level3_offer()])
    with pytest.raises(RuntimeError, match="node_url"):
        publish_offers(doc, agent_name="research-bot")


# ── CLI ───────────────────────────────────────────────────────────────────────

def test_cli_check_passes_for_valid_doc(tmp_path, capsys) -> None:
    from aimeat_crewai.cli import main

    p = tmp_path / "offers.json"
    p.write_text(json.dumps(build_offers_doc([_level3_offer()])), encoding="utf-8")
    rc = main(["check", "--file", str(p)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "workflow-compatible" in out and "priced" in out


def test_cli_check_flags_incomplete(tmp_path) -> None:
    from aimeat_crewai.cli import main

    # An offer missing id/title/ask -> not even offering -> exit 1.
    p = tmp_path / "offers.json"
    p.write_text(json.dumps({"version": 1, "offers": [{"title": "x"}]}), encoding="utf-8")
    rc = main(["check", "--file", str(p)])
    assert rc == 1
