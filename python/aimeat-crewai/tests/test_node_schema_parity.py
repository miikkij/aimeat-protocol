"""
The Python offer and signal builders, validated against the node's own schema.

The node's zod schemas (aimeat/src/models/offer-schemas.ts, workflow-signals.ts) are written out as
JSON Schema in tests/fixtures/node-offer-schema.json by `pnpm python:schema`. The node's gate
`pnpm check:python-shapes` fails when that file no longer matches the zod schemas, so a node schema
change brings a new fixture in the same commit, and these tests then run against it.

Two halves check two things. The node's gate compares NAMES: every field on each side, which are
required, every signal op, read from this package's source. These tests check VALUES: what the
builders actually return validates against the node's schema. The node schema wins on any
mismatch; a difference that is deliberate is listed with its reason in
aimeat/security/python-shape-parity.json, which both halves read.

No node, no network, no third-party validator: a JSON Schema subset is checked here by hand
(the keywords zod emits), because adding a validator would be a new dependency.
"""
from __future__ import annotations

import inspect
import json
import re
from pathlib import Path
from typing import Any

import pytest

from aimeat_crewai import NONE, Sig, assess_offer, build_offer, build_offers_doc, workflow_spec
from aimeat_crewai import offers as offers_module

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "node-offer-schema.json"
ALLOWLIST = HERE.parents[2] / "aimeat" / "security" / "python-shape-parity.json"

NODE = json.loads(FIXTURE.read_text(encoding="utf-8"))
OFFERS_DOC = NODE["offersDoc"]
OFFER = OFFERS_DOC["properties"]["offers"]["items"]
SIGNAL = NODE["signal"]


def _allowlisted() -> set[str]:
    if not ALLOWLIST.exists():  # the package tested outside this repository
        return set()
    return set(json.loads(ALLOWLIST.read_text(encoding="utf-8")).get("exempt", {}))


# ── A JSON Schema subset: the keywords zod's toJSONSchema emits ─────────────

_TYPES = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "null": lambda v: v is None,
}


def _resolve(ref: str, root: dict[str, Any]) -> dict[str, Any]:
    if ref == "#":
        return root
    node: Any = root
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    return node


def errors(value: Any, schema: dict[str, Any], root: dict[str, Any], path: str = "$") -> list[str]:
    """Every way `value` breaks `schema`, as `path: reason` lines. Empty means valid."""
    if "$ref" in schema:
        return errors(value, _resolve(schema["$ref"], root), root, path)
    out: list[str] = []
    t = schema.get("type")
    if t is not None:
        kinds = t if isinstance(t, list) else [t]
        if not any(_TYPES[k](value) for k in kinds):
            return [f"{path}: expected {t}, got {type(value).__name__}"]
    if "const" in schema and value != schema["const"]:
        out.append(f"{path}: expected {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: {value!r} not in {schema['enum']}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", 10**9):
            out.append(f"{path}: length {len(value)} out of bounds")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            out.append(f"{path}: does not match {schema['pattern']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            out.append(f"{path}: below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            out.append(f"{path}: above {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            out.append(f"{path}: not above {schema['exclusiveMinimum']}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", 10**9):
            out.append(f"{path}: {len(value)} items out of bounds")
        if isinstance(schema.get("items"), dict):
            for i, item in enumerate(value):
                out.extend(errors(item, schema["items"], root, f"{path}[{i}]"))
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value:
                out.append(f"{path}: missing required {req!r}")
        for k, v in value.items():
            if k in props:
                out.extend(errors(v, props[k], root, f"{path}.{k}"))
            elif schema.get("additionalProperties") is False:
                out.append(f"{path}: unexpected {k!r}")
            elif isinstance(schema.get("additionalProperties"), dict):
                out.extend(errors(v, schema["additionalProperties"], root, f"{path}.{k}"))
    if "anyOf" in schema and not any(not errors(value, s, root, path) for s in schema["anyOf"]):
        out.append(f"{path}: matches none of anyOf")
    if "oneOf" in schema:
        matches = sum(1 for s in schema["oneOf"] if not errors(value, s, root, path))
        if matches != 1:
            out.append(f"{path}: matches {matches} of oneOf, expected exactly 1")
    for s in schema.get("allOf", []):
        out.extend(errors(value, s, root, path))
    return out


def offer_errors(offer: dict[str, Any]) -> list[str]:
    return errors(offer, OFFER, OFFERS_DOC)


def signal_errors(sig: dict[str, Any]) -> list[str]:
    return errors(sig, SIGNAL, SIGNAL)


# ── The validator refuses what it should (a vacuous validator proves nothing) ──

def test_the_validator_refuses_a_bad_signal_and_a_bad_offer() -> None:
    assert signal_errors({"kind": "deterministic", "op": "no-such-op", "key": "a"})
    assert signal_errors({"kind": "deterministic", "op": "count_nonempty", "key": "a"})  # no min
    assert signal_errors({"all": []})
    assert offer_errors({"id": "x", "title": "t", "ask": "a", "deliverable": {"format": "pdf"}})
    assert offer_errors({"id": "", "title": "t", "ask": "a", "deliverable": {"format": "json"}})
    assert offer_errors({"id": "x", "title": "t", "ask": "a", "deliverable": {"format": "json"}, "tollMorsels": 101})


# ── Signals ─────────────────────────────────────────────────────────────────

def _node_ops() -> set[str]:
    ops: set[str] = set()

    def visit(s: dict[str, Any]) -> None:
        for key in ("anyOf", "oneOf"):
            for child in s.get(key, []):
                visit(child)
        op = s.get("properties", {}).get("op", {}).get("const")
        if op:
            ops.add(op)

    visit(SIGNAL)
    return ops


def test_deterministic_ops_are_the_nodes() -> None:
    assert workflow_spec.DETERMINISTIC_OPS == _node_ops()


SIGNALS = {
    "exists key": Sig.exists(key="research.out"),
    "exists glob": Sig.exists(key_glob="research.*"),
    "nonempty": Sig.nonempty(key="research.out"),
    "json_valid": Sig.json_valid(key_glob="research.*.json"),
    "count_nonempty": Sig.count_nonempty(key_glob="research.*.findings", min=2),
    "json_schema": Sig.json_schema(key="research.out", schema={"type": "object"}),
    "json_field all": Sig.json_field(key="r.out", path="score", min=0.5, equals="ok", nonempty=True),
    "json_field path": Sig.json_field(key_glob="r.*", path="pick"),
    "llm key": Sig.llm(key="research.out", ask="Is this a finished report?"),
    "llm glob": Sig.llm(key_glob="research.*", ask="Is this a finished report?"),
    "all": Sig.all(Sig.exists(key="a"), Sig.nonempty(key="b")),
    "any": Sig.any(Sig.exists(key="a"), Sig.llm(key="b", ask="ok?")),
    "when": Sig.when(Sig.exists(key="a"), Sig.count_nonempty(key_glob="b.*", min=1)),
}


@pytest.mark.parametrize("name", sorted(SIGNALS))
def test_every_sig_builder_makes_a_signal_the_node_accepts(name: str) -> None:
    assert signal_errors(SIGNALS[name]) == []


# ── Offers ──────────────────────────────────────────────────────────────────

# A value for every keyword build_offer names, each one the node accepts.
FULL = {
    "id": "research-brief",
    "title": "Research brief",
    "ask": "A sourced brief on one topic. Does not write code.",
    "example": "Brief me on heat pumps in Finland",
    "tags": ["research"],
    "cost": "cheap",
    "latency": "minutes",
    "verification": "deterministic",
    "data_handling": "llm-provider",
    "deliverable": {"format": "document", "location": {"key": "research.brief"}, "sample": "untested"},
    "success_signal": Sig.nonempty(key="research.brief"),
    "required_to_function": NONE,
    "price_money": {"amount": 2_000_000, "currency": "EUR"},
    "toll_morsels": 5,
    "visibility": "public",
    "callable": {"action_id": "research-brief"},
}


def test_build_offer_names_a_value_for_every_keyword_this_test_fills() -> None:
    """When build_offer gains a keyword, FULL has to give it a value, so the test below covers it."""
    params = inspect.signature(build_offer).parameters
    named = {n for n, p in params.items() if p.kind is p.KEYWORD_ONLY and n != "price"}
    assert named == set(FULL)


def test_an_offer_with_every_keyword_is_one_the_node_accepts() -> None:
    offer = build_offer(**FULL)
    assert offer_errors(offer) == []
    verdict = assess_offer(offer)
    assert verdict["offering"] and verdict["workflow_compatible"] and verdict["priced"], verdict


def test_required_to_function_as_a_signal_is_one_the_node_accepts() -> None:
    offer = build_offer(**{**FULL, "required_to_function": Sig.exists(key="research.request")})
    assert offer_errors(offer) == []


def test_every_key_build_offer_writes_is_a_node_field() -> None:
    offer = build_offer(**FULL)
    node_fields = set(OFFER["properties"])
    python_only = {f"offer.field.python-only:{k}" for k in offer if k not in node_fields}
    assert python_only <= _allowlisted(), sorted(python_only - _allowlisted())


def test_the_deprecated_price_never_reaches_the_offer() -> None:
    with pytest.warns(DeprecationWarning):
        offer = build_offer(**FULL, price={"morsels": 3})
    assert "price" not in offer
    assert offer["tollMorsels"] == 8
    assert offer_errors(offer) == []


def test_build_offer_requires_a_deliverable_as_the_node_does() -> None:
    """OfferSchema requires `deliverable`, and the node's catalogue drops a whole offers document
    that does not parse, so an offer without one is refused here, naming the field (0.36.0)."""
    with pytest.raises(TypeError, match="deliverable"):
        build_offer(id="x", title="t", ask="a")  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="deliverable"):
        build_offer(id="x", title="t", ask="a", deliverable={"location": {"key": "k"}})
    with pytest.raises(TypeError, match="deliverable"):
        build_offer(id="x", title="t", ask="a", deliverable=None)  # type: ignore[arg-type]
    smallest = build_offer(id="x", title="t", ask="a", deliverable={"format": "document"})
    assert offer_errors(smallest) == []
    assert "offer.required.node-only:deliverable" not in _allowlisted()


def test_an_offers_document_is_one_the_node_accepts() -> None:
    doc = build_offers_doc([build_offer(**FULL)], updated_at="2026-10-18T00:00:00Z")
    assert errors(doc, OFFERS_DOC, OFFERS_DOC) == []


# ── Constants both sides write out ──────────────────────────────────────────

def test_the_constants_are_the_nodes() -> None:
    assert offers_module.TOLL_MORSELS_MAX == NODE["constants"]["TOLL_MORSELS_MAX"]
    assert NONE == NODE["constants"]["REQUIRED_TO_FUNCTION_NONE"]
    node_formats = OFFER["properties"]["deliverable"]["properties"]["format"]["enum"]
    assert set(offers_module.DELIVERABLE_FORMATS) == set(node_formats)
