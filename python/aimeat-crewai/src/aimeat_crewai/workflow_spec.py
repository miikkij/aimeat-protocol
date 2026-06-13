"""
AIMEAT signal grammar + workflow-compatibility checking, in pure Python.

This is the executable reference for the offer/workflow contract, generalised so
ANY agent (not just a specific crew) can build valid signals and check, offline,
whether an offer is workflow-compatible. It mirrors the node's source of truth:

  - aimeat/src/models/workflow-schemas.ts  (the signal grammar)
  - aimeat/src/models/offer-schemas.ts      (the offer descriptor)

If this module ever disagrees with those, the node schema wins -- fix it here.

What's here:
  - Sig: a tiny builder for the signal grammar (deterministic-first, with the
    opt-in `llm` leaf and the all/any/when composites). No JSON by hand.
  - validate_signal(): structural check of a signal tree (leaf targets exactly
    one of key|key_glob, op is known, composites well-formed).
  - assess_offer() / assess_offers_doc(): per-offer verdict of which levels it
    reaches (offering / workflow-compatible / priced) and exactly what's missing,
    mirroring the node's save-time workflow-compat gate.

Pure stdlib -- importable without crewai/requests, so the CLI and tests stay light.
"""
from __future__ import annotations

from typing import Any

# ── Signal grammar (mirror of workflow-schemas.ts) ──────────────────────────

DETERMINISTIC_OPS = frozenset(
    {"exists", "nonempty", "json_valid", "count_nonempty", "json_schema", "json_field"}
)

# The literal string an offer/step uses for "no memory input" (a source offer).
NONE = "none"


class SignalError(ValueError):
    """Raised when a signal tree is structurally invalid."""


def _leaf(op: str, key: str | None, key_glob: str | None, **extra: Any) -> dict[str, Any]:
    if (key is None) == (key_glob is None):
        raise SignalError(
            f"signal leaf op={op!r} must target exactly one of key | key_glob "
            f"(got key={key!r}, key_glob={key_glob!r})"
        )
    out: dict[str, Any] = {"kind": "deterministic", "op": op}
    if key is not None:
        out["key"] = key
    else:
        out["key_glob"] = key_glob
    out.update(extra)
    return out


class Sig:
    """Builder for the AIMEAT signal grammar. Every leaf targets exactly one of
    ``key`` or ``key_glob``. Prefer the deterministic leaves; ``llm`` is opt-in
    and runs on the node only when OpenRouter is configured and the owner
    approved it.

    Example::

        from aimeat_crewai.workflow_spec import Sig, NONE
        success = Sig.count_nonempty(key_glob="research.*.findings", min=1)
        needs   = NONE   # a source offer
    """

    @staticmethod
    def exists(*, key: str | None = None, key_glob: str | None = None) -> dict[str, Any]:
        return _leaf("exists", key, key_glob)

    @staticmethod
    def nonempty(*, key: str | None = None, key_glob: str | None = None) -> dict[str, Any]:
        return _leaf("nonempty", key, key_glob)

    @staticmethod
    def json_valid(*, key: str | None = None, key_glob: str | None = None) -> dict[str, Any]:
        return _leaf("json_valid", key, key_glob)

    @staticmethod
    def count_nonempty(
        *, key: str | None = None, key_glob: str | None = None, min: int = 1
    ) -> dict[str, Any]:
        if not isinstance(min, int) or min < 0:
            raise SignalError(f"count_nonempty min must be a non-negative int, got {min!r}")
        return _leaf("count_nonempty", key, key_glob, min=min)

    @staticmethod
    def json_schema(
        *, schema: dict[str, Any], key: str | None = None, key_glob: str | None = None
    ) -> dict[str, Any]:
        if not isinstance(schema, dict):
            raise SignalError("json_schema requires a dict `schema`")
        return _leaf("json_schema", key, key_glob, schema=schema)

    @staticmethod
    def json_field(
        *,
        path: str,
        key: str | None = None,
        key_glob: str | None = None,
        min: float | None = None,
        equals: Any = None,
        nonempty: bool | None = None,
    ) -> dict[str, Any]:
        if not path:
            raise SignalError("json_field requires a non-empty `path`")
        extra: dict[str, Any] = {"path": path}
        if min is not None:
            extra["min"] = min
        if equals is not None:
            extra["equals"] = equals
        if nonempty is not None:
            extra["nonempty"] = nonempty
        return _leaf("json_field", key, key_glob, **extra)

    @staticmethod
    def llm(*, ask: str, key: str | None = None, key_glob: str | None = None) -> dict[str, Any]:
        if not ask:
            raise SignalError("llm leaf requires a non-empty `ask`")
        if (key is None) == (key_glob is None):
            raise SignalError("llm leaf must target exactly one of key | key_glob")
        if key is not None:
            return {"kind": "llm", "ask": ask, "key": key}
        return {"kind": "llm", "ask": ask, "key_glob": key_glob}

    @staticmethod
    def all(*signals: dict[str, Any]) -> dict[str, Any]:
        if not signals:
            raise SignalError("all() needs at least one signal")
        return {"all": list(signals)}

    @staticmethod
    def any(*signals: dict[str, Any]) -> dict[str, Any]:
        if not signals:
            raise SignalError("any() needs at least one signal")
        return {"any": list(signals)}

    @staticmethod
    def when(cond: dict[str, Any], then: dict[str, Any]) -> dict[str, Any]:
        return {"when": cond, "then": then}


def validate_signal(sig: Any, *, path: str = "signal") -> None:
    """Structurally validate a signal tree (raises SignalError on the first
    problem). Mirrors the leaf/composite rules in workflow-schemas.ts. Does NOT
    evaluate the signal -- that happens on the node against owner memory."""
    if not isinstance(sig, dict):
        raise SignalError(f"{path}: expected an object, got {type(sig).__name__}")

    if "all" in sig or "any" in sig:
        keyname = "all" if "all" in sig else "any"
        arr = sig[keyname]
        if not isinstance(arr, list) or not arr:
            raise SignalError(f"{path}.{keyname}: must be a non-empty list")
        for i, child in enumerate(arr):
            validate_signal(child, path=f"{path}.{keyname}[{i}]")
        return

    if "when" in sig:
        if "then" not in sig:
            raise SignalError(f"{path}: `when` requires a `then`")
        validate_signal(sig["when"], path=f"{path}.when")
        validate_signal(sig["then"], path=f"{path}.then")
        return

    kind = sig.get("kind")
    has_key = sig.get("key") is not None
    has_glob = sig.get("key_glob") is not None
    if has_key == has_glob:
        raise SignalError(f"{path}: leaf must target exactly one of key | key_glob")

    if kind == "deterministic":
        op = sig.get("op")
        if op not in DETERMINISTIC_OPS:
            raise SignalError(f"{path}: unknown deterministic op {op!r} (valid: {sorted(DETERMINISTIC_OPS)})")
        if op == "count_nonempty" and not isinstance(sig.get("min"), int):
            raise SignalError(f"{path}: count_nonempty requires an integer `min`")
        if op == "json_schema" and not isinstance(sig.get("schema"), dict):
            raise SignalError(f"{path}: json_schema requires a `schema` object")
        if op == "json_field" and not sig.get("path"):
            raise SignalError(f"{path}: json_field requires a `path`")
        return

    if kind == "llm":
        if not sig.get("ask"):
            raise SignalError(f"{path}: llm leaf requires `ask`")
        return

    raise SignalError(f"{path}: unknown signal kind {kind!r} (expected deterministic | llm | all | any | when)")


# ── Offer / workflow-compat assessment (mirror of offer-schemas.ts) ─────────

def _required_to_function_ok(value: Any) -> bool:
    """A valid required_to_function is the literal "none" OR a valid signal."""
    if value == NONE:
        return True
    try:
        validate_signal(value)
        return True
    except SignalError:
        return False


def assess_offer(offer: dict[str, Any]) -> dict[str, Any]:
    """Return a verdict for one offer: which levels it reaches and what's missing.

    Levels (additive, mirroring docs/building-an-aimeat-compatible-agent.md §1):
      - offering:            id + title + ask present
      - workflow_compatible: success_signal + required_to_function (signal | "none")
                             + deliverable.location present
      - priced:             price (non-null) + visibility=="public"
                             + callable with action_id or webhook_url

    Returns {id, offering, workflow_compatible, priced, missing: {level: [reasons]},
             warnings: [..]}.
    """
    missing: dict[str, list[str]] = {}
    warnings: list[str] = []

    # Level 1 -- offering
    offering_missing = [f for f in ("id", "title", "ask") if not offer.get(f)]
    offering = not offering_missing
    if offering_missing:
        missing["offering"] = [f"missing {f}" for f in offering_missing]

    # Level 3 -- workflow-compatible
    wf_missing: list[str] = []
    success = offer.get("success_signal")
    if success is None:
        wf_missing.append("missing success_signal")
    else:
        try:
            validate_signal(success)
        except SignalError as e:
            wf_missing.append(f"invalid success_signal: {e}")
    rtf = offer.get("required_to_function")
    if rtf is None:
        wf_missing.append('missing required_to_function (use a signal or the string "none")')
    elif not _required_to_function_ok(rtf):
        wf_missing.append('invalid required_to_function (must be a signal or "none")')
    location = (offer.get("deliverable") or {}).get("location")
    if not location:
        wf_missing.append("missing deliverable.location")
    workflow_compatible = not wf_missing
    if wf_missing:
        missing["workflow_compatible"] = wf_missing

    # Level 2 -- priced
    priced_missing: list[str] = []
    if offer.get("price") is None:
        priced_missing.append("missing price (or price is null)")
    if offer.get("visibility") != "public":
        priced_missing.append('visibility is not "public"')
    callable_ = offer.get("callable") or {}
    if not (callable_.get("action_id") or callable_.get("webhook_url")):
        priced_missing.append("missing callable.action_id or callable.webhook_url")
    priced = not priced_missing
    if priced_missing:
        missing["priced"] = priced_missing

    # Drift warnings (advisory, not failures)
    sample = (offer.get("deliverable") or {}).get("sample")
    if sample is not None and sample != "untested":
        warnings.append(
            'deliverable.sample is set to a concrete value -- ensure it is a REAL excerpt '
            'from a successful run, not invented (or use "untested").'
        )
    ask = offer.get("ask") or ""
    if ask and not any(neg in ask.lower() for neg in ("not ", "don't", "doesn't", "no ", "without")):
        warnings.append(
            "ask has no visible negative scope -- state what this offer does NOT do, "
            "so it cannot over-promise."
        )

    return {
        "id": offer.get("id"),
        "offering": offering,
        "workflow_compatible": workflow_compatible,
        "priced": priced,
        "missing": missing,
        "warnings": warnings,
    }


def is_workflow_compatible(offer: dict[str, Any]) -> bool:
    """True iff the offer can be a step in an Agent Workflow."""
    return assess_offer(offer)["workflow_compatible"]


def assess_offers_doc(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Assess every offer in an offers document. Returns a list of verdicts."""
    offers = doc.get("offers") if isinstance(doc, dict) else None
    if not isinstance(offers, list):
        raise SignalError('offers document must have an "offers" list')
    return [assess_offer(o if isinstance(o, dict) else {}) for o in offers]
