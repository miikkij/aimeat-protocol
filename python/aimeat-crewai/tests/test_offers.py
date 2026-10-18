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

# The smallest deliverable the node accepts; build_offer requires one (0.36.0). No location, so an
# offer with only this is still not workflow-compatible.
DOC = {"format": "document"}


def _level3_offer() -> dict:
    return build_offer(
        id="research",
        title="Research a topic",
        ask="Ask me to research. I do NOT fetch real-time prices.",
        deliverable={"format": "document", "location": {"key": "research.out"}},
        success_signal=Sig.count_nonempty(key_glob="research.*", min=1),
        required_to_function=NONE,
        toll_morsels=10,
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
    offer = build_offer(id="hello", title="Hello", ask="Ask me anything. I won't do X.", deliverable=DOC)
    v = assess_offer(offer)
    assert v["offering"] is True
    assert v["workflow_compatible"] is False
    reasons = " ".join(v["missing"]["workflow_compatible"])
    assert "success_signal" in reasons
    assert "required_to_function" in reasons
    assert "deliverable.location" in reasons


def test_priced_requires_public_and_callable() -> None:
    offer = build_offer(
        id="x", title="X", ask="do x; not y", deliverable=DOC,
        toll_morsels=5, visibility="unlisted", callable={"action_id": "x"},
    )
    v = assess_offer(offer)
    assert v["priced"] is False
    assert any("public" in r for r in v["missing"]["priced"])


def test_priced_reads_money_price_or_pacing() -> None:
    base = {"visibility": "public", "callable": {"action_id": "x"}, "deliverable": DOC}
    money = build_offer(id="m", title="M", ask="do m; not n",
                        price_money={"amount": 1_500_000, "currency": "EUR"}, **base)
    assert money["priceMoney"] == {"amount": 1_500_000, "currency": "EUR"}
    assert assess_offer(money)["priced"] is True
    paced = build_offer(id="p", title="P", ask="do p; not q", toll_morsels=3, **base)
    assert paced["tollMorsels"] == 3
    assert assess_offer(paced)["priced"] is True
    neither = build_offer(id="n", title="N", ask="do n; not o", **base)
    v = assess_offer(neither)
    assert v["priced"] is False
    assert any("tollMorsels" in r for r in v["missing"]["priced"])


def test_deprecated_morsel_price_becomes_pacing() -> None:
    # A morsel is pacing, never a price: the 3.x price={"morsels": n} is written as tollMorsels,
    # added to any toll_morsels, and the document carries no `price`.
    with pytest.warns(DeprecationWarning, match="toll_morsels"):
        offer = build_offer(id="x", title="X", ask="do x; not y", deliverable=DOC, price={"morsels": 7}, toll_morsels=2)
    assert "price" not in offer
    assert offer["tollMorsels"] == 9
    # A stored 3.x offer that still carries price.morsels counts as offered to other owners.
    legacy = {"id": "l", "title": "L", "ask": "do l; not m", "price": {"morsels": 4},
              "visibility": "public", "callable": {"action_id": "l"}}
    assert assess_offer(legacy)["priced"] is True


def test_build_offer_drops_none() -> None:
    offer = build_offer(id="x", title="X", ask="do x; not y", deliverable=DOC)
    assert "price" not in offer and "success_signal" not in offer
    assert "priceMoney" not in offer and "tollMorsels" not in offer
    assert offer == {"id": "x", "title": "X", "ask": "do x; not y", "deliverable": DOC}


# ── document validation ───────────────────────────────────────────────────────

def test_validate_offers_doc_require_gate() -> None:
    doc = build_offers_doc([build_offer(id="x", title="X", ask="do x; not y", deliverable=DOC)])
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
