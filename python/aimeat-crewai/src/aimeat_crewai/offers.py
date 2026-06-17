"""
AIMEAT offers -- build, validate, and publish an agent's offers document.

An *offer* is the human-readable face of what an agent does plus the machine
contract the mesh and Agent Workflows build on. An agent publishes its offers to
memory key ``agents.{name}.offers``; the node's Offers surface, the mesh, and the
workflow save/validate path all read that one record.

This module is the generalised, reusable version of what a crew did by hand:
  - build_offer() / build_offers_doc(): assemble a valid document.
  - validate_offers_doc(): assess each offer's levels (offering / workflow-
    compatible / priced) using workflow_spec; raise on a level you require.
  - publish_offers(): write the document to the node over REST.

Canonical shape: aimeat/src/models/offer-schemas.ts (the node wins on any
mismatch). Full spec: docs/building-an-aimeat-compatible-agent.md.
"""
from __future__ import annotations

import json
import os
from typing import Any

from .paths import aimeat_home
from .workflow_spec import NONE, assess_offers_doc

__all__ = [
    "NONE",
    "OfferValidationError",
    "build_offer",
    "build_offers_doc",
    "validate_offers_doc",
    "publish_offers",
    "resolve_agent_token",
]


class OfferValidationError(ValueError):
    """Raised when an offers document fails the level checks the caller required."""

    def __init__(self, message: str, verdicts: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.verdicts = verdicts or []


def build_offer(
    *,
    id: str,
    title: str,
    ask: str,
    example: str | None = None,
    tags: list[str] | None = None,
    cost: str | None = None,
    latency: str | None = None,
    verification: str | None = None,
    data_handling: str | None = None,
    deliverable: dict[str, Any] | None = None,
    success_signal: dict[str, Any] | None = None,
    required_to_function: dict[str, Any] | str | None = None,
    price: dict[str, Any] | None = None,
    visibility: str | None = None,
    callable: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """Assemble one offer dict, dropping keys left as None so the result stays
    minimal and validates against the node's optional-friendly schema. Pass
    ``required_to_function=NONE`` for a source offer with no memory input."""
    offer: dict[str, Any] = {"id": id, "title": title, "ask": ask}
    optional = {
        "example": example,
        "tags": tags,
        "cost": cost,
        "latency": latency,
        "verification": verification,
        "dataHandling": data_handling,
        "deliverable": deliverable,
        "success_signal": success_signal,
        "required_to_function": required_to_function,
        "price": price,
        "visibility": visibility,
        "callable": callable,
    }
    for k, v in optional.items():
        if v is not None:
            offer[k] = v
    offer.update(extra)
    return offer


def build_offers_doc(offers: list[dict[str, Any]], *, version: int = 1, updated_at: str | None = None) -> dict[str, Any]:
    """Wrap offers into the published document shape ``{version, updatedAt, offers}``."""
    doc: dict[str, Any] = {"version": version, "offers": offers}
    if updated_at is not None:
        doc["updatedAt"] = updated_at
    return doc


def validate_offers_doc(
    doc: dict[str, Any],
    *,
    require: str | None = None,
) -> list[dict[str, Any]]:
    """Assess every offer and return the per-offer verdicts.

    Args:
        doc: an offers document ({version, offers:[...]}).
        require: if set to "offering" | "workflow_compatible" | "priced", raise
            OfferValidationError unless AT LEAST ONE offer reaches that level.
            If None (default), only assess -- never raise on level (still raises
            on a malformed signal tree via workflow_spec).

    Returns:
        list of verdict dicts (see workflow_spec.assess_offer).
    """
    verdicts = assess_offers_doc(doc)
    if require is not None:
        if require not in ("offering", "workflow_compatible", "priced"):
            raise ValueError(f"require must be one of offering|workflow_compatible|priced, got {require!r}")
        if not any(v.get(require) for v in verdicts):
            raise OfferValidationError(
                f"no offer reaches level '{require}'. "
                f"Verdicts: {json.dumps(verdicts, ensure_ascii=False)}",
                verdicts,
            )
    return verdicts


def resolve_agent_token(agent_name: str) -> str | None:
    """Best-effort read of the connector-stored agent token from
    ``<AIMEAT_HOME or <cwd>/.aimeat>/agents/<name>/.token`` (the documented
    location; see mcp_client.http_params). Returns None if not found."""
    home = aimeat_home()
    token_file = home / "agents" / agent_name / ".token"
    try:
        return token_file.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def publish_offers(
    doc: dict[str, Any],
    *,
    agent_name: str,
    node_url: str | None = None,
    agent_token: str | None = None,
    require: str | None = "offering",
    session: Any = None,
) -> dict[str, Any]:
    """Validate then publish an offers document to ``agents.{agent_name}.offers``
    on the node via ``POST /v1/memory``.

    Args:
        doc: the offers document (use build_offers_doc / build_offer).
        agent_name: the bare agent name -- becomes the memory key segment.
        node_url: node base URL. Falls back to env AIMEAT_NODE_URL.
        agent_token: Bearer token. Falls back to the connector-stored token
            (resolve_agent_token), then env AIMEAT_AGENT_TOKEN.
        require: minimum level to enforce before publishing (default "offering";
            pass None to skip the level gate, or "workflow_compatible"/"priced").
        session: optional requests.Session (else a one-off requests call).

    Returns:
        The parsed JSON response envelope from the node.

    Raises:
        OfferValidationError: the doc fails the required level.
        RuntimeError: missing node_url/token, or the node returns an error.
    """
    validate_offers_doc(doc, require=require)

    url = (node_url or os.environ.get("AIMEAT_NODE_URL") or "").rstrip("/")
    if not url:
        raise RuntimeError("node_url is required (pass it or set AIMEAT_NODE_URL).")
    token = agent_token or resolve_agent_token(agent_name) or os.environ.get("AIMEAT_AGENT_TOKEN")
    if not token:
        raise RuntimeError(
            f"No agent token. Pass agent_token=, set AIMEAT_AGENT_TOKEN, or run "
            f"`aimeat connect add --agent {agent_name}` so the token is stored locally."
        )

    try:
        import requests  # local import keeps the module importable without requests
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("publish_offers needs `requests` (pip install requests).") from exc

    payload = {"key": f"agents.{agent_name}.offers", "value": doc}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    http = session or requests
    resp = http.post(f"{url}/v1/memory", json=payload, headers=headers, timeout=30)
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text}
    if resp.status_code >= 400 or (isinstance(body, dict) and body.get("ok") is False):
        raise RuntimeError(f"publish_offers failed ({resp.status_code}): {json.dumps(body, ensure_ascii=False)}")
    return body
